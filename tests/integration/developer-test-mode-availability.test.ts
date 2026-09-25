import { describe, expect, it } from "vitest";
import { buildApplication } from "../../src/bootstrap/index.js";
import { dateTimeInTimezone } from "../../src/modules/scheduling/domain/time.js";

const developer = {
  tenantId: "tenant-yibo-demo-us",
  locationId: "default",
  callId: "developer-call",
  developerTestModeAuthorized: true as const,
  turnSequence: 1,
};

const tuesdayClock = { now: () => new Date("2026-08-10T18:00:00.000Z") }; // Monday afternoon in Chicago

describe("Developer Test Mode availability", () => {
  it("offers and books the deterministic 7:00 AM Tuesday slot", async () => {
    const app = buildApplication({ tenantId: developer.tenantId, clock: tuesdayClock });
    await enable(app);

    const availability = await check(app, "Tuesday", "availability-tuesday");
    const earliest = earliestSlot(availability);
    expect(localTime(earliest.startAt)).toBe("07:00");

    const booking = await app.tools.execute(developer, {
      toolCallId: "book-earliest-tuesday",
      name: "create_appointment",
      arguments: { employeeId: earliest.employeeId, startAt: earliest.startAt },
    });
    expect(booking).toMatchObject({ ok: true, data: { confirmed: true, startAt: earliest.startAt } });

    const testCustomer = await app.customers.findOrCreateByPhone({
      tenantId: developer.tenantId,
      phone: "+15550000000",
    });
    if (!testCustomer.ok) throw new Error("Expected the isolated test customer");
    await expect(app.appointments.listUpcomingAppointments({
      tenantId: developer.tenantId,
      locationId: developer.locationId,
      customerId: testCustomer.value.id,
    })).resolves.toEqual([]);
    await expect(app.calendar.getBusyIntervals({
      tenantId: developer.tenantId,
      locationId: developer.locationId,
      employeeId: earliest.employeeId,
      rangeStart: earliest.startAt,
      rangeEnd: earliest.endAt,
    })).resolves.toEqual({ ok: true, value: [] });
  });

  it("returns the next deterministic slot when 7:00 AM is booked", async () => {
    const app = buildApplication({ tenantId: developer.tenantId, clock: tuesdayClock });
    await enable(app);
    const first = earliestSlot(await check(app, "Tuesday", "find-first"));
    const booked = await app.tools.execute(developer, {
      toolCallId: "block-seven",
      name: "create_appointment",
      arguments: { employeeId: first.employeeId, startAt: first.startAt },
    });
    expect(booked.ok).toBe(true);

    const after = earliestSlot(await check(app, "Tuesday", "find-next"));
    expect(localTime(after.startAt)).toBe("07:30");
  });

  it("resolves tomorrow in the clinic timezone and keeps the 7:00 AM instant through booking", async () => {
    const app = buildApplication({ tenantId: developer.tenantId, clock: tuesdayClock });
    await enable(app);
    const earliest = earliestSlot(await check(app, "tomorrow", "availability-tomorrow"));
    expect(localTime(earliest.startAt)).toBe("07:00");

    const booking = await app.tools.execute(developer, {
      toolCallId: "book-earliest-tomorrow",
      name: "create_appointment",
      arguments: { employeeId: earliest.employeeId, startAt: earliest.startAt },
    });
    expect(booking).toMatchObject({ ok: true, data: { confirmed: true, startAt: earliest.startAt } });
  });

  it("leaves regular availability on the normal calendar/business-hours path", async () => {
    const app = buildApplication({ tenantId: developer.tenantId, clock: tuesdayClock });
    const availability = await check(app, "Tuesday", "production-path");
    expect(localTime(earliestSlot(availability).startAt)).toBe("09:00");
  });
});

async function enable(app: ReturnType<typeof buildApplication>) {
  const result = await app.tools.execute(developer, {
    toolCallId: "enable-test-mode", name: "enable_developer_test_mode", arguments: {},
  });
  expect(result).toMatchObject({ ok: true, data: { enabled: true } });
}

async function check(app: ReturnType<typeof buildApplication>, dateExpression: string, toolCallId: string) {
  const result = await app.tools.execute(developer, {
    toolCallId, name: "check_availability", arguments: { dateExpression },
  });
  if (!result.ok) throw new Error(`Availability failed: ${result.error.code}`);
  return result.data as { earliestSlot: { employeeId: string; startAt: string; endAt: string } | null };
}

function earliestSlot(result: { earliestSlot: { employeeId: string; startAt: string; endAt: string } | null }) {
  if (!result.earliestSlot) throw new Error("Expected an available demo slot");
  return result.earliestSlot;
}

function localTime(instant: string): string {
  return dateTimeInTimezone(new Date(instant), "America/Chicago").dateTime.slice(11, 16);
}
