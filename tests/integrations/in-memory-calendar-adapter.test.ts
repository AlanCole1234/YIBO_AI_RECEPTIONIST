import { describe, expect, it } from "vitest";
import { InMemoryCalendarAdapter } from "../../src/modules/integrations/index.js";

const event = {
  tenantId: "tenant-smileline",
  appointmentId: "appointment-1",
  employeeId: "dr-lee",
  title: "Cleaning · Maria Johnson",
  startAt: "2026-08-10T16:00:00.000Z",
  endAt: "2026-08-10T16:30:00.000Z",
  idempotencyKey: "call-1:create-appointment",
};

describe("InMemoryCalendarAdapter", () => {
  it("creates an event once when the same idempotency key is retried", async () => {
    const calendar = new InMemoryCalendarAdapter();
    const first = await calendar.createEvent(event);
    const retry = await calendar.createEvent({ ...event, title: "Changed title must not create a second event" });

    expect(first).toEqual({ ok: true, value: { provider: "in-memory", externalEventId: "calendar-event-1" } });
    expect(retry).toEqual(first);
  });

  it("returns busy time only for the matching tenant, employee, and query range", async () => {
    const calendar = new InMemoryCalendarAdapter();
    await calendar.createEvent(event);
    await calendar.createEvent({ ...event, appointmentId: "appointment-2", employeeId: "dr-patel", idempotencyKey: "second" });

    await expect(calendar.getBusyIntervals({
      tenantId: event.tenantId, employeeId: event.employeeId,
      rangeStart: "2026-08-10T15:00:00.000Z", rangeEnd: "2026-08-10T17:00:00.000Z",
    })).resolves.toEqual({ ok: true, value: [{ startAt: event.startAt, endAt: event.endAt }] });
  });

  it("cancels a tenant-owned event and removes it from availability", async () => {
    const calendar = new InMemoryCalendarAdapter();
    const created = await calendar.createEvent(event);
    if (!created.ok) throw new Error("Expected event creation to succeed");

    await expect(calendar.cancelEvent({ tenantId: event.tenantId, externalEventId: created.value.externalEventId }))
      .resolves.toEqual({ ok: true, value: undefined });
    await expect(calendar.getBusyIntervals({
      tenantId: event.tenantId, employeeId: event.employeeId,
      rangeStart: "2026-08-10T15:00:00.000Z", rangeEnd: "2026-08-10T17:00:00.000Z",
    })).resolves.toEqual({ ok: true, value: [] });
  });

  it("does not expose or cancel another tenant's event", async () => {
    const calendar = new InMemoryCalendarAdapter();
    const created = await calendar.createEvent(event);
    if (!created.ok) throw new Error("Expected event creation to succeed");

    await expect(calendar.cancelEvent({ tenantId: "another-tenant", externalEventId: created.value.externalEventId }))
      .resolves.toEqual({ ok: false, error: { code: "EVENT_NOT_FOUND" } });
  });
});
