import type { AgentToolResult } from "../../agents/index.js";
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

export class ConversationService implements ConversationServiceContract {
  constructor(private readonly dependencies: ConversationServiceDependencies) {}

  async start(command: StartConversationCommand): Promise<ConversationSession> {
    const runtimeSession = await this.dependencies.runtime.openSession({
      conversationId: command.conversationId,
      agent: {
        instructions: command.agent.instructions,
        locale: command.agent.locale,
        ...(command.agent.voice ? { voice: command.agent.voice } : {}),
        tools: command.agent.tools,
        conversation: structuredClone(command.agent.conversation),
        audio: structuredClone(command.agent.audio),
        behavior: structuredClone(command.agent.behavior),
        toolChoice: command.agent.toolChoice,
        parallelToolCalls: command.agent.parallelToolCalls,
        channel: command.agent.channel,
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
  private turnSequence = 0;
  private readonly toolCalls = new Set<string>();
  private readonly deadlines = new Set<() => void>();
  private mutationPending = false;
  private mutationUncertain = false;

  constructor(private readonly dependencies: ConversationSessionControllerDependencies) {
    this.completed = new Promise((resolve) => { this.resolveCompleted = resolve; });
    void this.forwardInboundAudio();
    void this.consumeRuntimeEvents();
  }

  interrupt(position?: import("../ports/conversation-runtime-port.js").AssistantPlaybackPosition): Promise<void> {
    if (position) this.interruptedTurnId = position.assistantTurnId;
    return this.dependencies.runtimeSession.interrupt(position);
  }

  async sendText(text: string): Promise<void> {
    await this.dependencies.runtimeSession.sendText(text);
    this.turnSequence += 1;
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
        await this.bounded(this.dependencies.runtimeSession.sendAudio(frame), 5_000);
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
      if (!this.closePromise && !this.completionSettled) { this.settle({status:"closed",reason:"runtime_stream_ended"}); await this.close(); }
    } catch (error) {
      await this.fail({
        code: "RUNTIME_ERROR",
        message: errorMessage(error),
        retryable: false,
      });
    }
  }

  private async handleRuntimeEvent(event: ConversationRuntimeEvent): Promise<void> {
    if (this.closePromise || this.completionSettled) return;
    this.observe(event);
    switch (event.type) {
      case "audio.delta":
        if (event.assistantTurnId === this.interruptedTurnId) return;
        this.interruptedTurnId = undefined;
        try {
          await this.bounded(this.dependencies.command.transport.outboundAudio.write(event.frame, event.assistantTurnId), 5_000);
        } catch (error) {
          await this.fail({ code: "AUDIO_TRANSPORT_ERROR", message: errorMessage(error) });
        }
        return;
      case "tool.call":
        void this.executeTool(event);
        return;
      case "user.speech_started":
        this.turnSequence += 1;
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
      case "assistant.response_created":
      case "assistant.audio_completed":
      case "assistant.transcript":
      case "silence.timeout":
        return;
      case "user.speech_stopped":
        return;
      case "usage":
        void this.recordUsage(event).catch(() => undefined);
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
    if (!position) return;
    this.interruptedTurnId = position.assistantTurnId;
    await this.dependencies.runtimeSession.interrupt(position);
  }

  private async executeTool(event: Extract<ConversationRuntimeEvent, { type: "tool.call" }>): Promise<void> {
    if (this.toolCalls.has(event.toolCallId) || this.closePromise) return;
    this.toolCalls.add(event.toolCallId);
    this.observe({type:"tool.execution",phase:"started",toolCallId:event.toolCallId,name:event.name});
    const mutable = ["create_appointment", "cancel_appointment", "reschedule_appointment", "transfer_to_human", "update_customer"].includes(event.name);
    let result: ToolResultEnvelope;
    if (mutable && (this.mutationPending || this.mutationUncertain)) {
      result = {toolCallId:event.toolCallId,ok:false,error:{code:"ACTION_OUTCOME_UNKNOWN",message:"A prior action is pending or uncertain. Do not retry or claim success; ask staff to verify it.",retryable:false}};
    } else {
      if (mutable) this.mutationPending = true;
      try {
        const executed = await this.bounded(this.dependencies.command.agent.toolExecutor.execute(
          { ...this.dependencies.command.agent.trustedContext, turnSequence: this.turnSequence },
          {toolCallId:event.toolCallId,name:event.name,arguments:event.arguments},
        ), 12_000);
        result = toEnvelope(executed);
      } catch (error) {
        if (error instanceof CallDeadlineError && mutable) this.mutationUncertain = true;
        result = {toolCallId:event.toolCallId,ok:false,error:{
          code: error instanceof CallDeadlineError ? (mutable ? "ACTION_OUTCOME_UNKNOWN" : "TOOL_TIMEOUT") : "TOOL_EXECUTION_FAILED",
          message: error instanceof CallDeadlineError && mutable ? "The action may have completed. Do not claim success or retry; ask staff to verify it." : "The operation did not complete. Explain the failure without claiming success.",retryable:false,
        }};
      } finally { if (mutable) this.mutationPending = false; }
    }
    if (this.closePromise || this.completionSettled) return;
    try {
      await this.bounded(this.dependencies.runtimeSession.sendToolResult(result), 5_000);
      this.observe({type:"tool.execution",phase:result.ok?"completed":"failed",toolCallId:event.toolCallId,name:event.name});
    } catch { if (!this.closePromise) await this.fail({code:"TOOL_EXECUTION_ERROR",message:"Tool result delivery failed"}); }
  }

  private observe(event: ConversationRuntimeEvent): void {
    try { this.dependencies.command.observeEvent?.(event); } catch { /* Observation cannot block or terminate a call. */ }
  }

  private bounded<T>(operation: Promise<T>, durationMs: number): Promise<T> {
    return new Promise<T>((resolve,reject) => {
      const cancel = () => { clearTimeout(timer); this.deadlines.delete(cancel); reject(new CallDeadlineError()); };
      const timer = setTimeout(cancel,durationMs);
      this.deadlines.add(cancel);
      operation.then(resolve,reject).finally(() => {clearTimeout(timer);this.deadlines.delete(cancel);});
    });
  }

  private async fail(error: ConversationError): Promise<void> {
    this.settle({ status: "failed", error });
    await this.close();
  }

  private async closeResources(): Promise<void> {
    for (const cancel of [...this.deadlines]) cancel();
    const results = await Promise.allSettled([
      this.bounded(Promise.resolve().then(() => this.dependencies.runtimeSession.close()), 5_000),
      this.bounded(Promise.resolve().then(() => this.dependencies.command.transport.close()), 5_000),
    ]);
    if (!this.completionSettled) {
      const rejection = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
      if (rejection) {
        this.settle({
          status: "failed",
          error: { code: "RUNTIME_ERROR", message: errorMessage(rejection.reason), retryable: false },
        });
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
        ...(result.error.confirmationToken ? { confirmationToken: result.error.confirmationToken } : {}),
      },
    };

const errorMessage = (error: unknown): string => error instanceof Error ? error.message : "Unexpected conversation failure";

class CallDeadlineError extends Error {}
