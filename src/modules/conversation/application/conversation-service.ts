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

  constructor(private readonly dependencies: ConversationSessionControllerDependencies) {
    this.completed = new Promise((resolve) => { this.resolveCompleted = resolve; });
    void this.forwardInboundAudio();
    void this.consumeRuntimeEvents();
  }

  interrupt(position?: import("../ports/conversation-runtime-port.js").AssistantPlaybackPosition): Promise<void> {
    if (position) this.interruptedTurnId = position.assistantTurnId;
    return this.dependencies.runtimeSession.interrupt(position);
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
    } catch (error) {
      await this.fail({
        code: "RUNTIME_ERROR",
        message: errorMessage(error),
        retryable: false,
      });
    }
  }

  private async handleRuntimeEvent(event: ConversationRuntimeEvent): Promise<void> {
    this.dependencies.command.observeEvent?.(event);
    switch (event.type) {
      case "audio.delta":
        if (event.assistantTurnId === this.interruptedTurnId) return;
        this.interruptedTurnId = undefined;
        try {
          await this.dependencies.command.transport.outboundAudio.write(event.frame, event.assistantTurnId);
        } catch (error) {
          await this.fail({ code: "AUDIO_TRANSPORT_ERROR", message: errorMessage(error) });
        }
        return;
      case "tool.call":
        void this.executeTool(event);
        return;
      case "user.speech_started":
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
        await this.recordUsage(event);
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
    this.dependencies.command.observeEvent?.({ type: "tool.execution", phase: "started", toolCallId: event.toolCallId, name: event.name });
    try {
      const result = await this.dependencies.command.agent.toolExecutor.execute(
        this.dependencies.command.agent.trustedContext,
        {
          toolCallId: event.toolCallId,
          name: event.name,
          arguments: event.arguments,
        },
      );
      await this.dependencies.runtimeSession.sendToolResult(toEnvelope(result));
      this.dependencies.command.observeEvent?.({ type: "tool.execution", phase: result.ok ? "completed" : "failed", toolCallId: event.toolCallId, name: event.name });
    } catch (error) {
      this.dependencies.command.observeEvent?.({ type: "tool.execution", phase: "failed", toolCallId: event.toolCallId, name: event.name });
      await this.fail({ code: "TOOL_EXECUTION_ERROR", message: errorMessage(error) });
    }
  }

  private async fail(error: ConversationError): Promise<void> {
    this.settle({ status: "failed", error });
    await this.close();
  }

  private async closeResources(): Promise<void> {
    const results = await Promise.allSettled([
      this.dependencies.runtimeSession.close(),
      this.dependencies.command.transport.close(),
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
      },
    };

const errorMessage = (error: unknown): string => error instanceof Error ? error.message : "Unexpected conversation failure";
