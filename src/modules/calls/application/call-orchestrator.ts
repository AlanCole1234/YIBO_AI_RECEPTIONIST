import type { BusinessDirectory } from "../../business/index.js";
import type { CallOrchestrator, CallRecord, CallState, TelephonyEvent } from "./contracts.js";
import type { CallRepository } from "../ports/call-repository.js";
import type {
  CallAgentRuntime,
  CallAgentSession,
  CallCustomerDirectory,
  CallTelephonyGateway,
  CallVoiceBridge,
  CallVoiceSession,
} from "../ports/call-dependencies.js";

const terminalStates = new Set<CallState>(["COMPLETED", "FAILED", "TRANSFERRED"]);

export class CallOrchestratorService implements CallOrchestrator {
  private readonly sessions = new Map<string, { agent: CallAgentSession; voice: CallVoiceSession }>();

  constructor(
    private readonly businessDirectory: BusinessDirectory,
    private readonly customers: CallCustomerDirectory,
    private readonly telephony: CallTelephonyGateway,
    private readonly agents: CallAgentRuntime,
    private readonly voice: CallVoiceBridge,
    private readonly calls: CallRepository,
  ) {}

  async handleTelephonyEvent(event: TelephonyEvent): Promise<void> {
    if (event.type === "INCOMING_CALL") return this.handleIncoming(event);
    if (event.type === "CALL_HUNG_UP") return this.shutdown(event.callId, event.occurredAt);
    // DTMF is persisted by the telephony implementation if required; it does not alter call state.
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

    const agent = await this.agents.startSession({
      callId: record.callId,
      tenantId: record.tenantId,
      customerId: customer.value.id,
    });
    if (!agent.ok) return this.fail(record.callId, event.occurredAt);

    const voice = await this.voice.start({ callId: record.callId, agentSession: agent.value });
    if (!voice.ok) {
      await agent.value.close();
      return this.fail(record.callId, event.occurredAt);
    }

    this.sessions.set(record.callId, { agent: agent.value, voice: voice.value });
    await this.transition(record.callId, "IN_CONVERSATION", event.occurredAt);
  }

  private async shutdown(callId: string, occurredAt: string): Promise<void> {
    const record = await this.calls.findByCallId(callId);
    if (!record || terminalStates.has(record.state)) return;

    const session = this.sessions.get(callId);
    if (session) {
      await session.voice.close();
      await session.agent.close();
      this.sessions.delete(callId);
    }
    await this.transition(callId, "COMPLETED", occurredAt);
  }

  private async fail(callId: string, occurredAt: string): Promise<void> {
    await this.telephony.hangup(callId);
    await this.transition(callId, "FAILED", occurredAt);
  }

  private async transition(callId: string, state: CallState, occurredAt: string): Promise<void> {
    await this.calls.updateState(callId, state, occurredAt);
  }
}
