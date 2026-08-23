import { describe, expect, it, vi } from "vitest";
import { TelephonyEventIngress } from "../../src/modules/telephony/index.js";

const incoming = {
  type: "INCOMING_CALL",
  callId: "call-1",
  from: "+15125550123",
  to: "+15125550100",
  occurredAt: "2026-08-24T16:00:00-05:00",
};

describe("TelephonyEventIngress", () => {
  it("authenticates, normalizes, and dispatches a provider-neutral inbound call", async () => {
    const ingress = new TelephonyEventIngress("telephony-secret");
    const handler = vi.fn(async () => undefined);
    ingress.onEvent(handler);

    await expect(ingress.receive(incoming, "telephony-secret")).resolves.toEqual({ ok: true, value: undefined });
    expect(handler).toHaveBeenCalledWith({ ...incoming, occurredAt: "2026-08-24T21:00:00.000Z" });
  });

  it("rejects requests without the configured secret before dispatching", async () => {
    const ingress = new TelephonyEventIngress("telephony-secret");
    const handler = vi.fn(async () => undefined);
    ingress.onEvent(handler);

    await expect(ingress.receive(incoming, "wrong-secret")).resolves.toEqual({ ok: false, error: { code: "UNAUTHORIZED" } });
    expect(handler).not.toHaveBeenCalled();
  });

  it("rejects malformed provider input at the integration boundary", async () => {
    const ingress = new TelephonyEventIngress("telephony-secret");
    await expect(ingress.receive({ ...incoming, from: "not-a-phone" }, "telephony-secret"))
      .resolves.toMatchObject({ ok: false, error: { code: "INVALID_EVENT" } });
  });
});
