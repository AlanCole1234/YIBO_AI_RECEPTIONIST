import { performance } from "node:perf_hooks";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ConversationService, OpenAIRealtimeAdapter, type AudioFrame, type ConversationRuntimeSession,
  type ConversationTransport, type RealtimeConnection } from "../../src/modules/conversation/index.js";
import type { AgentDefinition, ToolExecutor } from "../../src/modules/agents/index.js";
import { PcmuRtpPacer } from "../../src/modules/telephony/infrastructure/asterisk/asterisk-rtp-voice-media-gateway.js";
import { RealtimeToUlawStream } from "../../src/modules/voice/index.js";

const cleanup: Array<() => Promise<void>> = [];
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
  vi.spyOn(performance, "now").mockImplementation(() => Date.now());
});
afterEach(async () => {
  for (const close of cleanup.splice(0)) await close();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function pcm(samples = 480, level = 3000): AudioFrame {
  const data = Buffer.alloc(samples * 2);
  for (let offset = 0; offset < data.length; offset += 2) data.writeInt16LE(level, offset);
  return { data, codec: "pcm_s16le", sampleRate: 24_000, channels: 1 };
}

async function fixture() {
  const sent: Array<Record<string, any>> = [];
  const logs: Array<{ message: string; details?: Record<string, unknown> }> = [];
  let receive!: (event: unknown) => void;
  const connection: RealtimeConnection = {
    send: event => { sent.push(event as Record<string, any>); }, close: vi.fn(),
    onEvent: handler => { receive = handler; }, onError: () => {}, onClose: () => {},
  };
  const adapter = new OpenAIRealtimeAdapter({ apiKey: "synthetic", mode: "audio",
    connectionFactory: { connect: async () => connection },
    logger: { info: (message, details) => logs.push({ message, details }), error: () => {} } });
  let runtime!: ConversationRuntimeSession;
  let idle: (() => void) | undefined;
  let playingTurn: string | undefined;
  const packets: Uint8Array[] = [];
  const pacer = new PcmuRtpPacer({ callId: "synthetic-call", monotonicNow: () => Date.now(), log: () => {},
    send: async (payload, _turn, _depth, timing) => {
      packets.push(payload.slice());
      if (timing.queueBecameEmpty) { playingTurn = undefined; idle?.(); }
    } });
  const converter = new RealtimeToUlawStream();
  const transport: ConversationTransport = {
    inboundAudio: (async function* () {})(),
    outboundAudio: {
      write: async (frame, turn) => { playingTurn = turn; pacer.enqueue(converter.convert(frame), turn); },
      // The production sink must receive the same provider completion boundary.
      complete: (turn?: string) => {
        if (turn) pacer.complete(turn);
      },
      onPlaybackIdle: listener => { idle = listener; return () => { idle = undefined; }; },
      interrupt: async () => {
        if (!playingTurn) return undefined;
        const position = { assistantTurnId: playingTurn, audioEndMs: packets.length * 20 };
        pacer.clear("barge_in"); playingTurn = undefined; idle?.(); return position;
      },
    },
    close: async () => { pacer.stop("call_closed"); },
  };
  const execute = vi.fn<ToolExecutor["execute"]>(async (_context, call) => ({ toolCallId: call.toolCallId, ok: true as const, data: { slots: [] } }));
  const agent: AgentDefinition = {
    instructions: "Ask when the caller wants to come in, then check availability.", locale: "en-US",
    conversation: { model: "synthetic", maxOutputTokens: 512, reasoningEffort: "minimal", turnDetection: {} },
    trustedContext: { tenantId: "synthetic", callId: "synthetic-call", customerId: "synthetic" },
    tools: [{ name: "check_availability", description: "Check availability", inputSchema: { type: "object" } }],
    toolExecutor: { execute },
  };
  const service = new ConversationService({ runtime: { openSession: async input => {
    runtime = await adapter.openSession(input); return runtime;
  } } });
  const session = await service.start({ conversationId: "synthetic-call", agent, transport });
  cleanup.push(() => session.close());
  const response = (id: string, samples: number) => {
    receive({ type: "response.created", response: { id } });
    receive({ type: "response.output_audio.delta", item_id: id, content_index: 0, delta: Buffer.from(pcm(samples).data).toString("base64") });
  };
  const done = (id: string) => {
    receive({ type: "response.output_audio.done", item_id: id });
    receive({ type: "response.done", response: { id, status: "completed" } });
  };
  return { runtime, receive, sent, logs, packets, pacer, session, execute, connection, response, done };
}

it("finishes a partial RTP tail, hears the short answer, reaches availability, and stays open", async () => {
  const f = await fixture();
  f.response("when-would-you-like-to-come-in", 2640); // 880 PCMU bytes: five packets plus an 80-byte tail.
  f.done("when-would-you-like-to-come-in");
  await vi.advanceTimersByTimeAsync(300);
  expect(f.pacer.queueDepth()).toBe(0);
  expect(f.packets).toHaveLength(6);
  expect([...f.packets[5]!.slice(80)]).toEqual(Array(80).fill(0xff)); // PCMU silence, not a dropped tail.
  expect(f.logs).toContainEqual(expect.objectContaining({ message: "OpenAI Realtime turn state changed",
    details: expect.objectContaining({ to: "listening" }) }));

  f.receive({ type: "input_audio_buffer.speech_started", item_id: "friday" });
  for (let i = 0; i < 6; i++) await f.runtime.sendAudio!(pcm(480, 500)); // short/quiet is valid after playback.
  f.receive({ type: "input_audio_buffer.speech_stopped", item_id: "friday" });
  f.receive({ type: "input_audio_buffer.committed", item_id: "friday" });
  await vi.advanceTimersByTimeAsync(100);
  expect(f.sent.filter(e => e.type === "response.create")).toHaveLength(1);
  expect(f.sent.filter(e => e.type === "response.cancel")).toHaveLength(0);
  expect(f.sent.filter(e => e.type === "input_audio_buffer.append")).toHaveLength(6);
  f.receive({ type: "response.created", response: { id: "availability" } });
  f.receive({ type: "response.function_call_arguments.done", call_id: "check", name: "check_availability", arguments: "{}" });
  f.receive({ type: "response.done", response: { id: "availability", status: "completed" } });
  await vi.advanceTimersByTimeAsync(1);
  expect(f.execute).toHaveBeenCalledTimes(1);
  f.response("available-times", 960);
  f.done("available-times");
  await vi.advanceTimersByTimeAsync(16_000);
  expect(f.connection.close).not.toHaveBeenCalled();
  expect(f.sent.filter(e => e.type === "response.cancel")).toHaveLength(0);
});

it("accounts for the audio of an accepted barge-in and cancels the active response only once", async () => {
  const f = await fixture();
  f.response("long-prompt", 48_000);
  await vi.advanceTimersByTimeAsync(150);
  for (let i = 0; i < 12; i++) await f.runtime.sendAudio!(pcm());
  f.receive({ type: "input_audio_buffer.speech_started", item_id: "tuesday" });
  await vi.advanceTimersByTimeAsync(0);
  for (let i = 0; i < 3; i++) await f.runtime.sendAudio!(pcm());
  f.receive({ type: "response.done", response: { id: "long-prompt", status: "cancelled" } });
  f.receive({ type: "input_audio_buffer.speech_stopped", item_id: "tuesday" });
  f.receive({ type: "input_audio_buffer.committed", item_id: "tuesday" });
  await vi.advanceTimersByTimeAsync(100);
  expect(f.sent.filter(e => e.type === "response.cancel")).toHaveLength(1);
  expect(f.sent.filter(e => e.type === "input_audio_buffer.append")).toHaveLength(15);
  expect(f.logs.find(log => log.message === "telephony.turn.user_audio_summary")?.details).toMatchObject({
    audioFramesSentToOpenAI: 15, audioDurationMs: 300, speechDetected: true, speechCommitted: true, responseRequested: true,
  });
});

it("does not hang up on the playback watchdog while waiting for an answer after a completed prompt", async () => {
  const f = await fixture();
  f.response("completed-question", 2640);
  f.done("completed-question");
  await vi.advanceTimersByTimeAsync(16_000);
  expect(f.connection.close).not.toHaveBeenCalled();
  expect(f.sent.filter(e => ["response.create", "response.cancel"].includes(e.type))).toHaveLength(0);
  expect(f.pacer.queueDepth()).toBe(0);
});

it("rejects brief noise during real playback, then accepts a short reply after playback drains", async () => {
  const f = await fixture();
  f.response("prompt", 48_000);
  await vi.advanceTimersByTimeAsync(150);
  f.receive({ type: "input_audio_buffer.speech_started", item_id: "noise" });
  for (let i = 0; i < 3; i++) await f.runtime.sendAudio!(pcm(480, 0));
  f.receive({ type: "input_audio_buffer.speech_stopped", item_id: "noise" });
  f.receive({ type: "input_audio_buffer.committed", item_id: "noise" });
  f.done("prompt");
  await vi.advanceTimersByTimeAsync(100);
  expect(f.pacer.queueDepth()).toBeGreaterThan(0);
  expect(f.sent.filter(e => ["response.create", "response.cancel"].includes(e.type))).toHaveLength(0);
  expect(f.logs.find(log => log.message === "telephony.barge_in.rejected")?.details?.reason).toBe("speech_stopped_before_confirmation");
  await vi.advanceTimersByTimeAsync(2000);
  expect(f.pacer.queueDepth()).toBe(0);
  f.receive({ type: "input_audio_buffer.speech_started", item_id: "real-answer" });
  for (let i = 0; i < 6; i++) await f.runtime.sendAudio!(pcm(480, 500));
  f.receive({ type: "input_audio_buffer.speech_stopped", item_id: "real-answer" });
  f.receive({ type: "input_audio_buffer.committed", item_id: "real-answer" });
  await vi.advanceTimersByTimeAsync(100);
  expect(f.sent.filter(e => e.type === "response.create")).toHaveLength(1);
  expect(f.sent.filter(e => e.type === "response.cancel")).toHaveLength(0);
});
