import type { Result } from "../../../shared/domain/result.js";
import type { EmployeeId, LocationId, TenantId } from "../../../shared/types/identifiers.js";

export interface CalendarPort {
  getBusyIntervals(
    query: GetBusyIntervalsQuery,
  ): Promise<Result<BusyInterval[], CalendarError>>;
}

export interface GetBusyIntervalsQuery {
  tenantId: TenantId;
  locationId: LocationId;
  employeeId: EmployeeId;
  rangeStart: string;
  rangeEnd: string;
}

export interface BusyInterval {
  startAt: string;
  endAt: string;
}

export type CalendarError =
  | { code: "CALENDAR_NOT_CONNECTED" }
  | { code: "AUTHORIZATION_REQUIRED" }
  | { code: "RATE_LIMITED"; retryAfterMs?: number }
  | { code: "PROVIDER_UNAVAILABLE"; retryable: boolean }
  | { code: "VALIDATION_ERROR"; message: string };
