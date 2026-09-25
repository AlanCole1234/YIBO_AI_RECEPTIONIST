import { failure, success } from "../../../shared/domain/result.js";
import type { BusinessDirectory } from "../../business/index.js";
import type { CalendarAssignmentResolver } from "./calendar-assignment-resolver.js";

export class BusinessCalendarAssignmentResolver implements CalendarAssignmentResolver {
  constructor(private readonly businesses: BusinessDirectory) {}

  async resolve(query: { tenantId: string; locationId: string; employeeId: string }) {
    const context = await this.businesses.getLocation(query.tenantId, query.locationId);
    if (!context.ok) return failure({ code: "CALENDAR_NOT_CONFIGURED" as const });
    const assignment = context.value.location.professionals.find((professional) =>
      professional.professionalId === query.employeeId && professional.active);
    if (!assignment) return failure({ code: "CALENDAR_NOT_CONFIGURED" as const });
    const professionalCalendar = assignment.calendarId?.trim();
    if (professionalCalendar) return success({
      calendarId: professionalCalendar,
      timezone: context.value.location.timezone,
      source: "professional" as const,
    });
    const locationCalendar = context.value.location.defaultCalendarId?.trim();
    return locationCalendar
      ? success({
          calendarId: locationCalendar,
          timezone: context.value.location.timezone,
          source: "location" as const,
        })
      : failure({ code: "CALENDAR_NOT_CONFIGURED" as const });
  }
}
