import { describe, expect, it, vi } from "vitest";
import { phoneOperations, tool, available, confirmContact, booking, slot } from "../helpers/phone-operations.js";

// Real application/Google adapter and local media; controlled ARI/runtime/HTTP boundaries.
describe("integrated phone operational and failure scenarios", () => {
  it("lists the caller's booking, reschedules twice and cancels the original Google event", async () => {
    const f = phoneOperations();
    try {
      const session = await f.start();
      expect(await confirmContact(session)).toMatchObject({ ok: true });
      expect(await available(session)).toMatchObject({ ok: true });
      expect(await tool(session, "create_appointment", booking)).toMatchObject({ ok: true });
      const originalId = [...f.events.keys()][0]!;
      const other = await f.start("caller-2", "+12025550102");
      expect(await confirmContact(other, "02")).toMatchObject({ ok: true });
      expect(await available(other, "2026-09-21T18:00:00.000Z")).toMatchObject({ ok: true });
      expect(await tool(other, "create_appointment", { ...booking, startAt: "2026-09-21T18:00:00.000Z" })).toMatchObject({ ok: true });
      const neighbor = structuredClone([...f.events.values()].find(event => event.id !== originalId)!);
      expect(await tool(session, "list_customer_appointments")).toMatchObject({ ok: true, data: { appointments: [{ reference: "upcoming-1", startAt: slot }] } });
      for (const startAt of ["2026-09-21T16:30:00.000Z", "2026-09-21T17:00:00.000Z"]) {
        expect(await available(session, startAt)).toMatchObject({ ok: true, data: { requestedTimeAvailable: true } });
        expect(await tool(session, "reschedule_appointment", { appointmentReference: "upcoming-1", startAt })).toMatchObject({ ok: true, data: { rescheduled: true, startAt } });
        expect(f.events.size).toBe(2);
        expect(Date.parse(f.events.get(originalId)!.start.dateTime)).toBe(Date.parse(startAt));
        expect(f.events.get(neighbor.id)).toEqual(neighbor);
      }
      expect(await tool(session, "cancel_appointment", { appointmentReference: "upcoming-1" })).toMatchObject({ ok: true, data: { cancelled: true } });
      expect([...f.events.values()]).toEqual([neighbor]);
      expect(await tool(session, "list_customer_appointments")).toMatchObject({ ok: true, data: { appointments: [] } });
      expect(f.fetcher.mock.calls.filter(([url, init]) => String(url).endsWith("/events") && init?.method === "POST")).toHaveLength(2);
    } finally { await f.close(); }
  });

  it("returns a calendar outage to the caller's runtime and keeps conversation usable", async () => {
    const f = phoneOperations();
    try {
      const session = await f.start();
      expect(await confirmContact(session)).toMatchObject({ ok: true });
      f.controls.outage = true;
      expect(await available(session)).toMatchObject({ ok: false });
      expect(await tool(session, "create_appointment", booking)).toMatchObject({ ok: false });
      expect(f.events.size).toBe(0);
      expect(session.closeCount).toBe(0);
      expect(await tool(session, "get_service_information")).toMatchObject({ ok: true });
      f.controls.outage = false;
      expect(await available(session)).toMatchObject({ ok: true });
      expect(await tool(session, "create_appointment", booking)).toMatchObject({ ok: true });
    } finally { await f.close(); }
  });

  it("does not report booking success when Google's event write fails", async () => {
    const f = phoneOperations();
    try {
      const session = await f.start();
      expect(await confirmContact(session)).toMatchObject({ ok: true });
      expect(await available(session)).toMatchObject({ ok: true });
      f.controls.writeOutage = true;
      expect(await tool(session, "create_appointment", booking)).toMatchObject({ ok: false, error: { code: "CALENDAR_SYNC_FAILED" } });
      expect(f.events.size).toBe(0);
      expect(await tool(session, "list_customer_appointments")).toMatchObject({ ok: true, data: { appointments: [] } });
      expect(await tool(session, "get_service_information")).toMatchObject({ ok: true });
    } finally { await f.close(); }
  });

  it.each(["reschedule_appointment", "cancel_appointment"] as const)("preserves the booking when Google rejects %s", async (operation) => {
    const f = phoneOperations();
    try {
      const session = await f.start();
      expect(await confirmContact(session)).toMatchObject({ ok: true });
      expect(await tool(session, "create_appointment", booking)).toMatchObject({ ok: true });
      expect(await tool(session, "list_customer_appointments")).toMatchObject({ ok: true });
      const original = structuredClone([...f.events.values()]);
      f.controls.writeOutage = true;
      expect(await tool(session, operation, { appointmentReference: "upcoming-1",
        ...(operation === "reschedule_appointment" ? { startAt: "2026-09-21T17:00:00.000Z" } : {}),
      })).toMatchObject({ ok: false, error: { code: "CALENDAR_SYNC_FAILED" } });
      expect([...f.events.values()]).toEqual(original);
      expect(await tool(session, "list_customer_appointments")).toMatchObject({ ok: true, data: { appointments: [{ startAt: slot }] } });
    } finally { await f.close(); }
  });

  it("ends a failed audio response when the RTP peer never arrives", async () => {
    const f = phoneOperations();
    try {
      const session = await f.start();
      session.emit({ type: "audio.delta", assistantTurnId: "no-peer", frame: {
        codec: "pcm_s16le", sampleRate: 24000, channels: 1, data: new Uint8Array(960),
      } });
      await vi.waitFor(() => expect(f.ari.hangup).toHaveBeenCalledWith("caller-1"), { timeout: 5500 });
      expect(session.closeCount).toBe(1);
      expect(f.ari.destroyBridge).toHaveBeenCalledTimes(1);
      expect((await f.app.callHistory.listByTenant(f.app.tenantId, 10))[0]!.state).toBe("FAILED");
    } finally { await f.close(); }
  }, 7000);

  it("allows only one of two callers to book the same previously available slot", async () => {
    const f = phoneOperations();
    let release!: () => void;
    f.controls.holdCreate = new Promise<void>(resolve => { release = resolve; });
    try {
      const first = await f.start();
      const second = await f.start("caller-2", "+12025550102");
      expect(await confirmContact(first)).toMatchObject({ ok: true });
      expect(await confirmContact(second, "02")).toMatchObject({ ok: true });
      for (const session of [first, second]) expect(await available(session)).toMatchObject({ ok: true, data: { requestedTimeAvailable: true } });
      const firstBooking = tool(first, "create_appointment", booking);
      await vi.waitFor(() => expect(f.fetcher.mock.calls.some(([url]) => String(url).endsWith("/events"))).toBe(true));
      const secondBooking = tool(second, "create_appointment", booking);
      release();
      expect(await firstBooking).toMatchObject({ ok: true });
      expect(await secondBooking).toMatchObject({ ok: false, error: { code: "SLOT_NO_LONGER_AVAILABLE" } });
      expect(f.events.size).toBe(1);
      expect(await tool(second, "list_customer_appointments")).toMatchObject({ ok: true, data: { appointments: [] } });
    } finally { release(); await f.close(); }
  });

  it.each([false, true])("handles PBX transfer failure=%s with the trusted destination", async (fails) => {
    const f = phoneOperations();
    try {
      const session = await f.start();
      if (fails) f.ari.transfer.mockRejectedValueOnce({ code: "CONNECTION_UNAVAILABLE", retryable: true });
      expect(await tool(session, "transfer_to_human")).toMatchObject(fails
        ? { ok: false, error: { code: "TRANSFER_FAILED" } } : { ok: true, data: { transferred: true } });
      expect(f.ari.transfer).toHaveBeenCalledWith("caller-1", { kind: "extension", value: "204" });
      expect((await f.app.callHistory.listByTenant(f.app.tenantId, 10))[0]!.state).toBe(fails ? "IN_CONVERSATION" : "TRANSFERRED");
      if (fails) expect(await tool(session, "get_service_information")).toMatchObject({ ok: true });
      await f.hangup("caller-1");
      expect(session.closeCount).toBe(1);
      expect(f.ari.destroyBridge).toHaveBeenCalledTimes(1);
      expect((await f.app.callHistory.listByTenant(f.app.tenantId, 10))[0]!.state).toBe(fails ? "COMPLETED" : "TRANSFERRED");
    } finally { await f.close(); }
  });

  it.each(["answer", "external-media", "runtime"])("cleans up failed %s startup and permits a subsequent call", async (stage) => {
    const f = phoneOperations();
    try {
      if (stage === "answer") f.ari.answer.mockRejectedValueOnce(new Error("PBX unavailable"));
      if (stage === "external-media") f.ari.createExternalMedia.mockRejectedValueOnce(new Error("Media unavailable"));
      if (stage === "runtime") vi.spyOn(f.runtime, "openSession").mockRejectedValueOnce(new Error("Realtime unavailable"));
      // A failed startup deliberately creates no scripted session.
      await f.ari.emit({ type: "CHANNEL_ENTERED_APPLICATION", channelId: "caller-1", callerNumber: "+12025550101",
        dialedNumber: "+15125550100", occurredAt: "2026-09-17T12:00:00Z" });
      expect(f.runtime.sessions).toHaveLength(0);
      expect(f.ari.hangup).toHaveBeenCalledWith("caller-1");
      expect(f.ari.destroyBridge).toHaveBeenCalledTimes(1);
      expect((await f.app.callHistory.listByTenant(f.app.tenantId, 10))[0]!.state).toBe("FAILED");
      expect(await tool(await f.start("caller-2", "+12025550102"), "get_service_information")).toMatchObject({ ok: true });
    } finally { await f.close(); }
  });

  it("cleans up a runtime failure and repeated PBX hangup exactly once", async () => {
    const f = phoneOperations();
    try {
      const session = await f.start();
      session.emit({ type: "error", code: "PROVIDER_DISCONNECTED", message: "synthetic disconnect", retryable: false });
      await vi.waitFor(() => expect(f.ari.hangup).toHaveBeenCalledWith("caller-1"));
      await f.hangup("caller-1"); await f.hangup("caller-1");
      expect(session.closeCount).toBe(1);
      expect(f.ari.destroyBridge).toHaveBeenCalledTimes(1);
      expect((await f.app.callHistory.listByTenant(f.app.tenantId, 10))[0]!.state).toBe("FAILED");
    } finally { await f.close(); }
  });
});
