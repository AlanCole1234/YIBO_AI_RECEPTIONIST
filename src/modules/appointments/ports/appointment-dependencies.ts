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
  get(tenantId: TenantId, customerId: CustomerId): Promise<{ name?: string; phone: string } | null>;
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
    serviceName: string;
    patient?: { name?: string; phone: string };
    startAt: ISODateTime;
    endAt: ISODateTime;
    idempotencyKey: IdempotencyKey;
  }): Promise<Result<{ provider: string; externalEventId: string }, AppointmentCalendarError>>;
  /** Change only the times of the existing appointment event; preserve its ID. */
  rescheduleEvent(command: {
    tenantId: TenantId;
    appointmentId: AppointmentId;
    externalEventId: string;
    startAt: ISODateTime;
    endAt: ISODateTime;
  }): Promise<Result<void, AppointmentCalendarError>>;
  cancelEvent(command: {
    tenantId: TenantId;
    appointmentId: AppointmentId;
    externalEventId: string;
  }): Promise<Result<void, AppointmentCalendarError>>;
}

export type AppointmentCalendarError =
  | { code: "CALENDAR_NOT_CONNECTED" }
  | { code: "AUTHORIZATION_REQUIRED" }
  | { code: "RATE_LIMITED"; retryAfterMs?: number }
  | { code: "PROVIDER_UNAVAILABLE"; retryable: boolean }
  | { code: "EVENT_NOT_FOUND" }
  | { code: "VALIDATION_ERROR"; message: string };
