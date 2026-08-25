import { readFile } from "node:fs/promises";
import Fastify from "fastify";
import { WebSocketServer, type WebSocket } from "ws";
import { buildApplication } from "../../src/bootstrap/index.js";
import { DEVELOPMENT_BUSINESS, DEVELOPMENT_US_BUSINESS } from "../../src/app/index.js";
import { AgentConfigurationService } from "../../src/modules/agents/index.js";
import {
  migrateDatabase,
  openRegionalDatabase,
  seedBusiness,
} from "../../src/infrastructure/database/regional-database.js";
import { SqliteAgentConfigurationRepository } from "../../src/infrastructure/database/sqlite-agent-configuration-repository.js";
import { SqliteConversationUsageRepository } from "../../src/infrastructure/database/sqlite-conversation-usage-repository.js";
import type {
  AudioFrame,
  ConversationRuntimeEvent,
  ConversationSession,
  ConversationTransport,
} from "../../src/modules/conversation/index.js";
import {
  decodeWav,
  floatAudioToRealtimeFrame,
  splitRealtimeFrame,
} from "../../src/modules/voice/index.js";

const transcriptEnabled = process.argv.includes("--transcript");
const port = Number(process.env.DEV_VOICE_PORT ?? 4317);
const tenantId = process.env.YIBO_TENANT_ID?.trim() || DEVELOPMENT_BUSINESS.tenantId;
const profile = [DEVELOPMENT_BUSINESS, DEVELOPMENT_US_BUSINESS].find((value) => value.tenantId === tenantId);
if (!profile) throw new Error(`Unknown development tenant: ${tenantId}`);
const database = openRegionalDatabase(profile.region);
migrateDatabase(database);
seedBusiness(database, profile);
const configurationRepository = new SqliteAgentConfigurationRepository(database, profile.region);
const usageRepository = new SqliteConversationUsageRepository(database, profile.region);
const configurationService = new AgentConfigurationService(configurationRepository);
if (!await configurationRepository.getConfiguration(profile.tenantId)) {
  await configurationRepository.saveConfiguration(profile.tenantId, configurationService.recommended(
    profile.locale,
    profile.name,
    process.env.OPENAI_REALTIME_MODEL?.trim() || "gpt-realtime-2.1",
  ));
}
const app = buildApplication({
  tenantId,
  agentConfigurationRepository: configurationRepository,
  usageRecorder: usageRepository,
});
const server = Fastify({ logger: false });
const htmlPath = new URL("./index.html", import.meta.url);
const clientPath = new URL("./client.js", import.meta.url);
const configurationPanelPath = new URL("./configuration-panel.js", import.meta.url);

server.get("/", async (_request, reply) => reply.type("text/html").send(await readFile(htmlPath, "utf8")));
server.get("/client.js", async (_request, reply) => reply.type("text/javascript").send(await readFile(clientPath, "utf8")));
server.get("/configuration-panel.js", async (_request, reply) => reply.type("text/javascript").send(await readFile(configurationPanelPath, "utf8")));
server.get("/api/configuration", async () => ({
  current: await app.agentConfiguration.get(app.tenantId),
  recommended: app.agentConfiguration.recommended(profile.locale, profile.name, app.config.openAiRealtimeModel),
  availableTools: app.tools ? [
    { name: "check_availability", kind: "consult", label: "Consultar disponibilidad" },
    { name: "create_appointment", kind: "mutate", label: "Crear citas" },
    { name: "cancel_appointment", kind: "mutate", label: "Cancelar citas" },
    { name: "transfer_to_human", kind: "external", label: "Transferir a una persona" },
  ] : [],
  secrets: { apiKeyConfigured: Boolean(app.config.openAiApiKey) },
}));
server.put("/api/configuration", async (request, reply) => {
  try {
    const saved = await app.agentConfiguration.update(app.tenantId, request.body as never);
    return { configuration: saved, appliesTo: "next-conversation" };
  } catch (error) {
    return reply.code(400).send({ error: errorMessage(error) });
  }
});
server.get("/api/usage", async () => usageRepository.summarize(app.tenantId));

const sockets = new WebSocketServer({ server: server.server, path: "/voice" });
sockets.on("connection", (socket) => attachHarness(socket));

await server.listen({ host: "127.0.0.1", port });
console.log(`YIBO DevAudioHarness: http://127.0.0.1:${port}`);
console.log(`Transcript logging: ${transcriptEnabled ? "ON" : "OFF"}; audio persistence: OFF`);

function attachHarness(socket: WebSocket): void {
  const callId = app.ids.generate("call");
  const inbound = new AudioQueue();
  let session: ConversationSession | undefined;
  let starting: Promise<void> | undefined;
  let inputSampleRate = 48_000;
  let inputChannels = 1;
  let nextBinaryIsWav = false;
  let inboundFrames = 0;
  let outboundFrames = 0;
  let lastAssistantTurnId: string | undefined;
  type PlaybackPosition = { assistantTurnId: string; audioEndMs: number };
  const playbackAcks = new Map<string, (position: PlaybackPosition | undefined) => void>();

  const log = (event: string, metadata: Record<string, unknown> = {}) => {
    const record = { callId, timestamp: new Date().toISOString(), event, ...metadata };
    console.log(JSON.stringify(record));
    if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(record));
  };

  const interruptLocalPlayback = async (): Promise<PlaybackPosition | undefined> => {
    if (!lastAssistantTurnId || socket.readyState !== socket.OPEN) return undefined;
    const requestId = app.ids.generate("idempotency");
    const fallback = { assistantTurnId: lastAssistantTurnId, audioEndMs: 0 };
    const position = await new Promise<PlaybackPosition | undefined>((resolve) => {
      const timeout = setTimeout(() => {
        playbackAcks.delete(requestId);
        resolve(fallback);
      }, 500);
      playbackAcks.set(requestId, (value) => {
        clearTimeout(timeout);
        playbackAcks.delete(requestId);
        resolve(value);
      });
      socket.send(JSON.stringify({ type: "playback.clear", requestId }));
    });
    if (position) log("playback.interrupted", position);
    return position;
  };

  const ensureConversation = async (): Promise<void> => {
    if (session) return;
    if (starting) return starting;
    starting = startConversation();
    try {
      await starting;
    } finally {
      starting = undefined;
    }
  };

  const startConversation = async (): Promise<void> => {
    const customer = await app.customers.findOrCreateByPhone({
      tenantId: app.tenantId,
      phone: "+529990000001",
      name: "Dev Voice Caller",
    });
    if (!customer.ok) throw new Error(`Unable to prepare dev customer: ${customer.error.code}`);
    const prepared = await app.agents.prepare({
      tenantId: app.tenantId,
      callId,
      customerId: customer.value.id,
    });
    if (!prepared.ok) throw new Error(`Unable to prepare agent: ${prepared.error.code}`);
    const transport: ConversationTransport = {
      inboundAudio: inbound,
      outboundAudio: {
        write: async (frame, assistantTurnId) => {
          outboundFrames += 1;
          lastAssistantTurnId = assistantTurnId;
          log("audio.out", { bytes: frame.data.byteLength, frames: outboundFrames });
          if (socket.readyState === socket.OPEN) {
            socket.send(JSON.stringify({ type: "audio.chunk", assistantTurnId, bytes: frame.data.byteLength }));
            socket.send(frame.data, { binary: true });
          }
        },
        interrupt: interruptLocalPlayback,
      },
      close: async () => inbound.end(),
    };
    session = await app.conversations.start({
      conversationId: callId,
      agent: prepared.value,
      transport,
      observeEvent: (event) => observeRuntimeEvent(event, log),
    });
    log("conversation.opened");
    void session.completed.then((completion) => log("conversation.completed", completion));
  };

  socket.on("message", (raw, binary) => {
    void (async () => {
      try {
        if (!binary) {
          const message = JSON.parse(raw.toString()) as Record<string, unknown>;
          if (message.type === "playback.cleared") {
            const requestId = typeof message.requestId === "string" ? message.requestId : "";
            const assistantTurnId = typeof message.assistantTurnId === "string" ? message.assistantTurnId : "";
            const audioEndMs = typeof message.audioEndMs === "number" ? message.audioEndMs : 0;
            if (requestId) {
              playbackAcks.get(requestId)?.(message.active === false || !assistantTurnId
                ? undefined
                : { assistantTurnId, audioEndMs });
            }
          } else if (message.type === "mic.start") {
            inputSampleRate = positiveNumber(message.sampleRate, "sampleRate");
            inputChannels = positiveNumber(message.channels, "channels");
            await ensureConversation();
            log("microphone.started", { sampleRate: inputSampleRate, channels: inputChannels });
          } else if (message.type === "fixture.next") {
            nextBinaryIsWav = true;
            await ensureConversation();
            log("fixture.ready", { name: typeof message.name === "string" ? message.name : "fixture.wav" });
          } else if (message.type === "interrupt") {
            const position = await interruptLocalPlayback();
            await session?.interrupt(position);
            log("conversation.interrupted");
          } else if (message.type === "close") {
            await session?.close();
            log("conversation.closed");
          }
          return;
        }
        await ensureConversation();
        const bytes = raw instanceof ArrayBuffer
          ? new Uint8Array(raw)
          : Array.isArray(raw)
            ? new Uint8Array(Buffer.concat(raw))
            : new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength);
        if (nextBinaryIsWav) {
          nextBinaryIsWav = false;
          const decoded = decodeWav(bytes);
          const frames = splitRealtimeFrame(floatAudioToRealtimeFrame(decoded));
          log("fixture.decoded", {
            bytes: bytes.byteLength,
            frames: frames.length,
            sampleRate: decoded.sampleRate,
            channels: decoded.channels,
          });
          for (const frame of frames) {
            pushInbound(frame);
            await delay(20);
          }
        } else {
          const copy = bytes.slice();
          if (copy.byteLength % 4 !== 0) throw new Error("Microphone frame is not Float32 audio");
          const frame = floatAudioToRealtimeFrame({
            samples: new Float32Array(copy.buffer),
            sampleRate: inputSampleRate,
            channels: inputChannels,
          });
          pushInbound(frame);
        }
      } catch (error) {
        log("error", { error: errorMessage(error) });
      }
    })();
  });

  socket.on("error", (error) => log("websocket.error", { error: error.message }));
  socket.on("close", () => {
    inbound.end();
    void session?.close();
    console.log(JSON.stringify({ callId, timestamp: new Date().toISOString(), event: "harness.disconnected" }));
  });

  function pushInbound(frame: AudioFrame): void {
    inboundFrames += 1;
    log("audio.in", { bytes: frame.data.byteLength, frames: inboundFrames });
    inbound.push(frame);
  }
}

function observeRuntimeEvent(
  event: ConversationRuntimeEvent,
  log: (event: string, metadata?: Record<string, unknown>) => void,
): void {
  switch (event.type) {
    case "audio.delta":
      return;
    case "assistant.transcript":
      log(event.type, transcriptEnabled ? { final: event.final, transcript: event.text } : { final: event.final });
      return;
    case "error":
      log(event.type, { code: event.code, retryable: event.retryable, error: event.message });
      return;
    case "usage":
      log(event.type, { ...event });
      return;
    default:
      log(event.type);
  }
}

class AudioQueue implements AsyncIterable<AudioFrame> {
  private readonly values: AudioFrame[] = [];
  private readonly readers: Array<(value: IteratorResult<AudioFrame>) => void> = [];
  private ended = false;

  push(frame: AudioFrame): void {
    if (this.ended) return;
    const reader = this.readers.shift();
    if (reader) reader({ value: frame, done: false });
    else this.values.push(frame);
  }

  end(): void {
    if (this.ended) return;
    this.ended = true;
    for (const reader of this.readers.splice(0)) reader({ value: undefined, done: true });
  }

  [Symbol.asyncIterator](): AsyncIterator<AudioFrame> {
    return {
      next: () => {
        const value = this.values.shift();
        if (value) return Promise.resolve({ value, done: false });
        if (this.ended) return Promise.resolve({ value: undefined, done: true });
        return new Promise((resolve) => this.readers.push(resolve));
      },
    };
  }
}

function positiveNumber(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) throw new Error(`${name} must be positive`);
  return value;
}

const delay = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const errorMessage = (error: unknown) => error instanceof Error ? error.message : "Unexpected harness error";
