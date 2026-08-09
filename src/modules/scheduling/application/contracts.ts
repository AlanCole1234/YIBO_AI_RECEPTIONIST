import type { Result } from "../../../shared/domain/result.js";
import type { EmployeeId, ServiceId, TenantId } from "../../../shared/types/identifiers.js";

export interface SchedulingService {
  findAvailableSlots(
    query: FindAvailableSlotsQuery,
  ): Promise<Result<AvailableSlot[], SchedulingError>>;
  validateSlot(
    query: ValidateSlotQuery,
  ): Promise<Result<ValidatedSlot, SchedulingError>>;
}

export interface FindAvailableSlotsQuery {
  tenantId: TenantId;
  serviceId: ServiceId;
  employeeId?: EmployeeId;
  rangeStart: string;
  rangeEnd: string;
  limit?: number;
}

export interface ValidateSlotQuery {
  tenantId: TenantId;
  serviceId: ServiceId;
  employeeId: EmployeeId;
  startAt: string;
}

export interface AvailableSlot {
  employeeId: EmployeeId;
  startAt: string;
  endAt: string;
}

export interface ValidatedSlot extends AvailableSlot {
  validatedAt: string;
}

export type SchedulingError =
  | { code: "SERVICE_NOT_FOUND" }
  | { code: "EMPLOYEE_NOT_FOUND" }
  | { code: "OUTSIDE_BUSINESS_HOURS" }
  | { code: "EMPLOYEE_UNAVAILABLE" }
  | { code: "SLOT_CONFLICT" }
  | { code: "INVALID_TIME_RANGE" }
  | { code: "EXTERNAL_CALENDAR_UNAVAILABLE"; retryable: boolean };
