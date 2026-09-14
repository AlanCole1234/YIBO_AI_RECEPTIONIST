import { describe, expect, it, vi } from "vitest";
import { DEVELOPMENT_BUSINESS } from "../../src/app/development-fixtures.js";
import { buildApplication } from "../../src/bootstrap/index.js";
import { BusinessDirectoryService, InMemoryBusinessRepository } from "../../src/modules/business/index.js";
import { InMemoryCallRepository, type CallRecord } from "../../src/modules/calls/index.js";
import { TelephonyHumanTransferAdapter } from "../../src/modules/integrations/index.js";
import type { TelephonyGateway } from "../../src/modules/telephony/index.js";

const configuredBusiness = () => {
  const business = structuredClone(DEVELOPMENT_BUSINESS);
  business.locations[0]!.transferDestination = { type: "EXTENSION", value: "204" };
  return business;
};

const activeCall = (business = configuredBusiness()): CallRecord => ({
  callId: "call-1", tenantId: business.tenantId, locationId: "default", customerId: "customer-1",
  from: "+529991234567", to: business.locations[0]!.calledNumbers[0]!, state: "IN_CONVERSATION",
  createdAt: "2026-09-10T12:00:00.000Z", updatedAt: "2026-09-10T12:00:00.000Z",
});

describe("TelephonyHumanTransferAdapter", () => {
  it("uses only the trusted location destination and persists successful states", async () => {
    const business = configuredBusiness();
    const calls = new InMemoryCallRepository();
    await calls.create(activeCall(business));
    const transfer = vi.fn(async () => ({ ok: true as const, value: undefined }));
    const telephony = gateway(transfer);
    const adapter = new TelephonyHumanTransferAdapter(
      new BusinessDirectoryService(new InMemoryBusinessRepository([business])), calls, telephony,
      { now: () => new Date("2026-09-10T12:01:00.000Z") },
    );

    await expect(adapter.transferToConfiguredDestination({
      tenantId: business.tenantId, locationId: "default", callId: "call-1",
    })).resolves.toEqual({ ok: true, value: undefined });
    expect(transfer).toHaveBeenCalledWith("call-1", { type: "EXTENSION", value: "204" });
    expect(calls.stateHistory.map(({ state }) => state)).toEqual([
      "IN_CONVERSATION", "TRANSFERRING", "TRANSFERRED",
    ]);
  });

  it("returns to conversation when the gateway fails", async () => {
    const business = configuredBusiness();
    const calls = new InMemoryCallRepository();
    await calls.create(activeCall(business));
    const telephony = gateway(vi.fn(async () => ({
      ok: false as const, error: { code: "PROVIDER_UNAVAILABLE" as const, retryable: true },
    })));
    const adapter = new TelephonyHumanTransferAdapter(
      new BusinessDirectoryService(new InMemoryBusinessRepository([business])), calls, telephony,
    );

    await expect(adapter.transferToConfiguredDestination({
      tenantId: business.tenantId, locationId: "default", callId: "call-1",
    })).resolves.toEqual({ ok: false, error: { code: "TRANSFER_FAILED", retryable: true } });
    expect(calls.stateHistory.map(({ state }) => state)).toEqual([
      "IN_CONVERSATION", "TRANSFERRING", "IN_CONVERSATION",
    ]);
  });

  it("is the default tool wiring and never accepts a destination from the model", async () => {
    const business = configuredBusiness();
    const calls = new InMemoryCallRepository();
    await calls.create(activeCall(business));
    const app = buildApplication({ businesses: [business], callRepository: calls });
    const result = await app.tools.execute({
      tenantId: business.tenantId, locationId: "default", callId: "call-1", customerId: "customer-1", turnSequence: 1,
    }, { toolCallId: "tool-1", name: "transfer_to_human", arguments: {} });

    expect(result).toEqual({ toolCallId: "tool-1", ok: true, data: { transferred: true } });
    expect(app.telephony.transfers).toEqual([{
      callId: "call-1", destination: { type: "EXTENSION", value: "204" },
    }]);
    await expect(calls.findByCallId("call-1")).resolves.toMatchObject({ state: "TRANSFERRED" });
  });
});

const gateway = (transfer: TelephonyGateway["transfer"]): TelephonyGateway => ({
  answer: async () => ({ ok: true, value: undefined }),
  hangup: async () => ({ ok: true, value: undefined }),
  transfer,
  onEvent: () => undefined,
});
