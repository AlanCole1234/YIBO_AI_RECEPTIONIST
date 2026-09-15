import { describe, expect, it, vi } from "vitest";
import { AppointmentServiceImpl, InMemoryAppointmentConcurrencyGuard, InMemoryAppointmentRepository } from "../../src/modules/appointments/index.js";
import { BusinessDirectoryService, InMemoryBusinessRepository, type BusinessProfile } from "../../src/modules/business/index.js";
import { GoogleCalendarAdapter, type GoogleOAuthService } from "../../src/modules/integrations/index.js";
import { SchedulingServiceImpl } from "../../src/modules/scheduling/index.js";

interface GoogleEvent {
  id: string;
  etag: string;
  status: string;
  start: { dateTime: string; timeZone: string };
  end: { dateTime: string; timeZone: string };
  extendedProperties: { private: Record<string, string> };
  summary?: string;
  [key: string]: unknown;
}

// Stateful HTTP-boundary double: duplicate inserts return 409 without updating,
// deletion leaves a cancelled resource, PATCH changes only the targeted event.
class GoogleCalendarHttp {
  events = new Map<string, GoogleEvent>();
  requests: Array<{ method: string; id?: string; body?: any; status: number }> = [];
  failNext?: { method: string; status: number };
  beforePatch?: (id: string) => void;
  fetch: typeof fetch = vi.fn(async (input, options) => {
    const url = new URL(String(input));
    const method = options?.method ?? "GET";
    const body = options?.body ? JSON.parse(String(options.body)) : undefined;
    const id = url.pathname.includes("/events/") ? decodeURIComponent(url.pathname.split("/events/")[1]!) : undefined;
    const reply = (status: number, data?: unknown) => {
      this.requests.push({ method, id, body, status });
      return new Response(status === 204 ? null : JSON.stringify(data ?? {}), { status });
    };
    if (this.failNext && this.failNext.method === method) {
      const { status } = this.failNext; this.failNext = undefined;
      return reply(status);
    }
    if (url.pathname.endsWith("/freeBusy")) return reply(200, { calendars: { "clinic@example.com": { busy: this.active().map(event => ({ start: event.start.dateTime, end: event.end.dateTime })) } } });
    if (method === "POST" && url.pathname.endsWith("/events")) {
      if (this.events.has(body.id)) return reply(409, { error: { errors: [{ reason: "duplicate" }] } });
      const event = { ...body, status: "confirmed", etag: '"1"' } as GoogleEvent;
      this.events.set(event.id, structuredClone(event));
      return reply(200, event);
    }
    const event = id ? this.events.get(id) : undefined;
    if (!event) return reply(404);
    if (method === "GET") return reply(200, event);
    if (method === "PATCH") this.beforePatch?.(id!);
    const ifMatch = new Headers(options?.headers).get("if-match");
    if (ifMatch && ifMatch !== event.etag) return reply(412);
    if (method === "PATCH") {
      if (event.status === "cancelled") return reply(410);
      Object.assign(event, body, { etag: `"${Number(event.etag.replaceAll('"', '')) + 1}"` });
      return reply(200, event);
    }
    if (method === "DELETE") {
      if (event.status === "cancelled") return reply(410);
      event.status = "cancelled";
      return reply(204);
    }
    throw new Error(`Unhandled Calendar request: ${method} ${url.pathname}`);
  });
  active() { return [...this.events.values()].filter(event => event.status !== "cancelled"); }
}

const tenantId = "clinic-a";
const profile: BusinessProfile = {
  region: "US", tenantId, businessId: "business-a", name: "Clinic", timezone: "America/Denver", locale: "en-US", active: true,
  calledNumbers: ["+13035550000"], employees: [{ id: "dentist", displayName: "Dentist", active: true }],
  services: [{ id: "consultation", name: "Consultation", durationMinutes: 30, bufferMinutes: 0, eligibleEmployeeIds: ["dentist"] }],
  openingHours: Array.from({ length: 7 }, (_, dayOfWeek) => ({ dayOfWeek: dayOfWeek as 0 | 1 | 2 | 3 | 4 | 5 | 6, startTime: "07:00", endTime: "18:00" })),
};
const oauth = {
  status: async () => ({ configured: true, connected: true }), accessToken: async () => "test-token",
  accessTokenResult: async () => ({ ok: true, token: "test-token" }),
} as unknown as GoogleOAuthService;
function fixture(ids = ["00000000-0000-4000-8000-000000000001"]) {
  const http = new GoogleCalendarHttp();
  const calendar = new GoogleCalendarAdapter("clinic@example.com", "America/Denver", oauth, http.fetch);
  const repository = new InMemoryAppointmentRepository();
  const businesses = new BusinessDirectoryService(new InMemoryBusinessRepository([profile]));
  const scheduling = new SchedulingServiceImpl(businesses, { getWorkingHours: async () => profile.openingHours },
    { findConfirmedIntervals: async () => [] }, calendar, { now: () => new Date("2026-08-01T00:00:00Z") });
  let index = 0;
  const service = new AppointmentServiceImpl(repository, { exists: async () => true, get: async () => ({ name: "Test Patient", phone: "3035551234" }) },
    businesses, scheduling, calendar, new InMemoryAppointmentConcurrencyGuard(), () => ids[index++]!);
  const book = async (startAt = "2026-08-24T15:00:00.000Z") => {
    const result = await service.createAppointment({ tenantId, customerId: `patient-${index}`, serviceId: "consultation", employeeId: "dentist",
      startAt, idempotencyKey: `booking-${index}`, source: "API" });
    if (!result.ok) throw new Error(`Booking failed: ${result.error.code}`);
    return result.value;
  };
  return { http, calendar, repository, service, book };
}

describe("Google rescheduling event identity", () => {
  it("reschedules the original Google event without deleting it or changing its ID", async () => {
    const { http, book, service } = fixture();
    const original = await book();
    const result = await service.rescheduleAppointment({ tenantId, appointmentId: original.id, startAt: "2026-08-25T16:30:00.000Z" });
    expect(result).toMatchObject({ ok: true, value: { externalCalendarEventId: original.externalCalendarEventId } });
    expect(http.active()).toHaveLength(1);
    expect(http.events.get(original.externalCalendarEventId!)?.start.dateTime).toBe("2026-08-25T10:30:00-06:00");
    expect(http.requests.filter(request => request.method === "DELETE")).toHaveLength(0);
    expect(http.requests.filter(request => request.method === "POST" && request.body?.id)).toHaveLength(1);
  });

  it("does not alias distinct appointment IDs that have the same old hex-stripped representation", async () => {
    const { http, book } = fixture(["appointment-gg12345", "appointment-hh12345"]);
    const first = await book();
    const second = await book("2026-08-24T15:30:00.000Z");
    expect(first.externalCalendarEventId).not.toBe(second.externalCalendarEventId);
    expect(http.active()).toHaveLength(2);
  });
});


const insertCommand = (appointmentId = "appointment-gg12345", tenant = tenantId) => ({
  tenantId: tenant, appointmentId, employeeId: "dentist", title: "Consultation appointment", serviceName: "Consultation",
  startAt: "2026-08-24T15:00:00.000Z", endAt: "2026-08-24T15:30:00.000Z", idempotencyKey: `request-${appointmentId}`,
});

describe("Google rescheduling regressions", () => {
  it("moves only the selected appointment among similar dates, times, and names", async () => {
    const { http, book, service, repository } = fixture(["appointment-gg12345", "appointment-hh12345", "appointment-ii12345", "appointment-jj12345"]);
    const appointments = [];
    for (const startAt of ["2026-08-24T15:00:00.000Z", "2026-08-24T15:30:00.000Z", "2026-08-25T15:00:00.000Z", "2026-08-25T15:30:00.000Z"]) appointments.push(await book(startAt));
    const target = appointments[1]!;
    const others = appointments.filter(appointment => appointment.id !== target.id);
    const snapshots = others.map(appointment => structuredClone(http.events.get(appointment.externalCalendarEventId!)));
    const beforeRequests = http.requests.length;
    const result = await service.rescheduleAppointment({ tenantId, appointmentId: target.id, startAt: "2026-08-26T16:30:00.000Z" });
    expect(result).toMatchObject({ ok: true, value: { id: target.id, externalCalendarEventId: target.externalCalendarEventId, startAt: "2026-08-26T16:30:00.000Z" } });
    expect(http.active()).toHaveLength(4);
    expect(http.events.size).toBe(4);
    for (const [index, appointment] of others.entries()) {
      expect(http.events.get(appointment.externalCalendarEventId!)).toEqual(snapshots[index]);
      expect(await repository.findById(tenantId, appointment.id)).toEqual(appointment);
    }
    expect(http.requests.slice(beforeRequests).filter(request => request.method === "PATCH").map(request => request.id)).toEqual([target.externalCalendarEventId]);
    expect(http.requests.slice(beforeRequests).some(request => request.method === "DELETE" || (request.method === "POST" && request.body?.id))).toBe(false);
  });

  it("keeps one event and its original ID across repeated reschedules, retries, DST, and cancel", async () => {
    const { http, book, service, repository } = fixture(["appointment-gg12345", "appointment-hh12345"]);
    const original = await book();
    const neighbor = await book("2026-08-24T15:30:00.000Z");
    const neighborBefore = structuredClone(http.events.get(neighbor.externalCalendarEventId!));
    const times = ["2026-08-25T16:30:00.000Z", "2026-08-26T17:00:00.000Z", "2026-12-15T17:30:00.000Z", "2026-08-24T15:00:00.000Z"];
    for (const startAt of times) {
      const command = { tenantId, appointmentId: original.id, startAt };
      const moved = await service.rescheduleAppointment(command);
      expect(moved).toMatchObject({ ok: true, value: { startAt, externalCalendarEventId: original.externalCalendarEventId } });
      expect(await service.rescheduleAppointment(command)).toEqual(moved);
      expect(http.active()).toHaveLength(2);
      expect(http.events.size).toBe(2);
      expect(Date.parse(http.events.get(original.externalCalendarEventId!)!.start.dateTime)).toBe(Date.parse(startAt));
      expect((await repository.findById(tenantId, original.id))?.externalCalendarEventId).toBe(original.externalCalendarEventId);
    }
    expect(http.requests.filter(request => request.method === "PATCH")).toHaveLength(times.length);
    expect(await service.cancelAppointment({ tenantId, appointmentId: original.id })).toMatchObject({ ok: true, value: { status: "CANCELLED", externalCalendarEventId: original.externalCalendarEventId } });
    expect(http.active()).toHaveLength(1);
    expect(http.events.get(neighbor.externalCalendarEventId!)).toEqual(neighborBefore);
    expect(http.requests.filter(request => request.method === "DELETE").map(request => request.id)).toEqual([original.externalCalendarEventId]);
    expect(await service.rescheduleAppointment({ tenantId, appointmentId: original.id, startAt: times[0]! })).toMatchObject({ ok: false });
    expect(http.active()).toHaveLength(1);
  });

  it("preserves legacy stored IDs and unrelated event details", async () => {
    const { http, book, service, repository } = fixture();
    const original = await book();
    const event = http.events.get(original.externalCalendarEventId!)!;
    http.events.delete(event.id);
    const legacyId = `a${original.id.replace(/[^0-9a-f]/gi, "").toLowerCase()}`;
    Object.assign(event, { id: legacyId, summary: "Receptionist's notes", attendees: [{ email: "patient@example.com" }], reminders: { useDefault: false }, location: "Room 2" });
    delete event.extendedProperties.private.yiboTenantId;
    http.events.set(legacyId, event);
    await repository.save({ ...original, externalCalendarEventId: legacyId });
    const result = await service.rescheduleAppointment({ tenantId, appointmentId: original.id, startAt: "2026-08-25T16:30:00.000Z" });
    expect(result).toMatchObject({ ok: true, value: { externalCalendarEventId: legacyId } });
    expect(http.events.get(legacyId)).toMatchObject({ id: legacyId, summary: "Receptionist's notes", attendees: [{ email: "patient@example.com" }], reminders: { useDefault: false }, location: "Room 2" });
    expect(http.active()).toHaveLength(1);
  });

  it.each(["reschedule", "cancel"] as const)("refuses to %s an event belonging to another appointment even when the stored reference is wrong", async action => {
    const { http, book, service, repository } = fixture(["appointment-gg12345", "appointment-hh12345"]);
    const first = await book(); const second = await book("2026-08-24T15:30:00.000Z");
    await repository.save({ ...second, externalCalendarEventId: first.externalCalendarEventId });
    const before = structuredClone([...http.events]);
    const result = action === "reschedule"
      ? await service.rescheduleAppointment({ tenantId, appointmentId: second.id, startAt: "2026-08-25T16:30:00.000Z" })
      : await service.cancelAppointment({ tenantId, appointmentId: second.id });
    expect(result).toMatchObject({ ok: false, error: { code: "CALENDAR_SYNC_FAILED" } });
    expect([...http.events]).toEqual(before);
    expect(http.requests.some(request => ["PATCH", "DELETE"].includes(request.method))).toBe(false);
  });

  it("rejects another tenant's identity marker before updating", async () => {
    const { http, book, service } = fixture(); const original = await book();
    http.events.get(original.externalCalendarEventId!)!.extendedProperties.private.yiboTenantId = "other-clinic";
    expect(await service.rescheduleAppointment({ tenantId, appointmentId: original.id, startAt: "2026-08-25T16:30:00.000Z" })).toMatchObject({ ok: false });
    expect(http.requests.some(request => request.method === "PATCH")).toBe(false);
  });

  it.each([401, 403, 404, 410, 429, 500, 503])("keeps the stored appointment and event intact when PATCH returns %i", async status => {
    const { http, book, service, repository } = fixture(); const original = await book();
    const before = structuredClone([...http.events]); http.failNext = { method: "PATCH", status };
    expect(await service.rescheduleAppointment({ tenantId, appointmentId: original.id, startAt: "2026-08-25T16:30:00.000Z" })).toMatchObject({ ok: false, error: { code: "CALENDAR_SYNC_FAILED" } });
    expect(await repository.findById(tenantId, original.id)).toEqual(original);
    expect([...http.events]).toEqual(before);
    expect(http.requests.some(request => request.method === "DELETE")).toBe(false);
  });

  it("rejects concurrent external edits using the retrieved event version", async () => {
    const { http, book, service, repository } = fixture(); const original = await book();
    http.beforePatch = id => { http.events.get(id)!.etag = '"99"'; };
    expect(await service.rescheduleAppointment({ tenantId, appointmentId: original.id, startAt: "2026-08-25T16:30:00.000Z" })).toMatchObject({ ok: false });
    expect(http.requests.at(-1)?.status).toBe(412);
    expect(await repository.findById(tenantId, original.id)).toEqual(original);
    expect(http.active()).toHaveLength(1);
  });

  it("never creates a replacement when the original event has been deleted", async () => {
    const { http, book, service } = fixture(); const original = await book();
    http.events.get(original.externalCalendarEventId!)!.status = "cancelled";
    const before = http.requests.length;
    expect(await service.rescheduleAppointment({ tenantId, appointmentId: original.id, startAt: "2026-08-25T16:30:00.000Z" })).toMatchObject({ ok: false });
    expect(http.requests.slice(before).some(request => ["PATCH", "DELETE"].includes(request.method) || request.body?.id)).toBe(false);
    expect(http.active()).toHaveLength(0);
  });

  it("still rejects an occupied destination without moving either event", async () => {
    const { http, book, service } = fixture(["appointment-gg12345", "appointment-hh12345"]);
    const original = await book(); const neighbor = await book("2026-08-24T15:30:00.000Z");
    const before = structuredClone([...http.events]);
    expect(await service.rescheduleAppointment({ tenantId, appointmentId: original.id, startAt: neighbor.startAt })).toMatchObject({ ok: false, error: { code: "SLOT_NO_LONGER_AVAILABLE" } });
    expect([...http.events]).toEqual(before);
  });

  it("serializes repeated concurrent reschedules and does not resurrect a cancelled appointment", async () => {
    const { http, book, service, repository } = fixture(); const original = await book();
    const move = { tenantId, appointmentId: original.id, startAt: "2026-08-25T16:30:00.000Z" };
    const results = await Promise.all(Array.from({ length: 5 }, () => service.rescheduleAppointment(move)));
    expect(results.every(result => result.ok)).toBe(true);
    expect(http.requests.filter(request => request.method === "PATCH")).toHaveLength(1);
    expect(http.active()).toHaveLength(1);
    const [cancelled, laterMove] = await Promise.all([
      service.cancelAppointment({ tenantId, appointmentId: original.id }),
      service.rescheduleAppointment({ ...move, startAt: "2026-08-26T16:30:00.000Z" }),
    ]);
    expect(cancelled.ok).toBe(true); expect(laterMove.ok).toBe(false);
    expect((await repository.findById(tenantId, original.id))?.status).toBe("CANCELLED");
    expect(http.active()).toHaveLength(0);
  });
});

describe("Google create-event collision verification", () => {
  it("creates once when the identical insert is retried", async () => {
    const { http, calendar } = fixture(); const command = insertCommand();
    const original = await calendar.createEvent(command);
    expect(await calendar.createEvent(command)).toEqual(original);
    expect(http.active()).toHaveLength(1);
    expect(http.requests.map(request => request.status)).toEqual([200, 409, 200]);
  });
  it("uses the full tenant and appointment identity, independent of appointment time", async () => {
    const { http, calendar } = fixture();
    const first = await calendar.createEvent(insertCommand("same-appointment", "tenant-a"));
    const second = await calendar.createEvent(insertCommand("same-appointment", "tenant-b"));
    expect(first.ok && first.value.externalEventId).not.toEqual(second.ok && second.value.externalEventId);
    expect(http.active()).toHaveLength(2);
    for (const event of http.active()) expect(event.id).toMatch(/^[0-9a-v]{5,1024}$/);
  });
  it.each(["appointment", "tenant", "times", "cancelled"])("does not interpret a 409 as success when the existing event has mismatched %s", async mismatch => {
    const { http, calendar } = fixture(); const command = insertCommand();
    const created = await calendar.createEvent(command); if (!created.ok) throw new Error("Expected creation");
    const event = http.events.get(created.value.externalEventId)!;
    if (mismatch === "appointment") event.extendedProperties.private.yiboAppointmentId = "other-appointment";
    if (mismatch === "tenant") event.extendedProperties.private.yiboTenantId = "other-tenant";
    if (mismatch === "times") event.start.dateTime = "2026-08-24T10:00:00-06:00";
    if (mismatch === "cancelled") event.status = "cancelled";
    const before = structuredClone([...http.events]);
    expect(await calendar.createEvent(command)).toMatchObject({ ok: false });
    expect([...http.events]).toEqual(before);
    expect(http.requests.map(request => request.method)).toEqual(["POST", "POST", "GET"]);
  });
});
