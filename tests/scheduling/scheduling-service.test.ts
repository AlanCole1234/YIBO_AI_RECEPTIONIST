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

const createService = (
  appointments = noAppointments,
  calendar = noCalendarConflicts,
  hours = workingHours,
) => new SchedulingServiceImpl(
  new BusinessDirectoryService(new InMemoryBusinessRepository([business])), hours, appointments, calendar, clock,
);

describe("SchedulingService", () => {
  it("returns slots only in the intersection of business and employee hours", async () => {
    const result = await createService().findAvailableSlots({
      tenantId: business.tenantId, locationId: "default", serviceId: "cleaning",
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
      tenantId: business.tenantId, locationId: "default", serviceId: "cleaning", employeeId: "dr-lee", startAt: "2026-08-10T16:00:00.000Z",
    })).resolves.toEqual({ ok: false, error: { code: "SLOT_CONFLICT" } });
  });

  it("rejects an external calendar outage with a retryable typed error", async () => {
    const calendar: CalendarPort = { getBusyIntervals: async () => ({ ok: false, error: { code: "PROVIDER_UNAVAILABLE", retryable: true } }) };
    await expect(createService(noAppointments, calendar).validateSlot({
      tenantId: business.tenantId, locationId: "default", serviceId: "cleaning", employeeId: "dr-lee", startAt: "2026-08-10T16:30:00.000Z",
    })).resolves.toEqual({ ok: false, error: { code: "EXTERNAL_CALENDAR_UNAVAILABLE", retryable: true } });
  });

  it("does not accept a slot outside the employee's working hours", async () => {
    await expect(createService().validateSlot({
      tenantId: business.tenantId, locationId: "default", serviceId: "cleaning", employeeId: "dr-lee", startAt: "2026-08-10T15:00:00.000Z",
    })).resolves.toEqual({ ok: false, error: { code: "OUTSIDE_BUSINESS_HOURS" } });
  });

  it("inherits location hours when no professional override is configured", async () => {
    const inheritedHours: EmployeeWorkingHoursProvider = { getWorkingHours: async () => [] };
    const result = await createService(noAppointments, noCalendarConflicts, inheritedHours).findAvailableSlots({
      tenantId: business.tenantId, locationId: "default", serviceId: "cleaning", employeeId: "dr-lee",
      rangeStart: "2026-08-10T00:00:00.000Z", rangeEnd: "2026-08-11T00:00:00.000Z",
    });
    expect(result.ok && result.value[0]?.startAt).toBe("2026-08-10T15:00:00.000Z");
    expect(result.ok && result.value.at(-1)?.endAt).toBe("2026-08-10T18:00:00.000Z");
  });

  it("intersects each location and professional interval without spanning gaps", async () => {
    const splitHours: EmployeeWorkingHoursProvider = {
      getWorkingHours: async () => [
        { dayOfWeek: 1, startTime: "08:00", endTime: "10:00" },
        { dayOfWeek: 1, startTime: "11:00", endTime: "13:00" },
      ],
    };
    const result = await createService(noAppointments, noCalendarConflicts, splitHours).findAvailableSlots({
      tenantId: business.tenantId, locationId: "default", serviceId: "cleaning", employeeId: "dr-lee",
      rangeStart: "2026-08-10T00:00:00.000Z", rangeEnd: "2026-08-11T00:00:00.000Z",
    });
    if (!result.ok) throw new Error("Expected slots");
    expect(result.value.map(({ startAt }) => startAt)).toEqual([
      "2026-08-10T15:00:00.000Z", "2026-08-10T15:15:00.000Z", "2026-08-10T15:30:00.000Z",
      "2026-08-10T17:00:00.000Z", "2026-08-10T17:15:00.000Z", "2026-08-10T17:30:00.000Z",
    ]);
  });
});
