import { describe, expect, it, vi } from "vitest";
import { BusinessDirectoryService, InMemoryBusinessRepository, type BusinessProfile } from "../../src/modules/business/index.js";
import { CallOrchestratorService, InMemoryCallRepository, type CallAgentRuntime, type CallCustomerDirectory, type CallTelephonyGateway, type CallVoiceBridge } from "../../src/modules/calls/index.js";

const business: BusinessProfile = {
  tenantId: "tenant-smileline", businessId: "business-smileline", name: "SmileLine Dental", timezone: "America/Denver", locale: "en-US", active: true,
  calledNumbers: ["+13035550123"], employees: [], services: [], openingHours: [],
};

const incoming = { type: "INCOMING_CALL" as const, callId: "call-1", from: "+13035550999", to: "+13035550123", occurredAt: "2026-08-09T18:00:00.000Z" };

const createOrchestrator = (overrides: { agentOk?: boolean; customerOk?: boolean } = {}) => {
  const repository = new InMemoryCallRepository();
  const telephony: CallTelephonyGateway = { answer: vi.fn(async () => ({ ok: true })), hangup: vi.fn(async () => ({ ok: true })) };
  const customers: CallCustomerDirectory = { findOrCreateByPhone: vi.fn(async () => {
    if (overrides.customerOk === false) return { ok: false } as const;
    return { ok: true, value: { id: "customer-1" } } as const;
  }) };
  const agentClose = vi.fn(async () => undefined);
  const voiceClose = vi.fn(async () => undefined);
  const agents: CallAgentRuntime = { startSession: vi.fn(async () => {
    if (overrides.agentOk === false) return { ok: false } as const;
    return { ok: true, value: { close: agentClose } } as const;
  }) };
  const voice: CallVoiceBridge = { start: vi.fn(async () => ({ ok: true, value: { close: voiceClose } })) };
  const directory = new BusinessDirectoryService(new InMemoryBusinessRepository([business]));
  return { orchestrator: new CallOrchestratorService(directory, customers, telephony, agents, voice, repository), repository, telephony, agents, agentClose, voiceClose };
};

describe("CallOrchestratorService", () => {
  it("moves an inbound call through the documented start sequence", async () => {
    const system = createOrchestrator();
    await system.orchestrator.handleTelephonyEvent(incoming);
    expect(system.repository.stateHistory.map((entry) => entry.state)).toEqual(["RINGING", "ANSWERED", "AI_CONNECTING", "IN_CONVERSATION"]);
    await expect(system.repository.findByCallId(incoming.callId)).resolves.toMatchObject({ tenantId: business.tenantId, customerId: "customer-1", state: "IN_CONVERSATION" });
  });

  it("shuts down voice and agent sessions exactly once when the call hangs up", async () => {
    const system = createOrchestrator();
    await system.orchestrator.handleTelephonyEvent(incoming);
    await system.orchestrator.handleTelephonyEvent({ type: "CALL_HUNG_UP", callId: incoming.callId, occurredAt: "2026-08-09T18:03:00.000Z" });
    await system.orchestrator.handleTelephonyEvent({ type: "CALL_HUNG_UP", callId: incoming.callId, occurredAt: "2026-08-09T18:04:00.000Z" });
    expect(system.voiceClose).toHaveBeenCalledTimes(1);
    expect(system.agentClose).toHaveBeenCalledTimes(1);
    expect(system.repository.stateHistory.at(-1)).toEqual({ callId: incoming.callId, state: "COMPLETED" });
  });

  it("fails and hangs up when an agent session cannot start", async () => {
    const system = createOrchestrator({ agentOk: false });
    await system.orchestrator.handleTelephonyEvent(incoming);
    expect(system.telephony.hangup).toHaveBeenCalledWith(incoming.callId);
    expect(system.repository.stateHistory.at(-1)).toEqual({ callId: incoming.callId, state: "FAILED" });
  });

  it("does not create a call record for an unknown called number", async () => {
    const system = createOrchestrator();
    await system.orchestrator.handleTelephonyEvent({ ...incoming, to: "+13035550000" });
    expect(system.repository.stateHistory).toEqual([]);
    expect(system.telephony.hangup).toHaveBeenCalledWith(incoming.callId);
  });
});
