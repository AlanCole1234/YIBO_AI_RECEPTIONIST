import type { BusinessDirectory } from "../../business/index.js";
import type { AgentDefinitionFactory } from "../../agents/index.js";
import type {
  ConversationServiceContract,
  ConversationSession,
} from "../../conversation/index.js";
import type { VoiceMediaGateway } from "../../voice/index.js";
import type { CallOrchestrator, CallRecord, CallState, TelephonyEvent } from "./contracts.js";
import type { CallRepository } from "../ports/call-repository.js";
import type {
  CallCustomerDirectory,
  CallTelephonyGateway,
} from "../ports/call-dependencies.js";

const terminalStates = new Set<CallState>(["COMPLETED", "FAILED", "TRANSFERRED"]);

export class CallOrchestratorService implements CallOrchestrator {
  private readonly sessions = new Map<string, ConversationSession>();
  private readonly incomingCalls = new Map<string, Promise<void>>();

  constructor(
    private readonly businessDirectory: BusinessDirectory,
    private readonly customers: CallCustomerDirectory,
    private readonly telephony: CallTelephonyGateway,
    private readonly agents: AgentDefinitionFactory,
    private readonly voice: VoiceMediaGateway,
    private readonly conversations: ConversationServiceContract,
    private readonly calls: CallRepository,
  ) {}

  async handleTelephonyEvent(event: TelephonyEvent): Promise<void> {
    if (event.type === "INCOMING_CALL") {
      const existing = this.incomingCalls.get(event.callId);
      if (existing) return existing;
      // Claim startup before any repository/telephony await can admit a replay.
      const starting = this.handleIncoming(event).finally(() => this.incomingCalls.delete(event.callId));
      this.incomingCalls.set(event.callId, starting);
      return starting;
    }
    if (event.type === "CALL_HUNG_UP") {
      try {
        await this.incomingCalls.get(event.callId);
      } finally {
        await this.shutdown(event.callId, event.occurredAt);
      }
      return;
    }
    // DTMF is persisted by the telephony implementation if required; it does not alter call state.
  }

  async interrupt(callId: string, position?: import("../../conversation/index.js").AssistantPlaybackPosition): Promise<void> {
    await this.sessions.get(callId)?.interrupt(position);
  }

  private async handleIncoming(event: Extract<TelephonyEvent, { type: "INCOMING_CALL" }>): Promise<void> {
    if (await this.calls.findByCallId(event.callId)) return;

    const business = await this.businessDirectory.getBusinessByCalledNumber(event.to);
    if (!business.ok) {
      await this.telephony.hangup(event.callId);
      return;
    }

    const record: CallRecord = {
      callId: event.callId,
      tenantId: business.value.tenantId,
      from: event.from,
      to: event.to,
      state: "RINGING",
      createdAt: event.occurredAt,
      updatedAt: event.occurredAt,
    };
    await this.calls.create(record);

    const answered = await this.telephony.answer(event.callId);
    if (!answered.ok) return this.fail(record.callId, event.occurredAt);
    await this.transition(record.callId, "ANSWERED", event.occurredAt);

    const customer = await this.customers.findOrCreateByPhone({ tenantId: record.tenantId, phone: event.from });
    if (!customer.ok) return this.fail(record.callId, event.occurredAt);
    await this.calls.setCustomer(record.callId, customer.value.id, event.occurredAt);
    await this.transition(record.callId, "AI_CONNECTING", event.occurredAt);

    const agent = await this.agents.prepare({
      callId: record.callId,
      tenantId: record.tenantId,
      customerId: customer.value.id,
    });
    if (!agent.ok) return this.fail(record.callId, event.occurredAt);

    const media = await this.voice.open(record.callId);
    if (!media.ok) return this.fail(record.callId, event.occurredAt);

    let conversation: ConversationSession;
    try {
      conversation = await this.conversations.start({
        conversationId: record.callId,
        agent: agent.value,
        transport: media.value,
        ...(media.value.observeEvent ? { observeEvent: media.value.observeEvent } : {}),
      });
    } catch (error) {
      console.error(JSON.stringify({
        event: "call.realtime.start_failed",
        callId: record.callId,
        tenantId: record.tenantId,
        layer: "realtime_ai_session",
        error: safeErrorMessage(error),
      }));
      await media.value.close();
      return this.fail(record.callId, event.occurredAt);
    }

    this.sessions.set(record.callId, conversation);
    await this.transition(record.callId, "IN_CONVERSATION", event.occurredAt);
    // A dead runtime must not leave an answered telephone channel silently open.
    void conversation.completed.then(async completion => {
      if (this.sessions.get(record.callId) !== conversation) return;
      this.sessions.delete(record.callId);
      await conversation.close();
      await this.transition(record.callId, completion.status === "failed" ? "FAILED" : "COMPLETED", new Date().toISOString());
      await this.telephony.hangup(record.callId);
    }).catch(error => console.error(JSON.stringify({
      event: "call.conversation.cleanup_failed", callId: record.callId, error: safeErrorMessage(error),
    })));
    // `voice.open` has prepared the transport and `conversations.start` has
    // opened Realtime. Start exactly one greeting only after both are ready.
    await conversation.startGreeting();
  }

  private async shutdown(callId: string, occurredAt: string): Promise<void> {
    const record = await this.calls.findByCallId(callId);
    if (!record || terminalStates.has(record.state)) {
      console.log(JSON.stringify({ event: "telephony.call.cleanup", callId, status: "already_terminal_or_untracked" }));
      return;
    }

    const session = this.sessions.get(callId);
    if (session) {
      this.sessions.delete(callId);
      await session.close();
    }
    await this.transition(callId, "COMPLETED", occurredAt);
    console.log(JSON.stringify({ event: "telephony.call.cleanup", callId, status: "completed" }));
  }

  private async fail(callId: string, occurredAt: string): Promise<void> {
    await this.telephony.hangup(callId);
    await this.transition(callId, "FAILED", occurredAt);
  }

  private async transition(callId: string, state: CallState, occurredAt: string): Promise<void> {
    await this.calls.updateState(callId, state, occurredAt);
  }
}

const safeErrorMessage = (error: unknown): string => {
  const message = error instanceof Error ? error.message : "Unexpected realtime startup error";
  return message
    .replace(/\b(sk-[A-Za-z0-9_-]+|Bearer\s+\S+|Authorization:\s*\S+)/gi, "[redacted]")
    .slice(0, 500);
};
