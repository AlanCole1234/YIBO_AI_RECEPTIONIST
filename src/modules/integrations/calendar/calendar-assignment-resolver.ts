import type { Result } from "../../../shared/domain/result.js";

export interface CalendarAssignment {
  calendarId: string;
  timezone: string;
  source: "professional" | "location";
}

export interface CalendarAssignmentResolver {
  resolve(query: {
    tenantId: string;
    locationId: string;
    employeeId: string;
  }): Promise<Result<CalendarAssignment, { code: "CALENDAR_NOT_CONFIGURED" }>>;
}
