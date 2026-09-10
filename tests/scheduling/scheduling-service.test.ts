import { describe, expect, it } from "vitest";
import {
  BusinessDirectoryService,
  InMemoryBusinessRepository,
  type BusinessProfile,
} from "../../src/modules/business/index.js";
import { success } from "../../src/shared/domain/result.js";
import { SchedulingServiceImpl, type CalendarPort, type ConfirmedAppointmentReader, type EmployeeWorkingHoursProvider } from "../../src/modules/scheduling/index.js";

const business: BusinessProfile = {
  region: "US",
  tenantId: "tenant-smileline", businessId: "business-smileline", name: "SmileLine Dental",
  timezone: "America/Denver", locale: "en-US", active: true, calledNumbers: ["+13035550123"],
  employees: [{ id: "dr-lee", displayName: "Dr. Lee", active: true }],
  services: [{ id: "cleaning", name: "Cleaning", durationMinutes: 30, bufferMinutes: 0, eligibleEmployeeIds: ["dr-lee"] }],
  openingHours: [{ dayOfWeek: 1, startTime: "09:00", endTime: "12:00" }],
};

const workingHours: EmployeeWorkingHoursProvider = {
  getWorkingHours: async () => [{ dayOfWeek: 1, startTime: "09:30", endTime: "11:30" }],
};

const noAppointments: ConfirmedAppointmentReader = { findConfirmedIntervals: async () => [] };
const noCalendarConflicts: CalendarPort = { getBusyIntervals: async () => success([]) };
const clock = { now: () => new Date("2026-08-01T00:00:00.000Z") };

const createService = (appointments = noAppointments, calendar = noCalendarConflicts) => new SchedulingServiceImpl(
  new BusinessDirectoryService(new InMemoryBusinessRepository([business])), workingHours, appointments, calendar, clock,
);

describe("SchedulingService", () => {
  it("returns slots only in the intersection of business and employee hours", async () => {
    const result = await createService().findAvailableSlots({
      tenantId: business.tenantId, serviceId: "cleaning",
      rangeStart: "2026-08-10T00:00:00.000Z", rangeEnd: "2026-08-11T00:00:00.000Z",
    });

    expect(result).toEqual({ ok: true, value: [
      { employeeId: "dr-lee", startAt: "2026-08-10T15:30:00.000Z", endAt: "2026-08-10T16:00:00.000Z" },
      { employeeId: "dr-lee", startAt: "2026-08-10T15:45:00.000Z", endAt: "2026-08-10T16:15:00.000Z" },
      { employeeId: "dr-lee", startAt: "2026-08-10T16:00:00.000Z", endAt: "2026-08-10T16:30:00.000Z" },
      { employeeId: "dr-lee", startAt: "2026-08-10T16:15:00.000Z", endAt: "2026-08-10T16:45:00.000Z" },
      { employeeId: "dr-lee", startAt: "2026-08-10T16:30:00.000Z", endAt: "2026-08-10T17:00:00.000Z" },
      { employeeId: "dr-lee", startAt: "2026-08-10T16:45:00.000Z", endAt: "2026-08-10T17:15:00.000Z" },
      { employeeId: "dr-lee", startAt: "2026-08-10T17:00:00.000Z", endAt: "2026-08-10T17:30:00.000Z" },
    ] });
  });

  it("rejects a slot that overlaps a local confirmed appointment", async () => {
    const appointments: ConfirmedAppointmentReader = {
      findConfirmedIntervals: async () => [{ startAt: "2026-08-10T16:00:00.000Z", endAt: "2026-08-10T16:30:00.000Z" }],
    };
    await expect(createService(appointments).validateSlot({
      tenantId: business.tenantId, serviceId: "cleaning", employeeId: "dr-lee", startAt: "2026-08-10T16:00:00.000Z",
    })).resolves.toEqual({ ok: false, error: { code: "SLOT_CONFLICT" } });
  });

  it("rejects an external calendar outage with a retryable typed error", async () => {
    const calendar: CalendarPort = { getBusyIntervals: async () => ({ ok: false, error: { code: "PROVIDER_UNAVAILABLE", retryable: true } }) };
    await expect(createService(noAppointments, calendar).validateSlot({
      tenantId: business.tenantId, serviceId: "cleaning", employeeId: "dr-lee", startAt: "2026-08-10T16:30:00.000Z",
    })).resolves.toEqual({ ok: false, error: { code: "EXTERNAL_CALENDAR_UNAVAILABLE", retryable: true } });
  });

  it("does not accept a slot outside the employee's working hours", async () => {
    await expect(createService().validateSlot({
      tenantId: business.tenantId, serviceId: "cleaning", employeeId: "dr-lee", startAt: "2026-08-10T15:00:00.000Z",
    })).resolves.toEqual({ ok: false, error: { code: "OUTSIDE_BUSINESS_HOURS" } });
  });

  it("uses a clinic's configured 30-minute interval and never starts a future-day search at the current time", async () => {
    const configuredBusiness = {
      ...business,
      openingHours: [{ dayOfWeek: 1 as const, startTime: "07:00", endTime: "10:00" }],
      slotIntervalMinutes: 30,
    };
    const configuredHours: EmployeeWorkingHoursProvider = {
      getWorkingHours: async () => configuredBusiness.openingHours,
    };
    const service = new SchedulingServiceImpl(
      new BusinessDirectoryService(new InMemoryBusinessRepository([configuredBusiness])),
      configuredHours,
      noAppointments,
      noCalendarConflicts,
      { now: () => new Date("2026-08-10T23:00:00.000Z") },
    );
    const result = await service.findAvailableSlots({
      tenantId: configuredBusiness.tenantId,
      serviceId: "cleaning",
      rangeStart: "2026-08-17T06:00:00.000Z",
      rangeEnd: "2026-08-18T06:00:00.000Z",
    });

    expect(result).toEqual({ ok: true, value: [
      { employeeId: "dr-lee", startAt: "2026-08-17T13:00:00.000Z", endAt: "2026-08-17T13:30:00.000Z" },
      { employeeId: "dr-lee", startAt: "2026-08-17T13:30:00.000Z", endAt: "2026-08-17T14:00:00.000Z" },
      { employeeId: "dr-lee", startAt: "2026-08-17T14:00:00.000Z", endAt: "2026-08-17T14:30:00.000Z" },
      { employeeId: "dr-lee", startAt: "2026-08-17T14:30:00.000Z", endAt: "2026-08-17T15:00:00.000Z" },
      { employeeId: "dr-lee", startAt: "2026-08-17T15:00:00.000Z", endAt: "2026-08-17T15:30:00.000Z" },
      { employeeId: "dr-lee", startAt: "2026-08-17T15:30:00.000Z", endAt: "2026-08-17T16:00:00.000Z" },
    ] });
  });

  it("keeps the normal earliest slot at opening time, then advances by the configured cadence when early slots are busy", async () => {
    const configuredBusiness = {
      ...business,
      openingHours: [{ dayOfWeek: 1 as const, startTime: "07:00", endTime: "10:00" }],
      slotIntervalMinutes: 30,
    };
    const busy: Array<{ startAt: string; endAt: string }> = [];
    const calendar: CalendarPort = { getBusyIntervals: async () => success(busy) };
    const service = new SchedulingServiceImpl(
      new BusinessDirectoryService(new InMemoryBusinessRepository([configuredBusiness])),
      { getWorkingHours: async () => configuredBusiness.openingHours },
      noAppointments,
      calendar,
      clock,
    );
    const query = {
      tenantId: configuredBusiness.tenantId,
      serviceId: "cleaning",
      rangeStart: "2026-08-17T06:00:00.000Z",
      rangeEnd: "2026-08-18T06:00:00.000Z",
    };

    const first = await service.findAvailableSlots(query);
    expect(first.ok).toBe(true);
    if (!first.ok) throw new Error("Expected availability");
    expect(first.value[0]?.startAt).toBe("2026-08-17T13:00:00.000Z");

    busy.push({ startAt: "2026-08-17T13:00:00.000Z", endAt: "2026-08-17T13:30:00.000Z" });
    const second = await service.findAvailableSlots(query);
    expect(second.ok).toBe(true);
    if (!second.ok) throw new Error("Expected availability");
    expect(second.value[0]?.startAt).toBe("2026-08-17T13:30:00.000Z");

    busy.push({ startAt: "2026-08-17T13:30:00.000Z", endAt: "2026-08-17T14:00:00.000Z" });
    busy.push({ startAt: "2026-08-17T21:00:00.000Z", endAt: "2026-08-17T21:30:00.000Z" });
    const third = await service.findAvailableSlots(query);
    expect(third.ok).toBe(true);
    if (!third.ok) throw new Error("Expected availability");
    expect(third.value[0]?.startAt).toBe("2026-08-17T14:00:00.000Z");
  });
});
