import { describe, expect, it } from "vitest";
import {
  BusinessDirectoryService,
  InMemoryBusinessRepository,
  type BusinessProfile,
} from "../../src/modules/business/index.js";
import { InMemoryCalendarAdapter } from "../../src/modules/integrations/index.js";
import { SchedulingServiceImpl, type ConfirmedAppointmentReader, type EmployeeWorkingHoursProvider } from "../../src/modules/scheduling/index.js";
import { normalizeDateTimeForTimezone } from "../../src/modules/scheduling/domain/time.js";

const tenantId = "tenant-calendar-regression";
const timezone = "America/Denver";
const date = "2026-08-17"; // Monday in daylight saving time.
const appointments: ConfirmedAppointmentReader = { findConfirmedIntervals: async () => [] };

const profile: BusinessProfile = {
  region: "US", tenantId, businessId: "business-calendar-regression", name: "Calendar Regression Clinic",
  timezone, locale: "en-US", active: true, calledNumbers: ["+19155550123"],
  employees: [{ id: "dentist", displayName: "Dr. Lee", active: true }],
  services: [{ id: "consultation", name: "Consultation", durationMinutes: 30, bufferMinutes: 0, eligibleEmployeeIds: ["dentist"] }],
  openingHours: [{ dayOfWeek: 1, startTime: "07:00", endTime: "18:00" }],
  slotIntervalMinutes: 30,
};

const localInstant = (time: string, localDate = date): string => {
  const value = normalizeDateTimeForTimezone(`${localDate}T${time}`, timezone);
  if (!value) throw new Error(`Invalid local test time: ${localDate} ${time}`);
  return value.toISOString();
};

const serviceFor = (calendar: InMemoryCalendarAdapter) => {
  const hours: EmployeeWorkingHoursProvider = { getWorkingHours: async () => profile.openingHours };
  return new SchedulingServiceImpl(
    new BusinessDirectoryService(new InMemoryBusinessRepository([profile])),
    hours,
    appointments,
    calendar,
    { now: () => new Date("2026-08-10T12:00:00.000Z") },
  );
};

const available = async (calendar: InMemoryCalendarAdapter) => {
  const result = await serviceFor(calendar).findAvailableSlots({
    tenantId,
    serviceId: "consultation",
    rangeStart: localInstant("00:00"),
    rangeEnd: localInstant("00:00", "2026-08-18"),
  });
  if (!result.ok) throw new Error(`Availability failed: ${result.error.code}`);
  return result.value;
};

const occupy = async (calendar: InMemoryCalendarAdapter, start: string, durationMinutes = 30, key = start) => {
  const startAt = localInstant(start);
  const endAt = new Date(new Date(startAt).valueOf() + durationMinutes * 60_000).toISOString();
  await calendar.createEvent({
    tenantId,
    appointmentId: `busy-${key.replace(/[^\d]/g, "")}`,
    employeeId: "dentist",
    title: "Busy",
    startAt,
    endAt,
    idempotencyKey: `busy-${key}`,
  });
};

describe("Google Calendar scheduling regression coverage", () => {
  it.each([
    ["an empty day", [], "07:00"],
    ["7:00 AM occupied", ["07:00"], "07:30"],
    ["7:00 and 7:30 AM occupied", ["07:00", "07:30"], "08:00"],
    ["a heavily occupied morning", ["07:00", "07:30", "08:00", "08:30", "09:00"], "09:30"],
    ["random morning gaps", ["07:00", "08:00", "08:30"], "07:30"],
  ])("selects the first real opening for %s", async (_label, occupied, expected) => {
    const calendar = new InMemoryCalendarAdapter();
    for (const time of occupied) await occupy(calendar, time);

    expect((await available(calendar))[0]?.startAt).toBe(localInstant(expected));
  });

  it("continues through a fully occupied morning in 30-minute increments instead of falling back to 3 PM", async () => {
    const calendar = new InMemoryCalendarAdapter();
    for (const hour of ["07", "08", "09", "10", "11", "12"]) {
      await occupy(calendar, `${hour}:00`);
      await occupy(calendar, `${hour}:30`);
    }

    expect((await available(calendar))[0]?.startAt).toBe(localInstant("13:00"));
  });

  it("treats partial Google Calendar overlap as unavailable", async () => {
    const calendar = new InMemoryCalendarAdapter();
    await occupy(calendar, "07:15", 30, "partial-overlap");

    expect((await available(calendar))[0]?.startAt).toBe(localInstant("08:00"));
  });

  it("keeps generated slots on the configured 30-minute cadence", async () => {
    const slots = await available(new InMemoryCalendarAdapter());
    expect(slots.slice(0, 12).map((slot) => new Date(slot.startAt).getUTCMinutes())).toEqual([0, 30, 0, 30, 0, 30, 0, 30, 0, 30, 0, 30]);
    expect(slots.slice(0, 4).map((slot) => slot.startAt)).toEqual([
      localInstant("07:00"), localInstant("07:30"), localInstant("08:00"), localInstant("08:30"),
    ]);
  });

  it("keeps the offered slot and booked availability in sync through repeated bookings", async () => {
    const calendar = new InMemoryCalendarAdapter();
    for (const time of ["07:00", "07:30", "08:30", "09:00", "10:00"]) await occupy(calendar, time);

    expect((await available(calendar))[0]?.startAt).toBe(localInstant("08:00"));
    await occupy(calendar, "08:00");
    expect((await available(calendar))[0]?.startAt).toBe(localInstant("09:30"));
  });

  it.each(["07:00", "07:30", "09:00", "12:00", "13:00", "15:00", "15:30", "16:30"])(
    "validates the requested local slot without changing its instant: %s",
    async (time) => {
      const scheduling = serviceFor(new InMemoryCalendarAdapter());
      const startAt = localInstant(time);
      const validation = await scheduling.validateSlot({ tenantId, serviceId: "consultation", employeeId: "dentist", startAt });
      expect(validation).toMatchObject({ ok: true, value: { startAt, endAt: new Date(new Date(startAt).valueOf() + 30 * 60_000).toISOString() } });
    },
  );

  it("rejects a duplicate requested time after it becomes a calendar busy block", async () => {
    const calendar = new InMemoryCalendarAdapter();
    await occupy(calendar, "09:00");
    const validation = await serviceFor(calendar).validateSlot({
      tenantId, serviceId: "consultation", employeeId: "dentist", startAt: localInstant("09:00"),
    });

    expect(validation).toEqual({ ok: false, error: { code: "SLOT_CONFLICT" } });
    expect((await available(calendar))[0]?.startAt).toBe(localInstant("07:00"));
  });
});
