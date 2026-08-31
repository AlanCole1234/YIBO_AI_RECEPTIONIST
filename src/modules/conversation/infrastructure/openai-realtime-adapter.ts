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
const DEFAULT_VAD_SILENCE_DURATION_MS = 800;
const DEFAULT_IDLE_TIMEOUT_MS = 6_000;

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
  info?(message: string, details?: Record<string, unknown>): void;
  error(message: string, details?: { code?: string; error?: string }): void;
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
    const silenceDurationMs = turnDetection.silenceDurationMs ?? this.turnDetection.silenceDurationMs ?? DEFAULT_VAD_SILENCE_DURATION_MS;
    let connection: RealtimeConnection;
    this.logger.info?.("OpenAI Realtime connection starting", { model, mode: this.mode });
    try {
      connection = await this.connectionFactory.connect({
        apiKey: this.options.apiKey,
        model,
      });
    } catch (error) {
      this.logger.error("OpenAI Realtime WebSocket connection failed", connectionErrorDetails(error));
      throw error;
    }
    this.logger.info?.("OpenAI Realtime connection established", { model, mode: this.mode });
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
          input.agent.tools.some((tool) => tool.name === "check_availability")
            ? "You have authorized access to the clinic calendar only through the provided backend tools. Never claim you cannot access the calendar directly; call check_availability whenever a caller asks about dates or availability. Use the tool result as the sole source of appointment times. Do not ask callers for service IDs or internal names. Use the optional patient-facing service field only for Cleaning or Consultation; omit it to use the clinic default. If a tool result says requestedTimeAvailable is true, clearly say that time is available; if false, say it is unavailable and offer earliestSlot. Never reveal why a time is busy or any other patient's details."
            : "Do not claim calendar access when a calendar tool is not provided.",
          "For a new booking, first ask exactly one question: 'What day would you like to come in?' Do not ask for a time of day, service, or personal details first. For supported natural dates, call check_availability with dateExpression; it resolves the actual date in the clinic timezone and checks the real Google Calendar. Offer only earliestSlot first, in one short sentence. After the caller accepts, collect the required contact details when update_customer is available, then use create_appointment and only confirm it after the tool succeeds. After an idle caller turn, offer one gentle, brief prompt; do not repeatedly prompt when the caller remains silent.",
          input.agent.tools.some((tool) => tool.name === "update_customer")
            ? "After the caller accepts a verified time, ask exactly one question at a time: first 'What's your first and last name?', then 'What's the best phone number to reach you?', then 'Is this for a cleaning or a consultation?'. After name and phone are collected, call update_customer. Use the caller's Cleaning or Consultation answer as the service argument for create_appointment; never expose IDs. Do not ask for symptoms or medical details."
            : "",
        ].filter(Boolean).join("\n"),
        ...(this.mode === "audio" ? {
          audio: {
            input: {
              format: { type: "audio/pcm", rate: 24_000 },
              noise_reduction: { type: "near_field" },
              turn_detection: {
                type: this.turnDetection.type ?? "server_vad",
                create_response: true,
                interrupt_response: true,
                idle_timeout_ms: DEFAULT_IDLE_TIMEOUT_MS,
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
    this.logger.info?.("OpenAI Realtime session.update sent", {
      model,
      mode: this.mode,
      outputAudioFormat: this.mode === "audio" ? "pcm_s16le/24000/mono" : undefined,
      turnDetection: this.mode === "audio" ? {
        type: this.turnDetection.type ?? "server_vad",
        createResponse: true,
        interruptResponse: true,
        idleTimeoutMs: DEFAULT_IDLE_TIMEOUT_MS,
        ...(threshold === undefined ? {} : { threshold }),
        ...(prefixPaddingMs === undefined ? {} : { prefixPaddingMs }),
        ...(silenceDurationMs === undefined ? {} : { silenceDurationMs }),
      } : undefined,
    });
    return session;
  }
}

class OpenAIRealtimeSession implements ConversationRuntimeSession {
  private readonly queue = new AsyncEventQueue<ConversationRuntimeEvent>();
  private readonly allowedTools: Set<string>;
  private closed = false;
  private readonly audioContentIndexes = new Map<string, number>();
  private readonly truncatedAssistantTurns = new Set<string>();
  private state: RealtimeTurnState = "listening";
  private activeResponseId?: string;
  private toolResponsePending = false;
  private inputAudioFrames = 0;
  private callerIsSpeaking = false;

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
    this.logger.info?.("OpenAI Realtime response.create sent", { source: "text_turn" });
    this.connection.send({ type: "response.create" });
    this.setState("thinking", { source: "text_turn" });
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
    this.inputAudioFrames += 1;
    if (process.env.YIBO_VOICE_DEBUG === "1" || this.inputAudioFrames === 1) {
      this.logger.info?.("OpenAI Realtime input_audio_buffer.append sent", {
        bytes: frame.data.byteLength,
        sampleRate: frame.sampleRate,
        channels: frame.channels,
        frames: this.inputAudioFrames,
        ...(process.env.YIBO_VOICE_DEBUG === "1" ? { debug: true } : {}),
      });
    }
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
    if (this.callerIsSpeaking) {
      this.logger.info?.("OpenAI Realtime tool result will be included in the caller's next server-VAD response", { state: this.state });
      return;
    }
    if (this.activeResponseId) {
      this.toolResponsePending = true;
      this.logger.info?.("OpenAI Realtime tool result queued until the active response completes", { state: this.state });
      return;
    }
    this.connection.send({ type: "response.create" });
    this.logger.info?.("OpenAI Realtime response.create sent", { source: "tool_result" });
    this.setState("thinking", { source: "tool_result" });
  }

  async interrupt(position?: AssistantPlaybackPosition): Promise<void> {
    this.assertOpen();
    // With interrupt_response=true, OpenAI cancels the response on VAD speech start.
    // We only synchronize the amount of audio the caller actually heard.
    if (!position || this.truncatedAssistantTurns.has(position.assistantTurnId)) return;
    this.truncatedAssistantTurns.add(position.assistantTurnId);
    this.setState("interrupted", { assistantTurnId: position.assistantTurnId, source: "local_playback_clear" });
    this.connection.send({
      type: "conversation.item.truncate",
      item_id: position.assistantTurnId,
      content_index: this.audioContentIndexes.get(position.assistantTurnId) ?? 0,
      audio_end_ms: Math.max(0, Math.round(position.audioEndMs)),
    });
    this.logger.info?.("OpenAI Realtime assistant audio truncated", {
      assistantTurnId: position.assistantTurnId,
      audioEndMs: Math.max(0, Math.round(position.audioEndMs)),
    });
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.logger.info?.("OpenAI Realtime connection closing", { reason: "client_closed" });
    this.connection.close();
    this.queue.push({ type: "closed", reason: "client_closed" });
    this.queue.end();
  }

  events(): AsyncIterable<ConversationRuntimeEvent> {
    return this.queue;
  }

  private handleEvent(value: unknown): void {
    if (this.closed || !isRecord(value) || typeof value.type !== "string") return;
    this.logger.info?.("OpenAI Realtime event received", eventLogDetails(value));
    switch (value.type) {
      case "session.created":
        this.logger.info?.("OpenAI Realtime session created", sessionLogDetails(value));
        return;
      case "session.updated":
        this.logger.info?.("OpenAI Realtime session configuration accepted", sessionLogDetails(value));
        return;
      case "input_audio_buffer.committed":
        this.logger.info?.("OpenAI Realtime input audio buffer committed", eventLogDetails(value));
        return;
      case "input_audio_buffer.timeout_triggered":
        this.logger.info?.("OpenAI Realtime idle timeout triggered", eventLogDetails(value));
        this.queue.push({ type: "silence.timeout" });
        return;
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
          this.setState("assistant_speaking", { assistantTurnId: value.item_id });
        }
        return;
      case "response.output_audio.done":
        this.logger.info?.("OpenAI Realtime assistant audio completed", eventLogDetails(value));
        this.queue.push({ type: "assistant.audio_completed", ...(typeof value.item_id === "string" ? { assistantTurnId: value.item_id } : {}) });
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
        this.logger.info?.("OpenAI Realtime speech started", eventLogDetails(value));
        this.callerIsSpeaking = true;
        this.setState("user_speaking", { source: "server_vad" });
        this.queue.push({ type: "user.speech_started" });
        return;
      case "input_audio_buffer.speech_stopped":
        this.logger.info?.("OpenAI Realtime speech stopped", eventLogDetails(value));
        this.callerIsSpeaking = false;
        this.setState("thinking", { source: "server_vad" });
        this.queue.push({ type: "user.speech_stopped" });
        return;
      case "response.created":
        this.logger.info?.("OpenAI Realtime response created", eventLogDetails(value));
        this.activeResponseId = responseId(value);
        this.setState("thinking", { ...(this.activeResponseId ? { responseId: this.activeResponseId } : {}) });
        this.queue.push({ type: "assistant.response_created", ...(this.activeResponseId ? { responseId: this.activeResponseId } : {}) });
        return;
      case "response.done":
        this.logger.info?.("OpenAI Realtime response done", eventLogDetails(value));
        const status = responseStatus(value);
        if (status === "cancelled") this.logger.info?.("OpenAI Realtime response cancelled", eventLogDetails(value));
        this.activeResponseId = undefined;
        if (status === "cancelled") this.toolResponsePending = false;
        // A cancellation can arrive after the caller has already started speaking.
        // Preserve that fact so a late tool result cannot start a competing response.
        this.setState(this.callerIsSpeaking ? "user_speaking" : "listening", { reason: status ?? "done" });
        this.logger.info?.("OpenAI Realtime response state reset", { reason: status ?? "done" });
        this.queue.push({ type: "assistant.response_done", ...(status ? { status } : {}) });
        this.handleUsage(value.response);
        if (this.toolResponsePending && !this.callerIsSpeaking && status !== "cancelled") {
          this.toolResponsePending = false;
          this.connection.send({ type: "response.create" });
          this.logger.info?.("OpenAI Realtime response.create sent", { source: "queued_tool_result" });
          this.setState("thinking", { source: "queued_tool_result" });
        }
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
      name: event.name as "check_availability" | "create_appointment" | "update_customer" | "cancel_appointment" | "transfer_to_human",
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
    this.logger.error("OpenAI Realtime WebSocket error", { code, error: redactCredential(message) });
    this.emitError(code, message, retryable);
  }

  private emitError(code: string, message: string, retryable: boolean): void {
    if (!this.closed) this.queue.push({ type: "error", code, message, retryable });
  }

  private finish(reason?: string): void {
    if (this.closed) return;
    this.closed = true;
    this.logger.info?.("OpenAI Realtime connection closed", { ...(reason ? { reason } : {}) });
    this.queue.push({ type: "closed", ...(reason ? { reason } : {}) });
    this.queue.end();
  }

  private assertOpen(): void {
    if (this.closed) throw new Error("Conversation runtime session is closed");
  }

  private setState(next: RealtimeTurnState, details: Record<string, unknown> = {}): void {
    if (this.state === next) return;
    const previous = this.state;
    this.state = next;
    this.logger.info?.("OpenAI Realtime turn state changed", { from: previous, to: next, ...details });
  }
}

type RealtimeTurnState = "listening" | "user_speaking" | "thinking" | "assistant_speaking" | "interrupted";

class SDKRealtimeConnection implements RealtimeConnection {
  private readonly realtime: OpenAIRealtimeWS;
  private readonly opened: Promise<void>;
  private eventHandler?: (event: unknown) => void;
  private readonly pendingEvents: unknown[] = [];

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
    this.realtime.on("event", (event: RealtimeServerEvent) => {
      if (this.eventHandler) this.eventHandler(event);
      else this.pendingEvents.push(event);
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
    this.eventHandler = handler;
    for (const event of this.pendingEvents.splice(0)) handler(event);
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
  info: (message, details) => console.log(message, details ?? {}),
  error: (message, details) => console.error(message, details ?? {}),
};

function connectionErrorDetails(error: unknown): { code: string; error: string } {
  const value = isRecord(error) ? error : {};
  const providerError = isRecord(value.error) ? value.error : {};
  const code = typeof providerError.code === "string"
    ? providerError.code
    : typeof value.code === "string"
      ? value.code
      : "CONNECTION_FAILED";
  const message = typeof providerError.message === "string"
    ? providerError.message
    : error instanceof Error
      ? error.message
      : "Unable to connect to OpenAI Realtime";
  return { code, error: redactCredential(message) };
}

function redactCredential(message: string): string {
  return message
    .replace(/(?:sk|sess)-[A-Za-z0-9_-]+/g, "[redacted]")
    .replace(/(Incorrect API key provided:\s*)[^.\s]+/gi, "$1[redacted]");
}

function eventLogDetails(event: Record<string, unknown>): Record<string, unknown> {
  const details: Record<string, unknown> = { type: event.type };
  for (const key of ["event_id", "response_id", "item_id", "call_id"] as const) {
    if (typeof event[key] === "string") details[key] = event[key];
  }
  if (typeof event.content_index === "number") details.contentIndex = event.content_index;
  if (event.type === "response.output_audio.delta" && typeof event.delta === "string") {
    details.audioBytes = Buffer.byteLength(event.delta, "base64");
  }
  if (event.type === "error" && isRecord(event.error)) {
    if (typeof event.error.code === "string") details.code = event.error.code;
    if (typeof event.error.message === "string") details.error = redactCredential(event.error.message);
  }
  if (event.type === "response.done" && isRecord(event.response) && typeof event.response.status === "string") {
    details.status = event.response.status;
  }
  return details;
}

function sessionLogDetails(event: Record<string, unknown>): Record<string, unknown> {
  const session = isRecord(event.session) ? event.session : {};
  return {
    ...eventLogDetails(event),
    ...(typeof session.model === "string" ? { model: session.model } : {}),
    ...(Array.isArray(session.output_modalities) ? { outputModalities: session.output_modalities } : {}),
  };
}

function responseId(event: Record<string, unknown>): string | undefined {
  const response = isRecord(event.response) ? event.response : {};
  return typeof response.id === "string" ? response.id : typeof event.response_id === "string" ? event.response_id : undefined;
}

function responseStatus(event: Record<string, unknown>): string | undefined {
  const response = isRecord(event.response) ? event.response : {};
  return typeof response.status === "string" ? response.status : undefined;
}

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
