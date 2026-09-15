import type { AgentToolResult } from "../../agents/index.js";
import { performance } from "node:perf_hooks";
import type {
  ConversationRuntimeEvent,
  ToolResultEnvelope,
} from "../ports/conversation-runtime-port.js";
import type {
  ConversationCompletion,
  ConversationError,
  ConversationServiceContract,
  ConversationServiceDependencies,
  ConversationSession,
  ConversationSessionControllerDependencies,
  StartConversationCommand,
} from "./contracts.js";

const TOOL_TIMEOUT_MS = 12_000;
const AUDIO_WRITE_TIMEOUT_MS = 5_000;
const calendarMutation = (name: string): boolean => ["create_appointment", "reschedule_appointment", "cancel_appointment"].includes(name);

export class ConversationService implements ConversationServiceContract {
  constructor(private readonly dependencies: ConversationServiceDependencies) {}

  async start(command: StartConversationCommand): Promise<ConversationSession> {
    const runtimeSession = await this.dependencies.runtime.openSession({
      conversationId: command.conversationId,
      ...(command.transport.bargeInEnabled === undefined ? {} : { bargeInEnabled: command.transport.bargeInEnabled }),
      agent: {
        instructions: command.agent.instructions,
        locale: command.agent.locale,
        ...(command.agent.voice ? { voice: command.agent.voice } : {}),
        tools: command.agent.tools,
        conversation: structuredClone(command.agent.conversation),
      },
    });

    return new ActiveConversationSession({
      runtimeSession,
      command,
      ...(this.dependencies.usageRecorder ? { usageRecorder: this.dependencies.usageRecorder } : {}),
    });
  }
}

class ActiveConversationSession implements ConversationSession {
  readonly completed: Promise<ConversationCompletion>;

  private resolveCompleted!: (completion: ConversationCompletion) => void;
  private completionSettled = false;
  private closePromise?: Promise<void>;
  private interruptedTurnId?: string;
  private suppressNextBargeIn = false;
  private runtimeResponseActive = false;
  private unsubscribePlaybackIdle?: () => void;
  private readonly handledTools = new Set<string>();
  private readonly pendingOperations = new Set<() => void>();
  private mutationInFlight = false;
  private mutationOutcomeUnknown = false;

  constructor(private readonly dependencies: ConversationSessionControllerDependencies) {
    this.completed = new Promise((resolve) => { this.resolveCompleted = resolve; });
    this.unsubscribePlaybackIdle = this.dependencies.command.transport.outboundAudio.onPlaybackIdle?.(() => {
      this.dependencies.runtimeSession.assistantPlaybackEnded?.();
    });
    void this.forwardInboundAudio();
    void this.consumeRuntimeEvents();
  }

  interrupt(position?: import("../ports/conversation-runtime-port.js").AssistantPlaybackPosition): Promise<void> {
    if (position) this.interruptedTurnId = position.assistantTurnId;
    return this.dependencies.runtimeSession.interrupt(position);
  }

  startGreeting(): Promise<void> {
    return this.dependencies.runtimeSession.startGreeting?.() ?? Promise.resolve();
  }

  sendText(text: string): Promise<void> {
    return this.dependencies.runtimeSession.sendText(text);
  }

  close(): Promise<void> {
    if (!this.closePromise) {
      this.closePromise = this.closeResources();
    }
    return this.closePromise;
  }

  private async forwardInboundAudio(): Promise<void> {
    try {
      for await (const frame of this.dependencies.command.transport.inboundAudio) {
        await this.dependencies.runtimeSession.sendAudio(frame);
      }
    } catch (error) {
      await this.fail({
        code: "AUDIO_TRANSPORT_ERROR",
        message: errorMessage(error),
      });
    }
  }

  private async consumeRuntimeEvents(): Promise<void> {
    try {
      for await (const event of this.dependencies.runtimeSession.events()) {
        await this.handleRuntimeEvent(event);
        if (event.type === "closed" || event.type === "error") return;
      }
      if (!this.completionSettled && !this.closePromise) {
        this.settle({ status: "closed", reason: "runtime_stream_ended" });
        await this.close();
      }
    } catch (error) {
      await this.fail({
        code: "RUNTIME_ERROR",
        message: errorMessage(error),
        retryable: false,
      });
    }
  }

  private async handleRuntimeEvent(event: ConversationRuntimeEvent): Promise<void> {
    if (this.completionSettled || this.closePromise) return;
    this.observe(event);
    switch (event.type) {
      case "audio.delta":
        if (event.assistantTurnId === this.interruptedTurnId) return;
        this.interruptedTurnId = undefined;
        try {
          const result = await this.withDeadline(
            this.dependencies.command.transport.outboundAudio.write(event.frame, event.assistantTurnId), AUDIO_WRITE_TIMEOUT_MS,
          );
          if (result.timedOut) await this.fail({ code: "AUDIO_TRANSPORT_ERROR", message: "Audio playback stopped accepting frames." });
        } catch (error) {
          await this.fail({ code: "AUDIO_TRANSPORT_ERROR", message: errorMessage(error) });
        }
        return;
      case "assistant.response_timing":
        this.dependencies.command.transport.outboundAudio.observeResponseTiming?.(event);
        return;
      case "tool.call":
        void this.executeTool(event);
        return;
      case "barge_in.detected":
        this.logBargeIn(event);
        return;
      case "user.speech_started":
        if (this.suppressNextBargeIn) {
          this.suppressNextBargeIn = false;
          return;
        }
        await this.handleBargeIn();
        return;
      case "error":
        await this.fail({
          code: "RUNTIME_ERROR",
          message: event.message,
          retryable: event.retryable,
        });
        return;
      case "closed":
        this.settle({ status: "closed", ...(event.reason ? { reason: event.reason } : {}) });
        await this.close();
        return;
      case "assistant.response_done":
        this.runtimeResponseActive = false;
        return;
      case "assistant.response_created":
        this.runtimeResponseActive = true;
        return;
      case "assistant.audio_completed":
      case "assistant.transcript":
      case "silence.timeout":
        return;
      case "user.speech_stopped":
        return;
      case "usage":
        // Accounting must not hold up audio, barge-in, or the next tool result.
        void this.recordUsage(event).catch(() => console.error(JSON.stringify({ event: "conversation.usage_recording_failed", callId: this.dependencies.command.conversationId })));
        return;
    }
  }

  private async recordUsage(event: Extract<ConversationRuntimeEvent, { type: "usage" }>): Promise<void> {
    if (!this.dependencies.usageRecorder) return;
    await this.dependencies.usageRecorder.record({
      tenantId: this.dependencies.command.agent.trustedContext.tenantId,
      callId: this.dependencies.command.agent.trustedContext.callId,
      occurredAt: new Date().toISOString(),
      inputTokens: event.inputTokens ?? 0,
      outputTokens: event.outputTokens ?? 0,
      inputAudioMs: event.inputAudioMs ?? 0,
      outputAudioMs: event.outputAudioMs ?? 0,
      toolCalls: event.toolCalls ?? 0,
    });
  }

  private async handleBargeIn(): Promise<void> {
    const position = await this.dependencies.command.transport.outboundAudio.interrupt?.();
    if (!position && !this.runtimeResponseActive) return;
    if (position) this.interruptedTurnId = position.assistantTurnId;
    await this.dependencies.runtimeSession.interrupt(position);
  }

  private logBargeIn(event: Extract<ConversationRuntimeEvent, { type: "barge_in.detected" }>): void {
    const playback = this.dependencies.command.transport.outboundAudio.getBargeInDiagnostics?.();
    const echoRejected = event.accepted && playback?.echoSuspected === true;
    if (echoRejected) this.suppressNextBargeIn = true;
    console.log(JSON.stringify({
      event: "telephony.barge_in.detected",
      currentTurnState: event.turnState,
      serverVadEventId: event.serverVadEventId,
      inboundRms: event.inboundRms,
      inboundPeak: event.inboundPeak,
      adaptiveNoiseFloor: event.adaptiveNoiseFloor,
      requiredRms: event.requiredRms,
      requiredSpeechMs: event.requiredSpeechMs,
      consecutiveSpeechMs: event.consecutiveSpeechMs,
      maxRmsDuringSpeech: event.maxRmsDuringSpeech,
      averageRmsDuringSpeech: event.averageRmsDuringSpeech,
      maxPeakDuringSpeech: event.maxPeakDuringSpeech,
      totalSpeechDurationMs: event.totalSpeechDurationMs,
      consecutiveAboveThresholdMs: event.consecutiveAboveThresholdMs,
      assistantPlaybackMs: playback?.assistantPlaybackMs ?? event.assistantPlaybackMs,
      outboundYiboRtpPlaying: playback?.outboundRtpPlaying ?? false,
      outboundQueueDepth: playback?.outboundQueueDepth ?? 0,
      echoCorrelation: playback?.echoCorrelation,
      echoSuspected: playback?.echoSuspected ?? false,
      realtimeResponseActive: event.realtimeResponseActive,
      assistantPlaybackActive: playback?.outboundRtpPlaying ?? false,
      accepted: echoRejected ? false : event.accepted,
      reason: echoRejected ? "outbound_audio_echo_suspected" : event.reason,
    }));
  }

  private async executeTool(event: Extract<ConversationRuntimeEvent, { type: "tool.call" }>): Promise<void> {
    if (this.handledTools.has(event.toolCallId) || this.completionSettled) return;
    this.handledTools.add(event.toolCallId);
    const startedAt = performance.now();
    this.observe({ type: "tool.execution", phase: "started", toolCallId: event.toolCallId, name: event.name });
    const mutation = calendarMutation(event.name);
    let result: ToolResultEnvelope;
    if (mutation && (this.mutationInFlight || this.mutationOutcomeUnknown)) {
      result = uncertainMutation(event.toolCallId);
    } else try {
      if (mutation) this.mutationInFlight = true;
      const outcome = await this.withDeadline(this.dependencies.command.agent.toolExecutor.execute(
        this.dependencies.command.agent.trustedContext, { toolCallId: event.toolCallId, name: event.name, arguments: event.arguments },
      ), TOOL_TIMEOUT_MS);
      if (outcome.timedOut) {
        if (mutation) this.mutationOutcomeUnknown = true;
        result = mutation ? uncertainMutation(event.toolCallId) : {
          toolCallId: event.toolCallId, ok: false, error: {
            code: "TOOL_TIMEOUT", message: "The lookup took too long. Briefly apologize and offer to check again. Do not invent a result.", retryable: true,
          },
        };
      } else {
        if (outcome.value === undefined) return; // Session closed while the tool was pending.
        result = toEnvelope(outcome.value);
      }
    } catch {
      if (mutation) this.mutationOutcomeUnknown = true;
      // A tool failure is a conversational result, not a reason to hang up.
      // Do not expose provider exception text or automatically retry a mutation.
      result = { toolCallId: event.toolCallId, ok: false, error: {
        code: "TOOL_EXECUTION_ERROR",
        message: "The operation could not be completed. Explain the failure briefly and ask the caller how they would like to proceed. Do not claim success or automatically retry.",
        retryable: false,
      } };
    } finally { if (mutation) this.mutationInFlight = false; }
    if (this.closePromise || this.completionSettled) return;
    this.observe({ type: "tool.execution", phase: result.ok ? "completed" : "failed", toolCallId: event.toolCallId, name: event.name });
    console.log(JSON.stringify({ event: "conversation.tool_timing", callId: this.dependencies.command.conversationId,
      toolCallId: event.toolCallId, toolName: event.name, durationMs: Math.round(performance.now() - startedAt), ok: result.ok }));
    try {
      await this.dependencies.runtimeSession.sendToolResult(result);
    } catch (error) {
      await this.fail({ code: "RUNTIME_ERROR", message: errorMessage(error), retryable: false });
    }
  }

  private observe(event: Parameters<NonNullable<StartConversationCommand["observeEvent"]>>[0]): void {
    try { this.dependencies.command.observeEvent?.(event); }
    catch { console.error(JSON.stringify({ event: "conversation.observer_failed", callId: this.dependencies.command.conversationId })); }
  }

  private withDeadline<T>(operation: Promise<T>, milliseconds: number): Promise<{ timedOut: boolean; value?: T }> {
    return new Promise((resolve, reject) => {
      const cancel = () => { cleanup(); resolve({ timedOut: false }); };
      const cleanup = () => { clearTimeout(timer); this.pendingOperations.delete(cancel); };
      const timer = setTimeout(() => { cleanup(); resolve({ timedOut: true }); }, milliseconds);
      this.pendingOperations.add(cancel);
      // A late result is deliberately not delivered as a second tool result.
      // The underlying operation may still complete; a timeout is not cancellation.
      operation.then(value => { cleanup(); resolve({ timedOut: false, value }); }, error => { cleanup(); reject(error); });
    });
  }

  private async fail(error: ConversationError): Promise<void> {
    this.settle({ status: "failed", error });
    await this.close();
  }

  private async closeResources(): Promise<void> {
    for (const cancel of this.pendingOperations) cancel();
    this.dependencies.command.agent.toolExecutor.releaseCall?.(this.dependencies.command.agent.trustedContext);
    this.unsubscribePlaybackIdle?.();
    this.unsubscribePlaybackIdle = undefined;
    const results = await Promise.allSettled([
      this.withDeadline(Promise.resolve().then(() => this.dependencies.runtimeSession.close()), AUDIO_WRITE_TIMEOUT_MS),
      this.withDeadline(Promise.resolve().then(() => this.dependencies.command.transport.close()), AUDIO_WRITE_TIMEOUT_MS),
    ]);
    if (!this.completionSettled) {
      const rejection = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
      if (rejection) {
        this.settle({
          status: "failed",
          error: { code: "RUNTIME_ERROR", message: errorMessage(rejection.reason), retryable: false },
        });
      } else if (results.some(result => result.status === "fulfilled" && result.value.timedOut)) {
        this.settle({ status: "failed", error: { code: "RUNTIME_ERROR", message: "Conversation cleanup timed out.", retryable: false } });
      } else {
        this.settle({ status: "closed" });
      }
    }
  }

  private settle(completion: ConversationCompletion): void {
    if (this.completionSettled) return;
    this.completionSettled = true;
    this.resolveCompleted(completion);
  }

}

const toEnvelope = (result: AgentToolResult): ToolResultEnvelope => result.ok
  ? { toolCallId: result.toolCallId, ok: true, data: result.data }
  : {
      toolCallId: result.toolCallId,
      ok: false,
      error: {
        code: result.error.code,
        message: result.error.messageForAgent,
        retryable: result.error.retryable,
      },
    };

const errorMessage = (error: unknown): string => error instanceof Error ? error.message : "Unexpected conversation failure";

const uncertainMutation = (toolCallId: string): ToolResultEnvelope => ({
  toolCallId, ok: false, error: {
    code: "APPOINTMENT_OUTCOME_UNKNOWN",
    message: "An appointment change is still pending or its outcome could not be verified. It may have completed. Do not claim success or failure, and do not retry or make another appointment change in this call. Explain the uncertainty and ask the caller to have the clinic verify the calendar before making another booking.",
    retryable: false,
  },
});
