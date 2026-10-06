import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrateDatabase, openRegionalDatabase } from "../../src/infrastructure/database/regional-database.js";
import { SqliteAppointmentRepository } from "../../src/infrastructure/database/sqlite-appointment-repository.js";
import { SqliteAppointmentConcurrencyGuard } from "../../src/infrastructure/database/sqlite-appointment-concurrency-guard.js";
import { AppointmentServiceImpl, type CustomerReader } from "../../src/modules/appointments/index.js";
import { BusinessDirectoryService, InMemoryBusinessRepository, type BusinessProfile } from "../../src/modules/business/index.js";
import { GoogleCalendarAdapter, type GoogleOAuthService } from "../../src/modules/integrations/index.js";
import type { SchedulingService } from "../../src/modules/scheduling/index.js";
import { markCallEnded } from "../../src/modules/calls/index.js";
import { success } from "../../src/shared/domain/result.js";

// Actual SQLite fencing plus the Google adapter; only provider HTTP and time are synthetic.
const directory = mkdtempSync(join(tmpdir(), "yibo-stale-compensation-"));
const database = openRegionalDatabase("MX", join(directory, "mx.sqlite"));
const business: BusinessProfile = {
  region: "MX", tenantId: "synthetic-tenant", businessId: "synthetic-business", name: "Synthetic clinic",
  timezone: "UTC", locale: "en-US", active: true, calledNumbers: ["+15550000112"],
  services: [{ id: "service", name: "Synthetic service", durationMinutes: 30, bufferMinutes: 0, eligibleEmployeeIds: ["staff"] }],
  employees: [{ id: "staff", displayName: "Synthetic staff", active: true }],
  openingHours: [{ dayOfWeek: 6, startTime: "09:00", endTime: "18:00" }],
};
const customers: CustomerReader = {
  exists: async () => true,
  get: async () => ({ name: "Synthetic patient", phone: "+15550000111" }),
};
const scheduling: SchedulingService = {
  findAvailableSlots: async () => success([]),
  validateSlot: async query => success({
    employeeId: query.employeeId, startAt: query.startAt,
    endAt: new Date(Date.parse(query.startAt) + 30 * 60_000).toISOString(),
    validatedAt: "2029-01-01T00:00:00.000Z",
  }),
};
type Event = {
  id: string; etag: string; start: { dateTime: string }; end: { dateTime: string };
  extendedProperties: { private: { yiboOperationId: string } };
};
const events = new Map<string, Event>();
const deletePreconditions: Array<{ supplied?: string; inspected: string }> = [];
const scenario = process.argv[2] ?? "confirmation";
assert(["confirmation", "hangup", "inspection", "etag"].includes(scenario));
let revision = 0, deletes = 0;
const fetcher: typeof fetch = async (input, init) => {
  const url = new URL(String(input));
  const method = init?.method ?? "GET";
  if (method === "GET" && url.searchParams.has("privateExtendedProperty")) {
    const operation = url.searchParams.get("privateExtendedProperty")!.slice("yiboOperationId=".length);
    return new Response(JSON.stringify({ items: [...events.values()].filter(event =>
      event.extendedProperties.private.yiboOperationId === operation) }));
  }
  if (method === "POST") {
    const body = JSON.parse(String(init?.body)) as Event;
    events.set(body.id, { ...body, etag: `v${++revision}` });
    return new Response(JSON.stringify(events.get(body.id)));
  }
  const id = decodeURIComponent(url.pathname.split("/events/")[1] ?? "");
  const event = events.get(id);
  if (!event) return new Response(null, { status: 404 });
  if (method === "GET") return new Response(JSON.stringify(event));
  if (new Headers(init?.headers).get("if-match") !== event.etag) return new Response(null, { status: 412 });
  if (method === "PATCH") {
    Object.assign(event, JSON.parse(String(init?.body)), { etag: `v${++revision}` });
    return new Response(JSON.stringify(event));
  }
  if (method === "DELETE") {
    deletes += 1; events.delete(id);
    return new Response(null, { status: 204 });
  }
  throw new Error("Unexpected synthetic Google request");
};

try {
  migrateDatabase(database);
  database.exec(`INSERT INTO businesses(region_id, tenant_id, business_id, profile_json)
    VALUES ('MX', 'synthetic-tenant', 'synthetic-business', '{}');
    INSERT INTO customers(region_id, tenant_id, id, phone)
    VALUES ('MX', 'synthetic-tenant', 'synthetic-customer', '+15550000111');`);
  const repository = new SqliteAppointmentRepository(database, "MX");
  const calendar = new GoogleCalendarAdapter({ resolve: async () => success({
    calendarId: "synthetic-calendar", timezone: "UTC", source: "location" as const,
  }) }, {
    status: async () => ({ configured: true, connected: true }), accessToken: async () => "synthetic-only",
  } as unknown as GoogleOAuthService, fetcher);
  let now = Date.parse("2029-01-01T00:00:00.000Z"), nextId = 0;
  const makeGuard = () => new SqliteAppointmentConcurrencyGuard(database, "MX", { now: () => now, heartbeatMs: 1_000_000_000 });
  const guardA = makeGuard(), guardB = makeGuard();
  const makeService = (guard: SqliteAppointmentConcurrencyGuard) => new AppointmentServiceImpl(
    repository, customers, new BusinessDirectoryService(new InMemoryBusinessRepository([business])), scheduling, calendar,
    guard, () => `synthetic-${++nextId}`, { now: () => new Date(now) },
  );
  const writerA = makeService(guardA), writerB = makeService(guardB);
  let reached!: () => void, resume!: () => void;
  const paused = new Promise<void>(resolve => { reached = resolve; });
  const gate = new Promise<void>(resolve => { resume = resolve; });
  const originalSave = repository.save.bind(repository);
  let pause = true;
  repository.save = async appointment => {
    if (["inspection", "etag"].includes(scenario) && appointment.status === "CONFIRMED") {
      throw new Error("synthetic confirmation write failure");
    }
    if (scenario === "confirmation" && pause && appointment.status === "CONFIRMED") {
      pause = false; reached(); await gate;
    }
    await originalSave(appointment);
    if (scenario === "hangup" && pause && appointment.status === "PENDING_CONFIRMATION" && appointment.externalCalendarEventId) {
      pause = false; reached(); await gate;
    }
  };
  const originalInspect = calendar.inspectEvent.bind(calendar);
  calendar.inspectEvent = async command => {
    const inspected = await originalInspect(command);
    if (scenario === "inspection" && pause) {
      pause = false; reached(); await gate;
    }
    return inspected;
  };
  const originalCancel = calendar.cancelEvent.bind(calendar);
  calendar.cancelEvent = async command => {
    if (scenario === "etag") {
      const event = events.get(command.externalEventId)!;
      deletePreconditions.push({ supplied: command.expectedEtag, inspected: event.etag });
      // A provider-side change between inspection and DELETE must produce 412,
      // not a second GET that silently adopts the replacement ETag.
      event.etag = `v${++revision}`;
    }
    return originalCancel(command);
  };
  const pending = writerA.createAppointment({
    tenantId: business.tenantId, locationId: "default", customerId: "synthetic-customer", serviceId: "service",
    employeeId: "staff", startAt: "2030-08-10T15:00:00.000Z", idempotencyKey: "synthetic-create",
    source: scenario === "hangup" ? "AI_CALL" : "DASHBOARD", sourceCallId: "synthetic-call",
  });
  if (scenario === "inspection" || scenario === "etag") {
    if (scenario === "inspection") {
      await paused;
      now += 4 * 60_000;
      await guardB.execute(business.tenantId, "default", "staff", async () => {
        const current = await repository.findByIdempotencyKey(business.tenantId, "synthetic-create");
        assert.equal(current?.compensationRequired, true, "record compensation before the first provider call");
      });
      resume();
    }
    const result = await pending;
    const current = await repository.findByIdempotencyKey(business.tenantId, "synthetic-create");
    assert(!result.ok);
    assert.equal(result.error.code, scenario === "inspection" ? "APPOINTMENT_VERSION_CONFLICT" : "CALENDAR_SYNC_FAILED");
    assert.equal(current?.status, "PENDING_CONFIRMATION");
    assert.equal(current.compensationRequired, true);
    assert(events.has(current.externalCalendarEventId!));
    assert.equal(events.size, 1);
    assert.equal(deletes, 0);
    if (scenario === "etag") assert.deepEqual(deletePreconditions, [{ supplied: "v1", inspected: "v1" }]);
    console.log(JSON.stringify({
      staleCode: result.error.code, status: current.status, compensationRequired: current.compensationRequired,
      eventCount: events.size, deletes,
    }));
  } else {
    await paused;
    // Models a suspended worker: both the heartbeat lease and the pending-booking grace period expire.
    now += 4 * 60_000;
    const recovery = await writerB.recoverStuckBookings(business.tenantId);
    assert.equal(recovery.confirmed.length, 1);
    const recovered = await repository.findById(business.tenantId, recovery.confirmed[0]!);
    assert(recovered);
    const moved = await writerB.rescheduleAppointment({
      tenantId: business.tenantId, locationId: "default", appointmentId: recovered.id,
      idempotencyKey: "synthetic-newer-move", expectedVersion: recovered.version, startAt: "2030-08-10T17:00:00.000Z",
    });
    assert(moved.ok, JSON.stringify(moved));
    const validEvent = structuredClone(events.get(moved.value.externalCalendarEventId!));
    assert(validEvent);
    if (scenario === "hangup") markCallEnded("synthetic-call");
    resume();
    const stale = await pending;
    await writerB.recoverStuckBookings(business.tenantId);
    const final = await repository.findById(business.tenantId, recovered.id);
    assert(!stale.ok);
    assert.equal(stale.error.code, "APPOINTMENT_VERSION_CONFLICT");
    assert.deepEqual(final, moved.value);
    assert.equal(events.size, 1, "stale rollback deleted the newer valid Google event");
    assert.deepEqual(events.get(moved.value.externalCalendarEventId!), validEvent);
    assert.equal(deletes, 0);
    console.log(JSON.stringify({ staleCode: stale.error.code, status: final.status, startAt: final.startAt, eventCount: events.size, deletes }));
  }
} finally {
  database.close();
  rmSync(directory, { recursive: true, force: true });
}
