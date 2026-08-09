import type { Result } from "../../../shared/domain/result.js";
import type {
  AppointmentId,
  CustomerId,
  EmployeeId,
  IdempotencyKey,
  ISODateTime,
  TenantId,
} from "../../../shared/types/identifiers.js";

export interface CustomerReader {
  exists(tenantId: TenantId, customerId: CustomerId): Promise<boolean>;
}

export interface AppointmentConcurrencyGuard {
  execute<T>(tenantId: TenantId, employeeId: EmployeeId, operation: () => Promise<T>): Promise<T>;
}

export interface AppointmentCalendarPort {
  createEvent(command: {
    tenantId: TenantId;
    appointmentId: AppointmentId;
    employeeId: EmployeeId;
    title: string;
    startAt: ISODateTime;
    endAt: ISODateTime;
    idempotencyKey: IdempotencyKey;
  }): Promise<Result<{ provider: string; externalEventId: string }, AppointmentCalendarError>>;
  cancelEvent(command: {
    tenantId: TenantId;
    externalEventId: string;
  }): Promise<Result<void, AppointmentCalendarError>>;
}

export type AppointmentCalendarError =
  | { code: "AUTHORIZATION_REQUIRED" }
  | { code: "RATE_LIMITED"; retryAfterMs?: number }
  | { code: "PROVIDER_UNAVAILABLE"; retryable: boolean }
  | { code: "EVENT_NOT_FOUND" }
  | { code: "VALIDATION_ERROR"; message: string };
