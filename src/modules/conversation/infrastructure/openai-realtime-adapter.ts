import OpenAI from "openai";
import { OpenAIRealtimeWS } from "openai/realtime/ws";
import type { RealtimeClientEvent, RealtimeServerEvent } from "openai/resources/realtime/realtime";
import type {
  ConversationRuntimeEvent,
  AssistantPlaybackPosition,
  ConversationRuntimePort,
  ConversationRuntimeSession,
  OpenConversationInput,
  ToolResultEnvelope,
} from "../ports/conversation-runtime-port.js";
import type { AudioFrame } from "../ports/conversation-runtime-port.js";

const DEFAULT_MAX_OUTPUT_TOKENS = 512;

export interface OpenAIRealtimeAdapterOptions {
  apiKey: string;
  model?: string;
  maxOutputTokens?: number;
  mode?: "text" | "audio";
  turnDetection?: ServerTurnDetectionOptions;
  logger?: RealtimeErrorLogger;
  connectionFactory?: RealtimeConnectionFactory;
}

export interface ServerTurnDetectionOptions {
  type?: "server_vad";
  threshold?: number;
  prefixPaddingMs?: number;
  silenceDurationMs?: number;
}

export interface RealtimeErrorLogger {
  error(message: string, details?: { code?: string }): void;
}

export interface RealtimeConnectionFactory {
  connect(input: { apiKey: string; model: string }): Promise<RealtimeConnection>;
}

export interface RealtimeConnection {
  send(event: unknown): void;
  close(): void;
  onEvent(handler: (event: unknown) => void): void;
  onError(handler: (error: { message: string; code?: string }) => void): void;
  onClose(handler: (reason?: string) => void): void;
}

export class OpenAIRealtimeAdapter implements ConversationRuntimePort {
  private readonly model: string;
  private readonly maxOutputTokens: number;
  private readonly mode: "text" | "audio";
  private readonly turnDetection: ServerTurnDetectionOptions;
  private readonly logger: RealtimeErrorLogger;
  private readonly connectionFactory: RealtimeConnectionFactory;

  constructor(private readonly options: OpenAIRealtimeAdapterOptions) {
    if (!options.apiKey.trim()) throw new Error("OpenAIRealtimeAdapter requires an API key");
    this.model = options.model?.trim() || "gpt-realtime-2.1";
    this.maxOutputTokens = options.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS;
    this.mode = options.mode ?? "audio";
    this.turnDetection = validateTurnDetection(options.turnDetection ?? {});
    if (!Number.isInteger(this.maxOutputTokens) || this.maxOutputTokens < 1 || this.maxOutputTokens > 4096) {
      throw new Error("maxOutputTokens must be an integer between 1 and 4096");
    }
    this.logger = options.logger ?? consoleLogger;
    this.connectionFactory = options.connectionFactory ?? sdkConnectionFactory;
  }

  async openSession(input: OpenConversationInput): Promise<ConversationRuntimeSession> {
    const model = input.agent.conversation.model || this.model;
    const maxOutputTokens = input.agent.conversation.maxOutputTokens || this.maxOutputTokens;
    const turnDetection = validateTurnDetection(input.agent.conversation.turnDetection);
    const threshold = turnDetection.threshold ?? this.turnDetection.threshold;
    const prefixPaddingMs = turnDetection.prefixPaddingMs ?? this.turnDetection.prefixPaddingMs;
    const silenceDurationMs = turnDetection.silenceDurationMs ?? this.turnDetection.silenceDurationMs;
    let connection: RealtimeConnection;
    try {
      connection = await this.connectionFactory.connect({
        apiKey: this.options.apiKey,
        model,
      });
    } catch (error) {
      this.logger.error("OpenAI Realtime WebSocket connection failed", { code: "CONNECTION_FAILED" });
      throw error;
    }
    const session = new OpenAIRealtimeSession(connection, input, this.logger, this.mode);
    connection.send({
      type: "session.update",
      session: {
        type: "realtime",
        model,
        output_modalities: [this.mode],
        instructions: [
          input.agent.instructions,
          "Keep responses concise, but always finish the current sentence naturally.",
          "Speak warmly and conversationally, with natural phrasing and without sounding scripted.",
        ].join("\n"),
        ...(this.mode === "audio" ? {
          audio: {
            input: {
              format: { type: "audio/pcm", rate: 24_000 },
              noise_reduction: { type: "near_field" },
              turn_detection: {
                type: this.turnDetection.type ?? "server_vad",
                create_response: true,
                interrupt_response: false,
                ...(threshold === undefined ? {} : { threshold }),
                ...(prefixPaddingMs === undefined ? {} : { prefix_padding_ms: prefixPaddingMs }),
                ...(silenceDurationMs === undefined ? {} : { silence_duration_ms: silenceDurationMs }),
              },
            },
            output: {
              format: { type: "audio/pcm", rate: 24_000 },
              voice: input.agent.voice ?? "marin",
            },
          },
        } : {}),
        tools: input.agent.tools.map((tool) => ({
          type: "function",
          name: tool.name,
          description: tool.description,
          parameters: tool.inputSchema,
        })),
        tool_choice: "auto",
        parallel_tool_calls: false,
        max_output_tokens: maxOutputTokens,
        reasoning: { effort: input.agent.conversation.reasoningEffort },
        tracing: null,
      },
    });
    return session;
  }
}

class OpenAIRealtimeSession implements ConversationRuntimeSession {
  private readonly queue = new AsyncEventQueue<ConversationRuntimeEvent>();
  private readonly allowedTools: Set<string>;
  private closed = false;
  private readonly audioContentIndexes = new Map<string, number>();

  constructor(
    private readonly connection: RealtimeConnection,
    input: OpenConversationInput,
    private readonly logger: RealtimeErrorLogger,
    private readonly mode: "text" | "audio",
  ) {
    this.allowedTools = new Set(input.agent.tools.map((tool) => tool.name));
    connection.onEvent((event) => this.handleEvent(event));
    connection.onError((error) => this.handleError(error));
    connection.onClose((reason) => this.finish(reason));
  }

  async sendText(text: string): Promise<void> {
    const normalized = text.trim();
    if (!normalized) throw new Error("Conversation text must not be empty");
    this.assertOpen();
    this.connection.send({
      type: "conversation.item.create",
      item: {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: normalized }],
      },
    });
    this.connection.send({ type: "response.create" });
  }

  async sendAudio(frame: AudioFrame): Promise<void> {
    this.assertOpen();
    if (this.mode !== "audio") {
      throw new Error("OpenAIRealtimeAdapter is configured for text-only input and output");
    }
    if (frame.codec !== "pcm_s16le" || frame.sampleRate !== 24_000 || frame.channels !== 1) {
      throw new Error("OpenAI Realtime audio requires mono pcm_s16le at 24000 Hz");
    }
    this.connection.send({
      type: "input_audio_buffer.append",
      audio: Buffer.from(frame.data).toString("base64"),
    });
  }

  async sendToolResult(result: ToolResultEnvelope): Promise<void> {
    this.assertOpen();
    this.connection.send({
      type: "conversation.item.create",
      item: {
        type: "function_call_output",
        call_id: result.toolCallId,
        output: JSON.stringify(result.ok
          ? { ok: true, data: result.data }
          : { ok: false, error: result.error }),
      },
    });
    this.connection.send({ type: "response.create" });
  }

  async interrupt(position?: AssistantPlaybackPosition): Promise<void> {
    this.assertOpen();
    this.connection.send({ type: "response.cancel" });
    if (position) {
      this.connection.send({
        type: "conversation.item.truncate",
        item_id: position.assistantTurnId,
        content_index: this.audioContentIndexes.get(position.assistantTurnId) ?? 0,
        audio_end_ms: Math.max(0, Math.round(position.audioEndMs)),
      });
    }
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.connection.close();
    this.queue.push({ type: "closed", reason: "client_closed" });
    this.queue.end();
  }

  events(): AsyncIterable<ConversationRuntimeEvent> {
    return this.queue;
  }

  private handleEvent(value: unknown): void {
    if (this.closed || !isRecord(value) || typeof value.type !== "string") return;
    switch (value.type) {
      case "response.output_text.delta":
        if (typeof value.delta === "string") {
          this.queue.push({ type: "assistant.transcript", text: value.delta, final: false });
        }
        return;
      case "response.output_text.done":
        if (typeof value.text === "string") {
          this.queue.push({ type: "assistant.transcript", text: value.text, final: true });
        }
        return;
      case "response.output_audio.delta":
        if (typeof value.delta === "string" && typeof value.item_id === "string") {
          if (typeof value.content_index === "number") {
            this.audioContentIndexes.set(value.item_id, value.content_index);
          }
          this.queue.push({
            type: "audio.delta",
            assistantTurnId: value.item_id,
            frame: {
              data: Buffer.from(value.delta, "base64"),
              codec: "pcm_s16le",
              sampleRate: 24_000,
              channels: 1,
            },
          });
        }
        return;
      case "response.output_audio_transcript.delta":
        if (typeof value.delta === "string") {
          this.queue.push({ type: "assistant.transcript", text: value.delta, final: false });
        }
        return;
      case "response.output_audio_transcript.done":
        if (typeof value.transcript === "string") {
          this.queue.push({ type: "assistant.transcript", text: value.transcript, final: true });
        }
        return;
      case "response.function_call_arguments.done":
        this.handleToolCall(value);
        return;
      case "input_audio_buffer.speech_started":
        this.queue.push({ type: "user.speech_started" });
        return;
      case "input_audio_buffer.speech_stopped":
        this.queue.push({ type: "user.speech_stopped" });
        return;
      case "response.done":
        this.handleUsage(value.response);
        return;
      case "error":
        this.handleProviderEventError(value.error);
        return;
    }
  }

  private handleToolCall(event: Record<string, unknown>): void {
    if (typeof event.call_id !== "string" || typeof event.name !== "string" || typeof event.arguments !== "string") {
      this.emitError("INVALID_TOOL_CALL", "The runtime returned an incomplete tool call", false);
      return;
    }
    if (!this.allowedTools.has(event.name)) {
      this.emitError("UNKNOWN_TOOL", `The runtime requested an unknown tool: ${event.name}`, false);
      return;
    }
    let argumentsValue: unknown;
    try {
      argumentsValue = JSON.parse(event.arguments);
    } catch {
      this.emitError("INVALID_TOOL_ARGUMENTS", "The runtime returned invalid JSON tool arguments", false);
      return;
    }
    this.queue.push({
      type: "tool.call",
      toolCallId: event.call_id,
      name: event.name as "check_availability" | "create_appointment" | "cancel_appointment" | "transfer_to_human",
      arguments: argumentsValue,
    });
  }

  private handleUsage(response: unknown): void {
    if (!isRecord(response) || !isRecord(response.usage)) return;
    const usage = response.usage;
    const inputDetails = isRecord(usage.input_token_details) ? usage.input_token_details : {};
    const outputDetails = isRecord(usage.output_token_details) ? usage.output_token_details : {};
    const output = Array.isArray(response.output) ? response.output : [];
    this.queue.push({
      type: "usage",
      ...(number(usage.input_tokens) ? { inputTokens: usage.input_tokens as number } : {}),
      ...(number(usage.output_tokens) ? { outputTokens: usage.output_tokens as number } : {}),
      ...(number(usage.total_tokens) ? { totalTokens: usage.total_tokens as number } : {}),
      ...(number(inputDetails.audio_tokens) ? { inputAudioMs: (inputDetails.audio_tokens as number) * 100 } : {}),
      ...(number(outputDetails.audio_tokens) ? { outputAudioMs: (outputDetails.audio_tokens as number) * 50 } : {}),
      toolCalls: output.filter((item) => isRecord(item) && item.type === "function_call").length,
    });
  }

  private handleProviderEventError(value: unknown): void {
    const error = isRecord(value) ? value : {};
    const code = typeof error.code === "string" ? error.code : "REALTIME_ERROR";
    const message = typeof error.message === "string" ? error.message : "Realtime session error";
    this.logAndEmit(code, message, true);
  }

  private handleError(error: { message: string; code?: string }): void {
    this.logAndEmit(error.code ?? "WEBSOCKET_ERROR", error.message, true);
  }

  private logAndEmit(code: string, message: string, retryable: boolean): void {
    this.logger.error("OpenAI Realtime WebSocket error", { code });
    this.emitError(code, message, retryable);
  }

  private emitError(code: string, message: string, retryable: boolean): void {
    if (!this.closed) this.queue.push({ type: "error", code, message, retryable });
  }

  private finish(reason?: string): void {
    if (this.closed) return;
    this.closed = true;
    this.queue.push({ type: "closed", ...(reason ? { reason } : {}) });
    this.queue.end();
  }

  private assertOpen(): void {
    if (this.closed) throw new Error("Conversation runtime session is closed");
  }
}

class SDKRealtimeConnection implements RealtimeConnection {
  private readonly realtime: OpenAIRealtimeWS;
  private readonly opened: Promise<void>;

  constructor(input: { apiKey: string; model: string }) {
    const client = new OpenAI({ apiKey: input.apiKey });
    this.realtime = new OpenAIRealtimeWS({ model: input.model }, client);
    this.opened = new Promise((resolve, reject) => {
      const onOpen = () => { cleanup(); resolve(); };
      const onError = (error: Error) => { cleanup(); reject(error); };
      const cleanup = () => {
        this.realtime.socket.off("open", onOpen);
        this.realtime.socket.off("error", onError);
      };
      this.realtime.socket.once("open", onOpen);
      this.realtime.socket.once("error", onError);
    });
  }

  async waitUntilOpen(): Promise<void> {
    await this.opened;
  }

  send(event: unknown): void {
    this.realtime.send(event as RealtimeClientEvent);
  }

  close(): void {
    this.realtime.close();
  }

  onEvent(handler: (event: unknown) => void): void {
    this.realtime.on("event", (event: RealtimeServerEvent) => handler(event));
  }

  onError(handler: (error: { message: string; code?: string }) => void): void {
    this.realtime.on("error", (error) => handler({
      message: error.message,
      ...(error.error?.code ? { code: error.error.code } : {}),
    }));
  }

  onClose(handler: (reason?: string) => void): void {
    this.realtime.socket.on("close", (_code, reason) => handler(reason.toString() || undefined));
  }
}

const sdkConnectionFactory: RealtimeConnectionFactory = {
  connect: async (input) => {
    const connection = new SDKRealtimeConnection(input);
    await connection.waitUntilOpen();
    return connection;
  },
};

const consoleLogger: RealtimeErrorLogger = {
  error: (message, details) => console.error(message, details ?? {}),
};

class AsyncEventQueue<T> implements AsyncIterable<T> {
  private readonly values: T[] = [];
  private readonly readers: Array<(result: IteratorResult<T>) => void> = [];
  private ended = false;

  push(value: T): void {
    if (this.ended) return;
    const reader = this.readers.shift();
    if (reader) reader({ value, done: false });
    else this.values.push(value);
  }

  end(): void {
    if (this.ended) return;
    this.ended = true;
    for (const reader of this.readers.splice(0)) reader({ value: undefined, done: true });
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: () => {
        const value = this.values.shift();
        if (value !== undefined) return Promise.resolve({ value, done: false });
        if (this.ended) return Promise.resolve({ value: undefined, done: true });
        return new Promise((resolve) => this.readers.push(resolve));
      },
    };
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const number = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

function validateTurnDetection(options: ServerTurnDetectionOptions): ServerTurnDetectionOptions {
  if (options.threshold !== undefined && (options.threshold < 0 || options.threshold > 1)) {
    throw new Error("VAD threshold must be between 0 and 1");
  }
  for (const [name, value] of [
    ["prefixPaddingMs", options.prefixPaddingMs],
    ["silenceDurationMs", options.silenceDurationMs],
  ] as const) {
    if (value !== undefined && (!Number.isInteger(value) || value < 0)) {
      throw new Error(`${name} must be a non-negative integer`);
    }
  }
  return { ...options };
}
