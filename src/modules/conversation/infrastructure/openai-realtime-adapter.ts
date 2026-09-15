import OpenAI from "openai";
import { OpenAIRealtimeWS } from "openai/realtime/ws";
import { performance } from "node:perf_hooks";
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
// A telephone caller commonly pauses for a few hundred milliseconds between
// phrases.  650 ms lets those pauses pass while avoiding a long silence once a
// caller has clearly finished.  The small local delay protects against a late
// VAD resume event without adding another noticeable beat to the call.
const DEFAULT_VAD_SILENCE_DURATION_MS = 650;
// Server VAD is the sole owner of end-of-speech detection. This tiny local
// grace only gives a late VAD-resume event a chance to cancel the response;
// it must not add a second noticeable conversational pause.
const DEFAULT_RESPONSE_DELAY_MS = 100;
const RESPONSE_WATCHDOG_MS = 3_500;
// Deadlines apply to outstanding work, never to a caller thinking in silence.
const REALTIME_PROGRESS_TIMEOUT_MS = 15_000;
const RESPONSE_RECOVERY_INSTRUCTIONS = "The previous assistant response failed. Briefly apologize for the interruption and respond to the caller using the conversation and any returned tool results. Do not repeat an already-delivered question or confirmation. Never claim an operation succeeded unless its tool returned success. Do not retry tools in this recovery response.";
const BOOKING_RESULT_INSTRUCTIONS = "Only after create_appointment returns ok: true, clearly tell the caller once that their appointment is confirmed, using appointmentDisplay from that successful result for the clinic-local date and time actually booked. For example: 'Perfect, your appointment is confirmed for [appointmentDisplay].' Vary the surrounding wording naturally, but explicitly say the appointment is confirmed. Never calculate the spoken date or time from UTC or reuse an earlier offered time. confirm_appointment only records consent; it does not mean the appointment is booked. Before create_appointment succeeds, never say the appointment is confirmed. If booking fails, never claim it is confirmed or booked; briefly explain the failure and offer help. After a successful booking, do not repeat the announcement, ask for another confirmation, or call confirm_appointment or create_appointment again for that booking. You may ask if there is anything else you can help with, or close politely. If you have already delivered the booking confirmation, do not announce it again.";
// Telephone playback may still be draining after OpenAI has finished its
// response. Require a clearly sustained voice signal before interrupting it.
// 220 ms is long enough to reject a single echo/noise frame but short enough
// that a caller can naturally say "stop" or "actually Monday" over playback.
const BARGE_IN_MIN_SUSTAINED_SPEECH_MS = 220;
const BARGE_IN_MIN_AUDIO_RMS = 0.04;
const BARGE_IN_NOISE_FLOOR_MULTIPLIER = 3.5;
const BARGE_IN_PLAYBACK_GUARD_MS = 120;
// Realtime VAD events can arrive just after the audio frames that triggered
// them. Keep a small local history so the initial barge-in decision evaluates
// the caller's speech instead of the following silence frame.
const BARGE_IN_PRE_VAD_LOOKBACK_MS = 450;
const INPUT_AUDIO_HISTORY_MS = 1_000;
const OPENING_GREETING = "Say exactly: Hi, thanks for calling. This is YIBO, the AI receptionist. What day would you like to come in? Then wait for the caller's answer.";

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
  /** Local grace period after server VAD sees silence before requesting a response. */
  responseDelayMs?: number;
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
    const responseDelayMs = turnDetection.responseDelayMs ?? this.turnDetection.responseDelayMs ?? DEFAULT_RESPONSE_DELAY_MS;
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
    const session = new OpenAIRealtimeSession(connection, input, this.logger, this.mode, responseDelayMs, silenceDurationMs);
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
            ? "You have authorized access to the clinic calendar only through the provided backend tools. Never claim you cannot access the calendar directly; call check_availability whenever a caller asks about dates or availability. Use the tool result as the sole source of appointment times. The tool supplies canonical UTC fields for booking and clinic-local caller fields for speech: always say earliestSlotDisplay exactly as returned (or callerAvailableSlots[].displayTime), never read or calculate a clock time from earliestSlotUtc, earliestSlot.startAt, or any ISO value ending in Z. Do not ask callers for service IDs or internal names. Use the optional patient-facing service field only for Cleaning or Consultation; omit it to use the clinic default. If a tool result says requestedTimeAvailable is true, clearly say that time is available; if false, say it is unavailable and offer earliestSlotDisplay. Never reveal why a time is busy or any other patient's details."
            : "Do not claim calendar access when a calendar tool is not provided.",
          BOOKING_RESULT_INSTRUCTIONS,
          "When the caller clearly says they are finished or asks to end the call, use end_call. Finish any pending tools and explain their result first, including the booking confirmation after success. Do not end on silence, hesitation, booking consent, or a question. end_call will give one final goodbye and disconnect; do not say goodbye before calling it or ask another question afterward.",
          "Ask one question at a time and wait patiently for the answer. Treat short pauses, 'um', 'maybe', 'hold on', 'give me a second', and 'let me think' as unfinished; do not move the workflow forward until the caller continues or gives a clear answer. The opening greeting already asks what day the caller would like to come in. Do not repeat that question or introduce yourself again. Track the caller's answers in the conversation: ask only for information still missing, and never ask the same question again merely because the caller pauses. If a caller supplies a day but no time preference, ask what time they would like. If they request the earliest appointment, check availability immediately instead of asking for a preferred time. When the caller supplies both date and time, use both without asking again. For supported natural dates, call check_availability with dateExpression; it resolves the actual date in the clinic timezone and checks the real Google Calendar. Offer only earliestSlotDisplay first, in one short sentence. Before booking, present the exact date and time and ask for explicit confirmation. Silence, an idle timeout, unclear speech, maybe, I think so, hold on, wait, let me check, actually, or an earlier yes to a different question never count as consent. Only after a new clear affirmative response (yes, yeah, yep, sure, that's fine, go ahead, book it, yes please, confirm it, that works, please do) call confirm_appointment for that exact returned slot, then call create_appointment. Copy earliestSlotUtc unchanged into these tools; never rebuild it from the spoken display time. Collect any required contact details before requesting final booking confirmation. Once confirm_appointment succeeds, immediately call create_appointment for the identical provider, service, and slot; do not ask for a second yes. If confirmation or booking fails, explain the tool result briefly and keep the conversation open. Only announce a booking after create_appointment succeeds. After any question, remain silent until the caller responds. Silence is not a new conversational turn and must not cause another question or an 'are you still there' prompt. Do not book or call confirm_appointment without a new clear affirmative. When a verified caller asks to reschedule a current appointment, check the requested new time first and use reschedule_appointment only with the known appointment ID and a verified slot. If the caller says hold on or let me think, acknowledge briefly once and wait until they continue. Do not claim a slot is reserved before booking succeeds.",
          input.agent.tools.some((tool) => tool.name === "update_customer")
            ? "Before asking for final confirmation of a verified time, collect missing contact details, exactly one question at a time: first 'What's your first and last name?', then 'What's the best phone number to reach you?', then 'Is this for a cleaning or a consultation?'. After name and phone are collected, call update_customer. Use the caller's Cleaning or Consultation answer consistently for availability, confirmation, and booking. If the service changes, check availability again and ask for fresh confirmation of the resulting slot; never expose IDs. Do not ask for symptoms or medical details."
            : "",
        ].filter(Boolean).join("\n"),
        ...(this.mode === "audio" ? {
          audio: {
            input: {
              format: { type: "audio/pcm", rate: 24_000 },
              noise_reduction: { type: "near_field" },
              turn_detection: {
                type: this.turnDetection.type ?? "server_vad",
                // Server VAD still commits the caller audio. YIBO asks for a
                // response after a small local grace period that is cancelled
                // if the caller resumes speaking.
                create_response: false,
                // A single VAD event can be speaker echo or background noise.
                // YIBO confirms sustained speech locally before it cancels output.
                interrupt_response: false,
                idle_timeout_ms: null,
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
        tools: [...input.agent.tools.map((tool) => ({
          type: "function",
          name: tool.name,
          description: tool.description,
          parameters: tool.inputSchema,
        })), { type: "function", name: "end_call", description: "End the call when the caller clearly indicates they are finished. Only after pending operations and their spoken results. Generates one goodbye then disconnects.", parameters: { type: "object", properties: {}, additionalProperties: false } }],
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
        createResponse: false,
        interruptResponse: false,
        idleTimeoutMs: null,
        ...(threshold === undefined ? {} : { threshold }),
        ...(prefixPaddingMs === undefined ? {} : { prefixPaddingMs }),
        ...(silenceDurationMs === undefined ? {} : { silenceDurationMs }),
        responseDelayMs,
      } : undefined,
    });
    return session;
  }
}

class OpenAIRealtimeSession implements ConversationRuntimeSession {
  private readonly queue = new AsyncEventQueue<ConversationRuntimeEvent>();
  private readonly allowedTools: Set<string>;
  private readonly callId: string;
  private callerUtterance: string | null = null;
  private closed = false;
  private readonly audioContentIndexes = new Map<string, number>();
  private readonly truncatedAssistantTurns = new Set<string>();
  private state: RealtimeTurnState = "listening";
  private activeResponseId?: string;
  /** A response.create was sent but the provider has not acknowledged it yet. */
  private responseCreatePending = false;
  private cancelResponseOnAcknowledgement = false;
  private toolResponsePending = false;
  private activeToolCalls = 0;
  /** Prevent a provider replay of the same function call from executing it twice. */
  private readonly activeToolCallIds = new Set<string>();
  private readonly completedToolCallIds = new Set<string>();
  private readonly completedResponseIds = new Set<string>();
  private readonly toolNames = new Map<string, string>();
  private bookingWatchdog?: ReturnType<typeof setTimeout>;
  private bookingResult?: { completedAt: number; result: ToolResultEnvelope; recovered: boolean; responseId?: string };
  private inputAudioFrames = 0;
  private callerIsSpeaking = false;
  private latestInputMetrics: AudioMetrics = { rms: 0, peak: 0, durationMs: 0 };
  private readonly recentInputAudio: TimedAudioMetrics[] = [];
  private adaptiveNoiseFloor = 0.005;
  private pendingBargeIn?: PendingBargeIn;
  private pendingTurnCommit?: PendingTurnCommit;
  /**
   * The request timing belongs to the response after it is accepted by
   * Realtime.  Keep it separate from `pendingTurnCommit`, which is only for a
   * caller turn that still needs committing or a response request.
   */
  private activeResponseTurn?: ResponseTurnTiming;
  private activeCallerTurn?: ActiveCallerTurn;
  private responseWatchdog?: ReturnType<typeof setTimeout>;
  private recoveryPending = false;
  private recoveryUsed = false;
  private textResponsePending = false;
  private readonly committedAudioItems = new Map<string, number>();
  private readonly stoppedAudioItems = new Set<string>();
  private turnNumber = 0;
  private assistantPlaybackStartedAt?: number;
  private endCallRequested = false;
  private finalResponseRequested = false;
  private finalResponseDone = false;
  private playbackDeadline?: ReturnType<typeof setTimeout>;
  private expectedPlaybackEndAt = 0;
  private readonly bargeInEnabled: boolean;
  private greetingRequested = false;
  private greetingSent = false;
  private readonly cancelledResponseIds = new Set<string>();
  private readonly handledInputEvents = new Set<string>();
  private sessionConfigured = false;

  constructor(
    private readonly connection: RealtimeConnection,
    input: OpenConversationInput,
    private readonly logger: RealtimeErrorLogger,
    private readonly mode: "text" | "audio",
    private readonly responseDelayMs: number,
    private readonly configuredVadSilenceMs: number,
  ) {
    this.callId = input.conversationId;
    this.allowedTools = new Set([...input.agent.tools.map((tool) => tool.name), "end_call"]);
    this.bargeInEnabled = input.bargeInEnabled ?? true;
    if (!this.bargeInEnabled) {
      this.logger.info?.("telephony.barge_in.disabled_for_test", { source: "private_asterisk_test" });
    }
    connection.onEvent((event) => this.handleEvent(event));
    connection.onError((error) => this.handleError(error));
    connection.onClose((reason) => this.finish(reason));
  }

  async sendText(text: string): Promise<void> {
    const normalized = text.trim();
    this.callerUtterance = normalized;
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
    this.endCallRequested = false;
    this.finalResponseRequested = false;
    this.finalResponseDone = false;
    this.textResponsePending = true;
    this.resumeWaitingWork();
  }

  async startGreeting(): Promise<void> {
    this.assertOpen();
    if (this.greetingRequested) {
      this.logger.info?.("telephony.greeting.skipped", { reason: "already_requested" });
      return;
    }
    this.greetingRequested = true;
    if (!this.sessionConfigured) {
      this.logger.info?.("telephony.greeting.waiting_for_realtime_ready", { once: true });
      this.startResponseWatchdog("session_configuration");
      return;
    }
    this.requestGreetingResponse();
  }

  private requestGreetingResponse(): void {
    if (this.closed || !this.greetingRequested || this.greetingSent) return;
    if (!this.requestAssistantResponse("greeting", OPENING_GREETING)) {
      this.logger.info?.("telephony.greeting.deferred", { reason: "response_not_ready" });
      return;
    }
    this.greetingSent = true;
    this.logger.info?.("telephony.greeting.requested", { once: true });
  }

  async sendAudio(frame: AudioFrame): Promise<void> {
    this.assertOpen();
    if (this.mode !== "audio") {
      throw new Error("OpenAIRealtimeAdapter is configured for text-only input and output");
    }
    if (frame.codec !== "pcm_s16le" || frame.sampleRate !== 24_000 || frame.channels !== 1) {
      throw new Error("OpenAI Realtime audio requires mono pcm_s16le at 24000 Hz");
    }
    this.latestInputMetrics = audioMetrics(frame);
    this.recordInputAudioMetrics(this.latestInputMetrics);
    this.updateAdaptiveNoiseFloor();
    if (this.activeCallerTurn) {
      this.activeCallerTurn.audioFrames += 1;
      this.activeCallerTurn.audioDurationMs += this.latestInputMetrics.durationMs;
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
    this.confirmBargeInFromAudio();
  }

  async sendToolResult(result: ToolResultEnvelope): Promise<void> {
    this.assertOpen();
    if (this.completedToolCallIds.has(result.toolCallId)) return;
    this.completedToolCallIds.add(result.toolCallId);
    const wasActiveToolCall = this.activeToolCallIds.delete(result.toolCallId);
    if (wasActiveToolCall) {
      this.activeToolCalls = Math.max(0, this.activeToolCalls - 1);
    } else {
      this.logger.info?.("telephony.conversation.duplicate_tool_result", {
        toolCallId: result.toolCallId,
        activeToolCalls: this.activeToolCalls,
      });
    }
    const toolStartedAt = this.activeResponseTurn?.toolStartedAtByCallId.get(result.toolCallId);
    if (toolStartedAt !== undefined && this.activeResponseTurn) {
      const toolDurationMs = Math.round(performance.now() - toolStartedAt);
      this.activeResponseTurn.toolDurationMs = (this.activeResponseTurn.toolDurationMs ?? 0) + toolDurationMs;
      this.logger.info?.("telephony.turn.tool_completed", {
        turnNumber: this.activeResponseTurn.turnNumber,
        toolCallId: result.toolCallId,
        toolDurationMs,
        ok: result.ok,
      });
    }
    const output = result.ok
      ? { ok: true, data: result.data }
      : { ok: false, error: result.error };
    this.logger.info?.("OpenAI Realtime tool result sent", toolResultLogDetails(result));
    this.connection.send({
      type: "conversation.item.create",
      item: {
        type: "function_call_output",
        call_id: result.toolCallId,
        output: JSON.stringify(output),
      },
    });
    if (this.toolNames.get(result.toolCallId) === "create_appointment") {
      this.bookingResult = { completedAt: performance.now(), result, recovered: false };
      this.armBookingWatchdog();
    }
    this.traceBooking("tool_result_returned", { toolCallId: result.toolCallId, toolCompleted: true, toolSucceeded: result.ok, toolError: result.ok ? null : result.error });
    this.toolResponsePending = true;
    this.resumeWaitingWork();
  }

  /** Re-evaluate waiting work whenever a response, tool, or playback gate opens. */
  private resumeWaitingWork(): void {
    if (this.closed || this.callerIsSpeaking) return;
    if (this.endCallRequested) {
      if (this.finalResponseDone && this.assistantPlaybackStartedAt === undefined) {
        this.logger.info?.("telephony.call.final_response_drained", { callId: this.callId });
        void this.close();
      } else if (!this.finalResponseRequested && this.requestAssistantResponse("tool_result", "The caller has finished. Say one brief polite goodbye, then stop. Do not repeat a booking confirmation, ask another question, or call any tools.", true)) {
        this.finalResponseRequested = true;
        this.toolResponsePending = false;
        this.textResponsePending = false;
        this.recoveryPending = false;
        clearTimeout(this.bookingWatchdog);
      }
      return;
    }
    if (this.pendingTurnCommit) {
      this.attemptTurnResponse(this.pendingTurnCommit);
      // A caller turn owns its patience/commit boundary, including late tool results.
      return;
    }
    if (this.textResponsePending) {
      if (this.requestAssistantResponse("text_turn")) {
        this.textResponsePending = false;
        this.toolResponsePending = false;
        this.recoveryPending = false;
      }
      return;
    }
    if (this.recoveryPending) {
      if (this.requestAssistantResponse("response_watchdog_retry", RESPONSE_RECOVERY_INSTRUCTIONS, true)) this.recoveryPending = false;
      return;
    }
    if (this.toolResponsePending) {
      if (this.requestAssistantResponse("queued_tool_result")) this.toolResponsePending = false;
      return;
    }
    if (this.sessionConfigured) this.requestGreetingResponse();
  }

  private traceBooking(phase: string, details: Record<string, unknown> = {}): void {
    if (phase.endsWith(".delta")) return;
    this.logger.info?.("telephony.booking_confirmation.trace", {
      callId: this.callId, turnNumber: this.turnNumber, phase,
      callerUtterance: this.callerUtterance, currentState: this.state,
      selectedProvider: null, selectedService: null, selectedDateTime: null, pendingProposalId: null,
      confirmationValid: null, confirmationRecorded: null, confirmationConsumed: null, bookingAllowed: null,
      toolRequested: null, toolCompleted: null, toolSucceeded: null, toolError: null,
      // Domain consent/proposal fields are logged by the tool executor, not inferred here.
      assistantPlaybackActive: this.assistantPlaybackStartedAt !== undefined,
      realtimeResponseActive: this.activeResponseId !== undefined,
      responseRequested: this.responseCreatePending,
      responseStarted: this.activeResponseId !== undefined,
      toolStarted: this.activeToolCalls > 0,
      outboundQueueDepth: null, finalState: this.state, ...details,
    });
  }

  private armBookingWatchdog(): void {
    clearTimeout(this.bookingWatchdog);
    this.bookingWatchdog = setTimeout(() => {
      const booking = this.bookingResult;
      if (!booking || this.closed || booking.recovered) return;
      const responseActive = this.activeResponseId !== undefined;
      const playbackActive = this.assistantPlaybackStartedAt !== undefined;
      const recoveryTaken = !responseActive && !this.responseCreatePending && !playbackActive && !this.callerIsSpeaking && !this.pendingTurnCommit && this.activeToolCalls === 0;
      this.logger.info?.("telephony.booking.response_watchdog", {
        callId: this.callId,
        elapsedMs: Math.round(performance.now() - booking.completedAt),
        bookingResult: booking.result, currentState: this.state,
        responseActive, playbackActive, recoveryTaken,
      });
      if (!recoveryTaken) { this.armBookingWatchdog(); return; }
      booking.recovered = true;
      this.toolResponsePending = false;
      // Recovery can only speak from the returned result; it cannot invoke tools.
      this.requestAssistantResponse("response_watchdog_retry",
        BOOKING_RESULT_INSTRUCTIONS, true);
    }, RESPONSE_WATCHDOG_MS);
  }

  async interrupt(position?: AssistantPlaybackPosition): Promise<void> {
    this.assertOpen();
    // `interrupt_response` is disabled so a false VAD signal cannot cut off
    // YIBO. This is called only after local confirmation of real caller speech.
    if (position && this.truncatedAssistantTurns.has(position.assistantTurnId)) return;
    if (!position && !this.callerIsSpeaking) return;
    this.endCallRequested = false;
    this.finalResponseRequested = false;
    this.finalResponseDone = false;
    if (position) {
      this.truncatedAssistantTurns.add(position.assistantTurnId);
      this.assistantPlaybackStartedAt = undefined;
      clearTimeout(this.playbackDeadline);
      this.expectedPlaybackEndAt = 0;
    }
    if (!this.activeResponseId) {
      this.logger.info?.("telephony.barge_in.playback_only_interrupt", {
        assistantTurnId: position?.assistantTurnId, realtimeResponseActive: false,
      });
    } else {
      this.cancelActiveResponse();
    }
    // Generation may have finished long before telephone playback. The unheard
    // tail must still be removed from conversation history after an interruption.
    if (!position) return;
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

  private cancelActiveResponse(): void {
    if (!this.activeResponseId || this.cancelledResponseIds.has(this.activeResponseId)) return;
    this.cancelledResponseIds.add(this.activeResponseId);
    this.setState(this.callerIsSpeaking ? "user_speaking" : "interrupted", { source: "confirmed_barge_in" });
    this.connection.send({ type: "response.cancel" });
    this.logger.info?.("OpenAI Realtime response.cancel sent", { source: "confirmed_barge_in", realtimeResponseActive: true });
  }

  assistantPlaybackEnded(): void {
    if (this.closed) return;
    this.traceBooking("assistant_playback_finished");
    const wasAssistantSpeaking = this.state === "assistant_speaking";
    const realtimeResponseActive = this.activeResponseId !== undefined;
    const playbackWasActive = this.assistantPlaybackStartedAt !== undefined;
    this.assistantPlaybackStartedAt = undefined;
    clearTimeout(this.playbackDeadline);
    this.expectedPlaybackEndAt = 0;
    if (this.endCallRequested || !wasAssistantSpeaking) { this.resumeWaitingWork(); return; }

    if (!realtimeResponseActive && !this.responseCreatePending && this.activeToolCalls === 0 && !this.callerIsSpeaking) {
      this.logger.info?.("telephony.conversation.invalid_state", {
        currentTurnState: this.state,
        assistantPlaybackActive: false,
        realtimeResponseActive: false,
        outboundQueueDepth: 0,
        correction: "listening",
        source: "transport_playback_idle",
      });
      this.setState("listening", { source: "transport_playback_idle", playbackWasActive });
      this.resumeWaitingWork();
      return;
    }
    this.setState(
      realtimeResponseActive || this.responseCreatePending ? "thinking" : this.activeToolCalls > 0 ? "tool_running" : "user_speaking",
      {
        source: "transport_playback_idle",
        realtimeResponseActive,
        responseCreatePending: this.responseCreatePending,
        activeToolCalls: this.activeToolCalls,
        callerIsSpeaking: this.callerIsSpeaking,
      },
    );
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.clearPendingTurnCommit("session_closed");
    this.clearResponseWatchdog();
    clearTimeout(this.playbackDeadline);
    clearTimeout(this.bookingWatchdog);
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
    if (value.type.startsWith("input_audio_buffer.") && typeof value.event_id === "string") {
      if (this.handledInputEvents.has(value.event_id)) {
        this.logger.info?.("telephony.conversation.duplicate_input_event", eventLogDetails(value));
        return;
      }
      this.handledInputEvents.add(value.event_id);
    }
    // Cancellation owns both generation and late output. Keep response.done
    // flowing so it can release the response gate for the caller's next turn.
    if (value.type.startsWith("response.") && value.type !== "response.done" && value.type !== "response.created"
      && ((typeof value.response_id === "string" && (this.cancelledResponseIds.has(value.response_id) || this.completedResponseIds.has(value.response_id)))
        || (typeof value.item_id === "string" && this.truncatedAssistantTurns.has(value.item_id)))) {
      this.logger.info?.("telephony.conversation.stale_output_ignored", eventLogDetails(value));
      return;
    }
    if (this.activeResponseId && value.type.startsWith("response.")
      && value.type !== "response.created" && value.type !== "response.done") {
      this.startResponseWatchdog("response_progress");
    }
    this.logger.info?.("OpenAI Realtime event received", eventLogDetails(value));
    this.traceBooking(value.type as string);
    switch (value.type) {
      case "session.created":
        this.logger.info?.("OpenAI Realtime session created", sessionLogDetails(value));
        return;
      case "session.updated":
        this.logger.info?.("OpenAI Realtime session configuration accepted", sessionLogDetails(value));
        this.sessionConfigured = true;
        if (!this.responseCreatePending && !this.activeResponseId) this.clearResponseWatchdog();
        this.requestGreetingResponse();
        return;
      case "input_audio_buffer.committed":
        this.logger.info?.("OpenAI Realtime input audio buffer committed", eventLogDetails(value));
        this.markSpeechCommitted(value);
        return;
      case "conversation.item.created":
      case "conversation.item.done":
        if (isRecord(value.item) && value.item.role === "user" && Array.isArray(value.item.content)
          && value.item.content.some(part => isRecord(part) && part.type === "input_audio")) {
          this.markSpeechCommitted({ item_id: value.item.id });
        }
        return;
      case "conversation.item.input_audio_transcription.completed":
        this.callerUtterance = typeof value.transcript === "string" ? value.transcript : null;
        this.traceBooking("user_item_finalized");
        this.logger.info?.("telephony.turn.user_transcript_available", {
          turnNumber: this.pendingTurnCommit?.turnNumber ?? this.activeResponseTurn?.turnNumber,
          ...(typeof value.item_id === "string" ? { itemId: value.item_id } : {}),
        });
        return;
      case "input_audio_buffer.timeout_triggered":
        this.logger.info?.("OpenAI Realtime idle timeout triggered", eventLogDetails(value));
        this.queue.push({ type: "silence.timeout" });
        return;
      case "response.output_text.delta":
        if (this.mode === "text" && this.bookingResult?.responseId === this.activeResponseId && this.bookingResult) {
          clearTimeout(this.bookingWatchdog);
          this.bookingResult = undefined;
        }
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
        if (this.bookingResult?.responseId && this.bookingResult.responseId === this.activeResponseId) {
          clearTimeout(this.bookingWatchdog);
          this.bookingResult = undefined;
        }
        if (typeof value.delta === "string" && typeof value.item_id === "string") {
          if (typeof value.content_index === "number") {
            this.audioContentIndexes.set(value.item_id, value.content_index);
          }
          if (this.state !== "assistant_speaking") {
            this.assistantPlaybackStartedAt = performance.now();
            this.traceBooking("first_assistant_audio");
            this.logger.info?.("telephony.conversation.turn_pacing", {
              phase: "assistant_first_audio",
              responseDelayMs: this.responseDelayMs,
            });
            this.logger.info?.("telephony.turn.first_audio_received", {
              turnNumber: this.activeResponseTurn?.turnNumber,
              at: new Date().toISOString(),
              ...(this.activeResponseTurn?.responseStartedAt === undefined ? {} : {
                responseStartToFirstAudioMs: Math.round(performance.now() - this.activeResponseTurn.responseStartedAt),
              }),
            });
            if (this.activeResponseTurn && this.activeResponseTurn.firstAudioReceivedAt === undefined) {
              const now = performance.now();
              this.activeResponseTurn.firstAudioReceivedAt = now;
              const speechEndToCommitMs = this.activeResponseTurn.committedAt === undefined
                ? undefined
                : Math.round(this.activeResponseTurn.committedAt - this.activeResponseTurn.speechStoppedAt);
              const commitToDecisionMs = this.activeResponseTurn.committedAt === undefined || this.activeResponseTurn.decisionAt === undefined
                ? undefined
                : Math.round(this.activeResponseTurn.decisionAt - this.activeResponseTurn.committedAt);
              const commitToResponseStartMs = this.activeResponseTurn.committedAt === undefined
                ? undefined
                : Math.round(this.activeResponseTurn.responseStartedAt - this.activeResponseTurn.committedAt);
              const responseStartToFirstAudioMs = Math.round(now - this.activeResponseTurn.responseStartedAt);
              const timing = {
                type: "assistant.response_timing",
                turnNumber: this.activeResponseTurn.turnNumber,
                speechDurationMs: Math.round(this.activeResponseTurn.speechDurationMs),
                configuredVadSilenceMs: this.configuredVadSilenceMs,
                ...(speechEndToCommitMs === undefined ? {} : { speechEndToCommitMs }),
                ...(commitToDecisionMs === undefined ? {} : { commitToDecisionMs }),
                ...(this.activeResponseTurn.toolDurationMs === undefined ? {} : { toolDurationMs: Math.round(this.activeResponseTurn.toolDurationMs) }),
                ...(commitToResponseStartMs === undefined ? {} : { commitToResponseStartMs }),
                responseStartToFirstAudioMs,
                responseRequestToStartMs: Math.round(this.activeResponseTurn.responseStartedAt - this.activeResponseTurn.responseRequestedAt),
                totalSpeechEndToFirstAudioMs: Math.round(now - this.activeResponseTurn.speechStoppedAt),
                toolUsed: this.activeResponseTurn.toolStartedAtByCallId.size > 0,
                bargeInOccurred: this.activeResponseTurn.bargeInOccurred,
                startingState: this.activeResponseTurn.startingState,
                endingState: "assistant_speaking",
              } as const;
              this.queue.push(timing);
              this.logDelayClassification(timing);
            }
          }
          // Deliver timing before audio, since an audio sink can start playback
          // synchronously when it receives its first frame.
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
          const durationMs = Buffer.byteLength(value.delta, "base64") / 48;
          this.expectedPlaybackEndAt = Math.max(performance.now(), this.expectedPlaybackEndAt) + durationMs;
          clearTimeout(this.playbackDeadline);
          this.playbackDeadline = setTimeout(() => {
            this.failProgress("AUDIO_PLAYBACK_TIMEOUT", "Audio playback did not report completion.");
          }, this.expectedPlaybackEndAt - performance.now() + REALTIME_PROGRESS_TIMEOUT_MS);
          this.playbackDeadline.unref?.();
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
        this.beginBargeIn(value);
        return;
      case "input_audio_buffer.speech_stopped":
        this.logger.info?.("OpenAI Realtime speech stopped", eventLogDetails(value));
        this.finishSpeech(value);
        return;
      case "response.created":
        const createdResponseId = responseId(value);
        if (createdResponseId && (this.completedResponseIds.has(createdResponseId) || createdResponseId === this.activeResponseId)) return;
        this.logger.info?.("OpenAI Realtime response created", eventLogDetails(value));
        this.activeResponseId = responseId(value);
        if (this.bookingResult) this.bookingResult.responseId = this.activeResponseId;
        if (this.activeResponseTurn && !this.pendingTurnCommit?.responseRequested) {
          this.activeResponseTurn.responseStartedAt = performance.now();
          this.activeResponseTurn.firstAudioReceivedAt = undefined;
        }
        this.responseCreatePending = false;
        this.startResponseWatchdog("response_progress");
        const responseRequestedAt = this.pendingTurnCommit?.responseRequestedAt;
        if (this.pendingTurnCommit?.responseRequested && responseRequestedAt !== undefined) {
          const request = this.pendingTurnCommit;
          const responseStartedAt = performance.now();
          this.activeResponseTurn = {
            turnNumber: request.turnNumber,
            speechStoppedAt: request.speechStoppedAt,
            speechDurationMs: request.speechDurationMs,
            startingState: request.startingState,
            committedAt: request.committedAt,
            decisionAt: request.decisionAt,
            responseRequestedAt,
            responseStartedAt,
            bargeInOccurred: request.bargeInOccurred,
            toolStartedAtByCallId: new Map(),
          };
          // This is no longer an uncommitted caller turn.  Clearing it here
          // prevents subsequent VAD/transcription events from being attached
          // to an already-accepted response.
          this.clearPendingTurnCommit("response_started");
        }
        this.logger.info?.("telephony.turn.response_started", {
          turnNumber: this.activeResponseTurn?.turnNumber,
          ...(this.activeResponseTurn?.responseRequestedAt === undefined ? {} : {
            elapsedMs: Math.round(this.activeResponseTurn.responseStartedAt - this.activeResponseTurn.responseRequestedAt),
            ...(this.activeResponseTurn.committedAt === undefined ? {} : {
              commitToResponseStartMs: Math.round(this.activeResponseTurn.responseStartedAt - this.activeResponseTurn.committedAt),
            }),
          }),
        });
        if (this.callerIsSpeaking || this.cancelResponseOnAcknowledgement) this.cancelActiveResponse();
        else this.setState("thinking", { ...(this.activeResponseId ? { responseId: this.activeResponseId } : {}) });
        this.cancelResponseOnAcknowledgement = false;
        this.queue.push({ type: "assistant.response_created", ...(this.activeResponseId ? { responseId: this.activeResponseId } : {}) });
        return;
      case "response.done":
        this.logger.info?.("OpenAI Realtime response done", eventLogDetails(value));
        const completedResponseId = responseId(value);
        if (completedResponseId && this.completedResponseIds.has(completedResponseId)) return;
        // Realtime events can arrive after a later response has already been
        // created.  An old completion must never clear the newer response or
        // make a second tool-result response race it.
        if (completedResponseId && this.activeResponseId && completedResponseId !== this.activeResponseId) {
          this.logger.info?.("telephony.conversation.stale_response_done", {
            completedResponseId,
            activeResponseId: this.activeResponseId,
          });
          return;
        }
        if (completedResponseId) this.completedResponseIds.add(completedResponseId);
        const status = responseStatus(value);
        if (!this.activeResponseId && this.pendingTurnCommit?.responseRequested) {
          this.clearPendingTurnCommit("response_finished_without_created_event");
        }
        // The final response contains the complete tool arguments too. Recover a
        // lost arguments.done notification through the same call-ID deduplication.
        if (status === "completed" && !(completedResponseId && this.cancelledResponseIds.has(completedResponseId))
          && isRecord(value.response) && Array.isArray(value.response.output)) {
          for (const item of value.response.output) {
            if (isRecord(item) && item.type === "function_call") this.handleToolCall(item);
          }
        }
        if (status === "failed" && isRecord(value.response)) {
          const details = isRecord(value.response.status_details) ? value.response.status_details : {};
          const error = isRecord(details.error) ? details.error : {};
          this.logger.info?.("telephony.conversation.response_failed", {
            callId: this.callId, responseId: completedResponseId,
            code: typeof error.code === "string" ? error.code : null,
            message: typeof error.message === "string" ? redactCredential(error.message) : null,
            statusDetailsType: details.type,
          });
        }
        if (status === "cancelled") this.logger.info?.("OpenAI Realtime response cancelled", eventLogDetails(value));
        this.activeResponseId = undefined;
        this.responseCreatePending = false;
        this.clearResponseWatchdog();
        if (this.pendingBargeIn) {
          this.emitBargeIn(false, "response_completed_before_confirmation");
          this.pendingBargeIn = undefined;
        }
        // A cancellation can arrive after the caller has already started speaking.
        // Preserve that fact so a late tool result cannot start a competing response.
        // `response.done` means model generation stopped; it does not mean
        // Asterisk has finished playing the audio already queued for the caller.
        // Preserve the assistant state so VAD signals during that tail are still
        // locally confirmed instead of immediately clearing RTP playback.
        const assistantPlaybackContinues = this.assistantPlaybackStartedAt !== undefined;
        this.setState(
          assistantPlaybackContinues ? "assistant_speaking" : (this.callerIsSpeaking ? "user_speaking" : this.activeToolCalls > 0 ? "tool_running" : "listening"),
          { reason: status ?? "done", realtimeResponseActive: false, activeToolCalls: this.activeToolCalls, assistantPlaybackContinues },
        );
        this.logger.info?.("OpenAI Realtime response state reset", { reason: status ?? "done" });
        this.queue.push({ type: "assistant.response_done", ...(status ? { status } : {}) });
        this.handleUsage(value.response);
        if (this.finalResponseRequested) {
          if (status !== "completed") {
            this.failProgress("FINAL_RESPONSE_FAILED", "The final response did not complete.");
            return;
          }
          this.finalResponseDone = true;
        }
        if (status === "failed" && (!this.bookingResult || this.bookingResult.recovered)) {
          if (this.recoveryUsed || this.bookingResult?.recovered) {
            this.failProgress("REALTIME_RESPONSE_FAILED", "The assistant provider could not generate a response.");
            return;
          }
          this.recoveryUsed = true;
          this.recoveryPending = true;
        }
        this.resumeWaitingWork();
        return;
      case "error":
        this.handleProviderEventError(value.error);
        return;
    }
  }

  private beginBargeIn(event: Record<string, unknown>): void {
    if (typeof event.item_id === "string" && (this.stoppedAudioItems.has(event.item_id)
      || this.activeCallerTurn?.itemId === event.item_id)) return;
    if (this.pendingTurnCommit) {
      const elapsedMs = Math.round(performance.now() - this.pendingTurnCommit.speechStoppedAt);
      this.clearPendingTurnCommit("caller_resumed_speaking");
      this.logger.info?.("telephony.conversation.turn_pacing", {
        phase: "caller_resumed_during_patience_window",
        elapsedMs,
        responseDelayMs: this.responseDelayMs,
      });
    }
    const assistantPlaybackStartedAt = this.assistantPlaybackStartedAt;
    if (this.state !== "assistant_speaking" || assistantPlaybackStartedAt === undefined) {
      this.logger.info?.("telephony.conversation.turn_pacing", {
        phase: "caller_speech_started",
        ...(typeof event.event_id === "string" ? { serverVadEventId: event.event_id } : {}),
      });
      this.callerIsSpeaking = true;
      this.cancelResponseOnAcknowledgement ||= this.responseCreatePending;
      this.activeCallerTurn = {
        turnNumber: ++this.turnNumber,
        itemId: typeof event.item_id === "string" ? event.item_id : undefined,
        speechStartedAt: performance.now(),
        audioFrames: 0,
        audioDurationMs: 0,
        startingState: this.state,
      };
      this.logger.info?.("telephony.turn.speech_started", {
        turnNumber: this.activeCallerTurn.turnNumber,
        at: new Date().toISOString(),
      });
      this.setState("user_speaking", { source: "server_vad" });
      this.queue.push({ type: "user.speech_started" });
      return;
    }

    const now = performance.now();
    this.pendingBargeIn = {
      serverVadEventId: typeof event.event_id === "string" ? event.event_id : undefined,
      detectedAt: now,
      assistantPlaybackMs: Math.max(0, now - assistantPlaybackStartedAt),
      turnState: this.state,
      consecutiveSpeechMs: 0,
      totalSpeechDurationMs: 0,
      totalRmsDuration: 0,
      maxRmsDuringSpeech: 0,
      maxPeakDuringSpeech: 0,
      requiredRms: Math.max(BARGE_IN_MIN_AUDIO_RMS, this.adaptiveNoiseFloor * BARGE_IN_NOISE_FLOOR_MULTIPLIER),
      requiredSpeechMs: BARGE_IN_MIN_SUSTAINED_SPEECH_MS,
    };
    this.seedBargeInFromRecentAudio(this.pendingBargeIn);
    this.logBargeInCandidate(this.pendingBargeIn, "server_vad_speech_started");
    if (!this.bargeInEnabled) {
      this.emitBargeIn(false, "disabled_for_private_test");
      this.pendingBargeIn = undefined;
      return;
    }
    this.confirmBargeInFromAudio();
  }

  private confirmBargeInFromAudio(): void {
    const candidate = this.pendingBargeIn;
    if (!candidate || !this.bargeInEnabled) return;
    const playbackElapsedMs = Math.max(0, performance.now() - (this.assistantPlaybackStartedAt ?? performance.now()));
    if (playbackElapsedMs < BARGE_IN_PLAYBACK_GUARD_MS) {
      candidate.consecutiveSpeechMs = 0;
      return;
    }
    // `sendAudio` accumulates every input frame while VAD is active. This
    // method only decides whether that retained evidence is sufficient.
    if (candidate.consecutiveSpeechMs < candidate.requiredSpeechMs) return;
    this.callerIsSpeaking = true;
    this.emitBargeIn(true, "sustained_speech_confirmed");
    this.pendingBargeIn = undefined;
    this.setState("user_speaking", { source: "confirmed_barge_in" });
    this.queue.push({ type: "user.speech_started" });
  }

  private finishSpeech(event: Record<string, unknown>): void {
    const itemId = typeof event.item_id === "string" ? event.item_id : this.activeCallerTurn?.itemId;
    if (itemId && this.stoppedAudioItems.has(itemId)) return;
    if (itemId) this.stoppedAudioItems.add(itemId);
    const candidate = this.pendingBargeIn;
    if (candidate) {
      this.logBargeInCandidate(candidate, "server_vad_speech_stopped");
      this.emitBargeIn(false, this.bargeInEnabled ? "speech_stopped_before_confirmation" : "disabled_for_private_test");
      this.pendingBargeIn = undefined;
      return;
    }
    this.callerIsSpeaking = false;
    const speechStoppedAt = performance.now();
    this.setState("listening", { source: "server_vad_waiting" });
    this.queue.push({
      type: "user.speech_stopped",
      ...(typeof event.event_id === "string" ? { occurredAt: event.event_id } : {}),
    });
    const callerTurn = this.activeCallerTurn ?? {
      turnNumber: ++this.turnNumber,
      speechStartedAt: speechStoppedAt,
      audioFrames: 0,
      audioDurationMs: 0,
      startingState: this.state,
    };
    callerTurn.itemId = itemId;
    this.activeCallerTurn = undefined;
    this.scheduleTurnCommit(speechStoppedAt, typeof event.event_id === "string" ? event.event_id : undefined, callerTurn);
  }

  private scheduleTurnCommit(speechStoppedAt: number, serverVadEventId: string | undefined, callerTurn: ActiveCallerTurn): void {
    this.clearPendingTurnCommit("replaced");
    this.logger.info?.("telephony.conversation.turn_pacing", {
      phase: "caller_speech_stop_candidate",
      responseDelayMs: this.responseDelayMs,
      ...(serverVadEventId ? { serverVadEventId } : {}),
    });
    this.logger.info?.("telephony.turn.speech_stopped_candidate", {
      turnNumber: callerTurn.turnNumber,
      at: new Date().toISOString(),
      responseDelayMs: this.responseDelayMs,
      ...(serverVadEventId ? { serverVadEventId } : {}),
    });
    const candidate: PendingTurnCommit = {
      speechStoppedAt,
      serverVadEventId,
      itemId: callerTurn.itemId,
      turnNumber: callerTurn.turnNumber,
      audioFrames: callerTurn.audioFrames,
      audioDurationMs: callerTurn.audioDurationMs,
      speechDurationMs: Math.max(callerTurn.audioDurationMs, speechStoppedAt - callerTurn.speechStartedAt),
      startingState: callerTurn.startingState,
      bargeInOccurred: false,
      patienceElapsed: false,
      speechCommitted: callerTurn.itemId !== undefined && this.committedAudioItems.has(callerTurn.itemId),
      committedAt: callerTurn.itemId ? this.committedAudioItems.get(callerTurn.itemId) : undefined,
    };
    if (!candidate.speechCommitted) {
      candidate.commitTimer = setTimeout(() => {
        if (this.pendingTurnCommit === candidate && !candidate.speechCommitted) {
          this.failProgress("REALTIME_COMMIT_TIMEOUT", "The caller's audio could not be committed to the voice session.");
        }
      }, REALTIME_PROGRESS_TIMEOUT_MS);
    }
    const timer = setTimeout(() => {
      const candidate = this.pendingTurnCommit;
      if (!candidate || candidate.timer !== timer || this.closed || this.callerIsSpeaking) return;
      candidate.timer = undefined;
      candidate.patienceElapsed = true;
      if (!candidate.speechCommitted) {
        this.logger.info?.("telephony.turn.user_audio_summary", {
          turnNumber: candidate.turnNumber,
          audioFramesSentToOpenAI: candidate.audioFrames,
          audioDurationMs: Math.round(candidate.audioDurationMs),
          speechDetected: true,
          speechCommitted: false,
          transcriptAvailable: false,
          responseRequested: false,
          failureReason: "awaiting_input_audio_buffer_commit",
        });
      }
      this.attemptTurnResponse(candidate);
    }, this.responseDelayMs);
    candidate.timer = timer;
    this.pendingTurnCommit = candidate;
  }

  private markSpeechCommitted(event: Record<string, unknown>): void {
    const itemId = typeof event.item_id === "string" ? event.item_id : undefined;
    if (itemId && !this.committedAudioItems.has(itemId)) this.committedAudioItems.set(itemId, performance.now());
    // A committed item is authoritative end-of-turn evidence even if its
    // speech_stopped notification was lost. Never use an older item's commit.
    if (itemId && this.activeCallerTurn?.itemId === itemId && !this.stoppedAudioItems.has(itemId)) {
      this.finishSpeech({ item_id: itemId });
    }
    const candidate = this.pendingTurnCommit;
    if (!candidate || this.closed || candidate.speechCommitted || (candidate.itemId && candidate.itemId !== itemId)) return;
    candidate.speechCommitted = true;
    candidate.committedAt = (itemId ? this.committedAudioItems.get(itemId) : undefined) ?? performance.now();
    clearTimeout(candidate.commitTimer);
    this.logger.info?.("telephony.turn.speech_committed", {
      turnNumber: candidate.turnNumber,
      at: new Date().toISOString(),
      speechEndToCommitMs: Math.round(candidate.committedAt - candidate.speechStoppedAt),
      ...(typeof event.item_id === "string" ? { itemId: event.item_id } : {}),
    });
    this.attemptTurnResponse(candidate);
  }

  private attemptTurnResponse(candidate: PendingTurnCommit): void {
    const realtimeResponseActive = this.activeResponseId !== undefined;
    const assistantPlaybackActive = this.assistantPlaybackStartedAt !== undefined;
    const reason = !candidate.patienceElapsed
      ? "local_patience_window"
      : !candidate.speechCommitted
        ? "awaiting_input_audio_buffer_commit"
        : candidate.responseRequested
          ? "response_already_requested"
          : this.responseCreatePending
            ? "response_create_pending"
          : this.closed
            ? "session_closed"
            : this.callerIsSpeaking
              ? "caller_still_speaking"
              : realtimeResponseActive
                ? "realtime_response_active"
                : this.activeToolCalls > 0
                  ? "tool_call_active"
                  : assistantPlaybackActive
                    ? "assistant_playback_active"
                    : "committed_turn_ready";
    const shouldCreateResponse = reason === "committed_turn_ready";
    this.logger.info?.("telephony.turn.response_decision", {
      turnNumber: candidate.turnNumber,
      currentTurnState: this.state,
      assistantPlaybackActive,
      realtimeResponseActive,
      toolCallActive: this.activeToolCalls > 0,
      shouldCreateResponse,
      reason,
    });
    if (!shouldCreateResponse) return;
    candidate.decisionAt = performance.now();
    candidate.responseRequested = true;
    candidate.responseRequestedAt = candidate.decisionAt;
    const silenceDurationMs = Math.round(candidate.responseRequestedAt - candidate.speechStoppedAt);
    this.logger.info?.("telephony.turn.user_audio_summary", {
      turnNumber: candidate.turnNumber,
      audioFramesSentToOpenAI: candidate.audioFrames,
      audioDurationMs: Math.round(candidate.audioDurationMs),
      speechDetected: true,
      speechCommitted: true,
      transcriptAvailable: false,
      responseRequested: true,
    });
    this.logger.info?.("telephony.turn.response_requested", {
      turnNumber: candidate.turnNumber,
      at: new Date().toISOString(),
      silenceDurationMs,
    });
    if (!this.requestAssistantResponse("turn_pacing")) {
      candidate.responseRequested = false;
      candidate.responseRequestedAt = undefined;
      return;
    }
    this.toolResponsePending = false;
    this.textResponsePending = false;
    this.recoveryPending = false;
  }

  private startResponseWatchdog(phase: string): void {
    this.clearResponseWatchdog();
    this.responseWatchdog = setTimeout(() => {
      this.logger.info?.("telephony.turn.response_watchdog", {
        callId: this.callId, phase, currentState: this.state,
        recoveryAction: "close_unresponsive_session", timeoutMs: REALTIME_PROGRESS_TIMEOUT_MS,
      });
      // A missing acknowledgement/completion is ambiguous. Sending another
      // response.create can run the original tools twice when the late reply arrives.
      this.failProgress("REALTIME_RESPONSE_TIMEOUT", "The voice provider stopped responding.");
    }, REALTIME_PROGRESS_TIMEOUT_MS);
    this.responseWatchdog.unref?.();
  }

  private clearResponseWatchdog(): void {
    clearTimeout(this.responseWatchdog);
    this.responseWatchdog = undefined;
  }

  private failProgress(code: string, message: string): void {
    if (this.closed) return;
    this.emitError(code, message, true);
    void this.close();
  }

  private clearPendingTurnCommit(reason: string): void {
    const candidate = this.pendingTurnCommit;
    if (!candidate) return;
    clearTimeout(candidate.timer);
    clearTimeout(candidate.commitTimer);
    this.pendingTurnCommit = undefined;
    if (reason !== "replaced" && reason !== "response_started") {
      this.logger.info?.("telephony.conversation.turn_pacing", { phase: "caller_turn_commit_cancelled", reason });
    }
  }

  private emitBargeIn(accepted: boolean, reason: string): void {
    const candidate = this.pendingBargeIn;
    if (!candidate) return;
    const details = this.bargeInDetails(candidate, accepted, reason);
    this.logger.info?.(accepted ? "telephony.barge_in.accepted" : "telephony.barge_in.rejected", details);
    this.queue.push({
      type: "barge_in.detected",
      ...details,
    });
  }

  private bargeInDetails(candidate: PendingBargeIn, accepted: boolean, reason: string) {
    return {
      ...(candidate.serverVadEventId ? { serverVadEventId: candidate.serverVadEventId } : {}),
      accepted,
      reason,
      turnState: candidate.turnState,
      inboundRms: roundAudioMetric(this.latestInputMetrics.rms),
      inboundPeak: roundAudioMetric(this.latestInputMetrics.peak),
      adaptiveNoiseFloor: roundAudioMetric(this.adaptiveNoiseFloor),
      requiredRms: roundAudioMetric(candidate.requiredRms),
      requiredSpeechMs: candidate.requiredSpeechMs,
      consecutiveSpeechMs: Math.round(candidate.consecutiveSpeechMs),
      maxRmsDuringSpeech: roundAudioMetric(candidate.maxRmsDuringSpeech),
      averageRmsDuringSpeech: roundAudioMetric(candidate.totalSpeechDurationMs === 0 ? 0 : candidate.totalRmsDuration / candidate.totalSpeechDurationMs),
      maxPeakDuringSpeech: roundAudioMetric(candidate.maxPeakDuringSpeech),
      totalSpeechDurationMs: Math.round(candidate.totalSpeechDurationMs),
      consecutiveAboveThresholdMs: Math.round(candidate.consecutiveSpeechMs),
      assistantPlaybackMs: Math.round(candidate.assistantPlaybackMs),
      realtimeResponseActive: this.activeResponseId !== undefined,
    };
  }

  private recordInputAudioMetrics(metrics: AudioMetrics): void {
    const observedAt = performance.now();
    this.recentInputAudio.push({ observedAt, ...metrics });
    while (this.recentInputAudio[0] && observedAt - this.recentInputAudio[0].observedAt > INPUT_AUDIO_HISTORY_MS) {
      this.recentInputAudio.shift();
    }
    if (this.pendingBargeIn) this.observeBargeInAudio(this.pendingBargeIn, metrics);
  }

  private seedBargeInFromRecentAudio(candidate: PendingBargeIn): void {
    const minimumObservedAt = candidate.detectedAt - BARGE_IN_PRE_VAD_LOOKBACK_MS;
    for (const metrics of this.recentInputAudio) {
      if (metrics.observedAt >= minimumObservedAt) this.observeBargeInAudio(candidate, metrics);
    }
  }

  private observeBargeInAudio(candidate: PendingBargeIn, metrics: AudioMetrics): void {
    if (metrics.durationMs <= 0) return;
    candidate.totalSpeechDurationMs += metrics.durationMs;
    candidate.totalRmsDuration += metrics.rms * metrics.durationMs;
    candidate.maxRmsDuringSpeech = Math.max(candidate.maxRmsDuringSpeech, metrics.rms);
    candidate.maxPeakDuringSpeech = Math.max(candidate.maxPeakDuringSpeech, metrics.peak);
    if (metrics.rms >= candidate.requiredRms) {
      candidate.consecutiveSpeechMs += metrics.durationMs;
    } else {
      candidate.consecutiveSpeechMs = 0;
    }
  }

  private logBargeInCandidate(candidate: PendingBargeIn, source: "server_vad_speech_started" | "server_vad_speech_stopped"): void {
    this.logger.info?.("telephony.barge_in.candidate", {
      ...(candidate.serverVadEventId ? { serverVadEventId: candidate.serverVadEventId } : {}),
      source,
      currentTurnState: candidate.turnState,
      assistantPlaybackActive: this.assistantPlaybackStartedAt !== undefined,
      currentRms: roundAudioMetric(this.latestInputMetrics.rms),
      currentPeak: roundAudioMetric(this.latestInputMetrics.peak),
      maxRmsDuringSpeech: roundAudioMetric(candidate.maxRmsDuringSpeech),
      averageRmsDuringSpeech: roundAudioMetric(candidate.totalSpeechDurationMs === 0 ? 0 : candidate.totalRmsDuration / candidate.totalSpeechDurationMs),
      maxPeakDuringSpeech: roundAudioMetric(candidate.maxPeakDuringSpeech),
      consecutiveAboveThresholdMs: Math.round(candidate.consecutiveSpeechMs),
      totalSpeechDurationMs: Math.round(candidate.totalSpeechDurationMs),
      adaptiveNoiseFloor: roundAudioMetric(this.adaptiveNoiseFloor),
      requiredRms: roundAudioMetric(candidate.requiredRms),
    });
  }

  private updateAdaptiveNoiseFloor(): void {
    // Learn only from sub-speech frames. A likely caller voice or echo should
    // never raise the baseline used to decide later interruptions.
    if (this.pendingBargeIn || this.latestInputMetrics.rms >= BARGE_IN_MIN_AUDIO_RMS) return;
    const updated = this.adaptiveNoiseFloor * 0.9 + this.latestInputMetrics.rms * 0.1;
    this.adaptiveNoiseFloor = Math.max(0.001, Math.min(BARGE_IN_MIN_AUDIO_RMS, updated));
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
    if (this.activeToolCallIds.has(event.call_id) || this.completedToolCallIds.has(event.call_id)) {
      this.logger.info?.("telephony.conversation.duplicate_tool_call", {
        toolCallId: event.call_id,
        toolName: event.name,
      });
      return;
    }
    let argumentsValue: unknown;
    try {
      argumentsValue = JSON.parse(event.arguments);
    } catch {
      this.emitError("INVALID_TOOL_ARGUMENTS", "The runtime returned invalid JSON tool arguments", false);
      return;
    }
    if (event.name === "end_call") {
      this.completedToolCallIds.add(event.call_id);
      const accepted = isRecord(argumentsValue) && Object.keys(argumentsValue).length === 0 && this.activeToolCalls === 0;
      this.connection.send({ type: "conversation.item.create", item: {
        type: "function_call_output", call_id: event.call_id,
        output: JSON.stringify(accepted ? { ok: true } : { ok: false, error: "Finish pending operations and provide their result before ending the call." }),
      } });
      if (accepted) {
        this.endCallRequested = true;
        this.clearPendingTurnCommit("call_ending");
        this.logger.info?.("telephony.call.end_requested", { callId: this.callId });
      } else this.toolResponsePending = true;
      this.resumeWaitingWork();
      return;
    }
    this.traceBooking("tool_requested", { toolRequested: true, toolCallId: event.call_id, toolName: event.name });
    this.toolNames.set(event.call_id, event.name);
    this.activeToolCallIds.add(event.call_id);
    this.activeToolCalls += 1;
    if (this.activeResponseTurn) {
      this.activeResponseTurn.toolStartedAtByCallId.set(event.call_id, performance.now());
      this.logger.info?.("telephony.turn.tool_started", {
        turnNumber: this.activeResponseTurn.turnNumber,
        toolCallId: event.call_id,
        toolName: event.name,
      });
    }
    this.setState("tool_running", { source: "tool_call", toolName: event.name, activeToolCalls: this.activeToolCalls });
    this.queue.push({
      type: "tool.call",
      toolCallId: event.call_id,
      name: event.name as "check_availability" | "confirm_appointment" | "create_appointment" | "update_customer" | "cancel_appointment" | "reschedule_appointment" | "transfer_to_human",
      arguments: argumentsValue,
    });
  }

  /**
   * The single path that advances the assistant after a caller turn or a tool
   * result.  It prevents confirmation, availability, and booking from racing
   * each other into duplicate response.create events.
   */
  private requestAssistantResponse(
    source: "greeting" | "text_turn" | "turn_pacing" | "tool_result" | "queued_tool_result" | "response_watchdog_retry",
    instructions?: string,
    responseOnly = false,
  ): boolean {
    const reason = this.closed
      ? "session_closed"
      : this.callerIsSpeaking
        ? "caller_still_speaking"
        : this.activeToolCalls > 0
          ? "tool_call_active"
          : this.activeResponseId !== undefined
            ? "realtime_response_active"
            : this.responseCreatePending
              ? "response_create_pending"
              : this.assistantPlaybackStartedAt !== undefined
                ? "assistant_playback_active"
                : "ready";
    if (reason !== "ready") {
      this.logger.info?.("telephony.conversation.response_blocked", { source, reason, currentTurnState: this.state });
      return false;
    }
    this.responseCreatePending = true;
    if (source !== "response_watchdog_retry") this.recoveryUsed = false;
    if (source === "text_turn" || source === "turn_pacing") this.greetingSent = true;
    this.startResponseWatchdog("response_acknowledgement");
    if (this.activeResponseTurn) this.activeResponseTurn.responseRequestedAt = performance.now();
    this.connection.send({
      type: "response.create",
      ...(instructions || responseOnly ? { response: { ...(instructions ? { instructions } : {}), ...(responseOnly ? { tool_choice: "none" } : {}) } } : {}),
    });
    this.logger.info?.("telephony.turn.response_requested", { source, currentTurnState: this.state });
    this.setState("thinking", { source });
    return true;
  }

  /**
   * Keep the reason for a noticeable pause explicit.  This is diagnostic only:
   * timing remains owned by server VAD plus the one local grace period above.
   */
  private logDelayClassification(timing: Extract<ConversationRuntimeEvent, { type: "assistant.response_timing" }>): void {
    const candidates: Array<{ type: string; delayMs: number; reason: string }> = [
      { type: "AUDIO_COMMIT_DELAY", delayMs: timing.speechEndToCommitMs ?? 0, reason: "input_audio_buffer.committed" },
      { type: "LOCAL_PATIENCE_TIMER", delayMs: timing.commitToDecisionMs ?? 0, reason: "late_vad_resume_grace" },
      { type: "TOOL_WAIT", delayMs: timing.toolDurationMs ?? 0, reason: "backend_tool_execution" },
      { type: "OPENAI_RESPONSE_START_DELAY", delayMs: timing.responseRequestToStartMs ?? 0, reason: "response.created_after_request" },
      { type: "OPENAI_RESPONSE_START_DELAY", delayMs: timing.responseStartToFirstAudioMs, reason: "first_output_audio" },
    ];
    const largest = candidates.reduce((current, candidate) => candidate.delayMs > current.delayMs ? candidate : current);
    this.logger.info?.("telephony.turn.delay_classified", {
      turnNumber: timing.turnNumber,
      delayType: largest.delayMs === 0 ? "UNKNOWN" : largest.type,
      delayMs: largest.delayMs,
      reason: largest.reason,
      configuredVadSilenceMs: timing.configuredVadSilenceMs,
      totalSpeechEndToFirstAudioMs: timing.totalSpeechEndToFirstAudioMs,
      toolUsed: timing.toolUsed ?? false,
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
    clearTimeout(this.bookingWatchdog);
    clearTimeout(this.playbackDeadline);
    this.clearResponseWatchdog();
    this.clearPendingTurnCommit("connection_closed");
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
    this.traceBooking("state_changed", { from: previous, finalState: next, ...details });
  }
}

type RealtimeTurnState = "listening" | "user_speaking" | "thinking" | "assistant_speaking" | "tool_running" | "interrupted";

interface AudioMetrics {
  rms: number;
  peak: number;
  durationMs: number;
}

interface PendingBargeIn {
  serverVadEventId?: string;
  detectedAt: number;
  assistantPlaybackMs: number;
  turnState: RealtimeTurnState;
  consecutiveSpeechMs: number;
  totalSpeechDurationMs: number;
  totalRmsDuration: number;
  maxRmsDuringSpeech: number;
  maxPeakDuringSpeech: number;
  requiredRms: number;
  requiredSpeechMs: number;
}

interface TimedAudioMetrics extends AudioMetrics {
  observedAt: number;
}

interface PendingTurnCommit {
  timer?: ReturnType<typeof setTimeout>;
  commitTimer?: ReturnType<typeof setTimeout>;
  itemId?: string;
  speechStoppedAt: number;
  serverVadEventId?: string;
  turnNumber: number;
  audioFrames: number;
  audioDurationMs: number;
  speechDurationMs: number;
  startingState: RealtimeTurnState;
  bargeInOccurred: boolean;
  patienceElapsed: boolean;
  speechCommitted: boolean;
  responseRequested?: boolean;
  committedAt?: number;
  decisionAt?: number;
  responseRequestedAt?: number;
}

interface ActiveCallerTurn {
  turnNumber: number;
  itemId?: string;
  speechStartedAt: number;
  audioFrames: number;
  audioDurationMs: number;
  startingState: RealtimeTurnState;
}

interface ResponseTurnTiming {
  turnNumber: number;
  speechStoppedAt: number;
  speechDurationMs: number;
  startingState: RealtimeTurnState;
  committedAt?: number;
  decisionAt?: number;
  responseRequestedAt: number;
  responseStartedAt: number;
  firstAudioReceivedAt?: number;
  toolDurationMs?: number;
  bargeInOccurred: boolean;
  toolStartedAtByCallId: Map<string, number>;
}

function audioMetrics(frame: AudioFrame): AudioMetrics {
  const sampleCount = Math.floor(frame.data.byteLength / 2);
  if (sampleCount === 0) return { rms: 0, peak: 0, durationMs: 0 };
  const view = new DataView(frame.data.buffer, frame.data.byteOffset, frame.data.byteLength);
  let sumSquares = 0;
  let peak = 0;
  for (let index = 0; index < sampleCount; index += 1) {
    const sample = view.getInt16(index * 2, true) / 0x8000;
    sumSquares += sample * sample;
    peak = Math.max(peak, Math.abs(sample));
  }
  return {
    rms: Math.sqrt(sumSquares / sampleCount),
    peak,
    durationMs: (sampleCount * 1_000) / frame.sampleRate,
  };
}

function roundAudioMetric(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

class SDKRealtimeConnection implements RealtimeConnection {
  private readonly realtime: OpenAIRealtimeWS;
  private readonly opened: Promise<void>;
  private eventHandler?: (event: unknown) => void;
  private readonly pendingEvents: unknown[] = [];

  constructor(input: { apiKey: string; model: string }) {
    const client = new OpenAI({ apiKey: input.apiKey });
    this.realtime = new OpenAIRealtimeWS({ model: input.model, options: { handshakeTimeout: REALTIME_PROGRESS_TIMEOUT_MS } }, client);
    this.opened = new Promise((resolve, reject) => {
      const onOpen = () => { cleanup(); resolve(); };
      const onError = (error: Error) => { cleanup(); reject(error); };
      const onClose = () => { cleanup(); reject(new Error("Realtime connection closed before opening")); };
      const cleanup = () => {
        this.realtime.socket.off("open", onOpen);
        this.realtime.socket.off("error", onError);
        this.realtime.socket.off("close", onClose);
      };
      this.realtime.socket.once("open", onOpen);
      this.realtime.socket.once("error", onError);
      this.realtime.socket.once("close", onClose);
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

const toolResultLogDetails = (result: ToolResultEnvelope): Record<string, unknown> => {
  if (!result.ok || !isRecord(result.data)) return { toolCallId: result.toolCallId, ok: result.ok };
  const data = result.data;
  return {
    toolCallId: result.toolCallId,
    ok: true,
    ...(typeof data.clinicTimezone === "string" ? { clinicTimezone: data.clinicTimezone } : {}),
    ...(typeof data.earliestSlotUtc === "string" ? { earliestSlotUtc: data.earliestSlotUtc } : {}),
    ...(typeof data.earliestSlotLocal === "string" ? { earliestSlotLocal: data.earliestSlotLocal } : {}),
    ...(typeof data.earliestSlotDisplay === "string" ? { earliestSlotDisplay: data.earliestSlotDisplay } : {}),
  };
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
    ["responseDelayMs", options.responseDelayMs],
  ] as const) {
    if (value !== undefined && (!Number.isInteger(value) || value < 0)) {
      throw new Error(`${name} must be a non-negative integer`);
    }
  }
  return { ...options };
}
