import { failure, success } from "../../../shared/domain/result.js";
import type { EmployeeDefinition, OpeningHoursRule, ServiceDefinition } from "../../business/index.js";
import type { BusinessDirectory } from "../../business/index.js";
import {
  intersects,
  localParts,
  minuteOfDay,
  rulesForDay,
  toUtc,
  type LocalDateTimeParts,
} from "../domain/time.js";
import type {
  AvailableSlot,
  FindAvailableSlotsQuery,
  SchedulingError,
  SchedulingService,
  ValidateSlotQuery,
  ValidatedSlot,
} from "./contracts.js";
import type { CalendarPort } from "../ports/calendar-port.js";
import type { ConfirmedAppointmentReader } from "../ports/confirmed-appointment-reader.js";
import type { EmployeeWorkingHoursProvider } from "../ports/employee-working-hours-provider.js";

const SLOT_INCREMENT_MINUTES = 15;

export class SchedulingServiceImpl implements SchedulingService {
  constructor(
    private readonly businessDirectory: BusinessDirectory,
    private readonly workingHours: EmployeeWorkingHoursProvider,
    private readonly appointments: ConfirmedAppointmentReader,
    private readonly calendar: CalendarPort,
  ) {}

  async findAvailableSlots(query: FindAvailableSlotsQuery) {
    const range = parseRange(query.rangeStart, query.rangeEnd);
    if (!range) return failure<SchedulingError>({ code: "INVALID_TIME_RANGE" });

    const configuration = await this.configuration(query.tenantId, query.serviceId, query.employeeId);
    if (!configuration.ok) return configuration;
    const { business, service, employees } = configuration.value;

    const slots: AvailableSlot[] = [];
    for (const employee of employees) {
      const employeeSlots = await this.availableForEmployee({
        tenantId: query.tenantId,
        employee,
        service,
        timezone: business.timezone,
        businessHours: business.openingHours,
        rangeStart: range.start,
        rangeEnd: range.end,
      });
      if (!employeeSlots.ok) return employeeSlots;
      slots.push(...employeeSlots.value);
    }

    slots.sort((left, right) => left.startAt.localeCompare(right.startAt));
    return success(slots.slice(0, query.limit ?? 20));
  }

  async validateSlot(query: ValidateSlotQuery) {
    const start = new Date(query.startAt);
    if (Number.isNaN(start.valueOf())) return failure<SchedulingError>({ code: "INVALID_TIME_RANGE" });

    const configuration = await this.configuration(query.tenantId, query.serviceId, query.employeeId);
    if (!configuration.ok) return configuration;
    const { business, service, employees } = configuration.value;
    const employee = employees[0]!;
    const end = new Date(start.valueOf() + (service.durationMinutes + service.bufferMinutes) * 60_000);

    const isWithinHours = await this.isWithinHours(
      query.tenantId, employee.id, business.timezone, business.openingHours, start, end,
    );
    if (!isWithinHours) return failure<SchedulingError>({ code: "OUTSIDE_BUSINESS_HOURS" });

    const conflict = await this.hasConflict(query.tenantId, employee.id, start, end);
    if (!conflict.ok) return conflict;
    if (conflict.value) return failure<SchedulingError>({ code: "SLOT_CONFLICT" });

    return success<ValidatedSlot>({
      employeeId: employee.id,
      startAt: start.toISOString(),
      endAt: end.toISOString(),
      validatedAt: new Date().toISOString(),
    });
  }

  private async configuration(tenantId: string, serviceId: string, requestedEmployeeId?: string) {
    const businessResult = await this.businessDirectory.getBusinessProfile(tenantId);
    if (!businessResult.ok) return failure<SchedulingError>({ code: "EMPLOYEE_UNAVAILABLE" });
    const business = businessResult.value;
    const service = business.services.find((candidate) => candidate.id === serviceId);
    if (!service) return failure<SchedulingError>({ code: "SERVICE_NOT_FOUND" });

    const employees = business.employees.filter((employee) =>
      employee.active && service.eligibleEmployeeIds.includes(employee.id) &&
      (!requestedEmployeeId || employee.id === requestedEmployeeId),
    );
    if (requestedEmployeeId && employees.length === 0) {
      return failure<SchedulingError>({ code: "EMPLOYEE_NOT_FOUND" });
    }
    if (employees.length === 0) return failure<SchedulingError>({ code: "EMPLOYEE_UNAVAILABLE" });
    return success({ business, service, employees });
  }

  private async availableForEmployee(input: {
    tenantId: string;
    employee: EmployeeDefinition;
    service: ServiceDefinition;
    timezone: string;
    businessHours: OpeningHoursRule[];
    rangeStart: Date;
    rangeEnd: Date;
  }) {
    const employeeHours = await this.workingHours.getWorkingHours({
      tenantId: input.tenantId,
      employeeId: input.employee.id,
    });
    if (employeeHours.length === 0) return success<AvailableSlot[]>([]);

    const conflict = await this.conflictIntervals(input.tenantId, input.employee.id, input.rangeStart, input.rangeEnd);
    if (!conflict.ok) return conflict;
    const result: AvailableSlot[] = [];
    const firstDay = localParts(input.rangeStart, input.timezone);
    const lastDay = localParts(input.rangeEnd, input.timezone);
    let cursor = new Date(Date.UTC(firstDay.year, firstDay.month - 1, firstDay.day));
    const finalDay = Date.UTC(lastDay.year, lastDay.month - 1, lastDay.day);

    while (cursor.valueOf() <= finalDay) {
      const day: LocalDateTimeParts = {
        year: cursor.getUTCFullYear(), month: cursor.getUTCMonth() + 1, day: cursor.getUTCDate(), hour: 0, minute: 0,
      };
      const weekday = cursor.getUTCDay();
      for (const businessRule of rulesForDay(input.businessHours, weekday)) {
        for (const employeeRule of rulesForDay(employeeHours, weekday)) {
          const startMinute = Math.max(minuteOfDay(businessRule.startTime), minuteOfDay(employeeRule.startTime));
          const endMinute = Math.min(minuteOfDay(businessRule.endTime), minuteOfDay(employeeRule.endTime));
          for (let minute = startMinute; minute + input.service.durationMinutes + input.service.bufferMinutes <= endMinute; minute += SLOT_INCREMENT_MINUTES) {
            const start = toUtc({ ...day, hour: Math.floor(minute / 60), minute: minute % 60 }, input.timezone);
            const end = new Date(start.valueOf() + (input.service.durationMinutes + input.service.bufferMinutes) * 60_000);
            if (start < input.rangeStart || end > input.rangeEnd || intersects(start, end, conflict.value)) continue;
            result.push({ employeeId: input.employee.id, startAt: start.toISOString(), endAt: end.toISOString() });
          }
        }
      }
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    return success(result);
  }

  private async isWithinHours(
    tenantId: string, employeeId: string, timezone: string, businessHours: OpeningHoursRule[], start: Date, end: Date,
  ): Promise<boolean> {
    const employeeHours = await this.workingHours.getWorkingHours({ tenantId, employeeId });
    const localStart = localParts(start, timezone);
    const localEnd = localParts(end, timezone);
    if (localStart.year !== localEnd.year || localStart.month !== localEnd.month || localStart.day !== localEnd.day) return false;
    const weekday = new Date(Date.UTC(localStart.year, localStart.month - 1, localStart.day)).getUTCDay();
    const startMinute = localStart.hour * 60 + localStart.minute;
    const endMinute = localEnd.hour * 60 + localEnd.minute;
    const inRule = (rule: OpeningHoursRule) => minuteOfDay(rule.startTime) <= startMinute && endMinute <= minuteOfDay(rule.endTime);
    return rulesForDay(businessHours, weekday).some(inRule) && rulesForDay(employeeHours, weekday).some(inRule);
  }

  private async hasConflict(tenantId: string, employeeId: string, start: Date, end: Date) {
    const intervals = await this.conflictIntervals(tenantId, employeeId, start, end);
    if (!intervals.ok) return intervals;
    return success(intersects(start, end, intervals.value));
  }

  private async conflictIntervals(tenantId: string, employeeId: string, rangeStart: Date, rangeEnd: Date) {
    const query = { tenantId, employeeId, rangeStart: rangeStart.toISOString(), rangeEnd: rangeEnd.toISOString() };
    const [localIntervals, externalIntervals] = await Promise.all([
      this.appointments.findConfirmedIntervals(query),
      this.calendar.getBusyIntervals(query),
    ]);
    if (!externalIntervals.ok) {
      return failure<SchedulingError>({
        code: "EXTERNAL_CALENDAR_UNAVAILABLE",
        retryable: externalIntervals.error.code === "PROVIDER_UNAVAILABLE" ? externalIntervals.error.retryable : false,
      });
    }
    return success([...localIntervals, ...externalIntervals.value]);
  }
}

const parseRange = (rangeStart: string, rangeEnd: string): { start: Date; end: Date } | null => {
  const start = new Date(rangeStart);
  const end = new Date(rangeEnd);
  return Number.isNaN(start.valueOf()) || Number.isNaN(end.valueOf()) || start >= end ? null : { start, end };
};
