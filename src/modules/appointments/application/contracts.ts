import type { Result } from "../../../shared/domain/result.js";
import type {
  AppointmentId,
  CallId,
  CustomerId,
  EmployeeId,
  IdempotencyKey,
  ISODateTime,
  ServiceId,
  TenantId,
} from "../../../shared/types/identifiers.js";
import type { Appointment } from "../domain/appointment.js";

export interface CreateAppointmentCommand {
  tenantId: TenantId;
  customerId: CustomerId;
  serviceId: ServiceId;
  employeeId: EmployeeId;
  startAt: ISODateTime;
  idempotencyKey: IdempotencyKey;
  source: "AI_CALL" | "DASHBOARD" | "API";
  sourceCallId?: CallId;
}

export interface CancelAppointmentCommand {
  tenantId: TenantId;
  appointmentId: AppointmentId;
}

export interface RescheduleAppointmentCommand {
  tenantId: TenantId;
  appointmentId: AppointmentId;
  startAt: ISODateTime;
}

export interface GetAppointmentQuery {
  tenantId: TenantId;
  appointmentId: AppointmentId;
}

export type CreateAppointmentError =
  | { code: "SLOT_NO_LONGER_AVAILABLE" }
  | { code: "CUSTOMER_NOT_FOUND" }
  | { code: "SERVICE_NOT_FOUND" }
  | { code: "EMPLOYEE_NOT_FOUND" }
  | { code: "CALENDAR_SYNC_FAILED"; retryable: boolean }
  | { code: "IDEMPOTENCY_CONFLICT" }
  | { code: "VALIDATION_ERROR"; message: string };

export type CancelAppointmentError =
  | { code: "APPOINTMENT_NOT_FOUND" }
  | { code: "APPOINTMENT_ALREADY_CANCELLED" }
  | { code: "CALENDAR_SYNC_FAILED"; retryable: boolean };

export type RescheduleAppointmentError =
  | { code: "APPOINTMENT_NOT_FOUND" }
  | { code: "APPOINTMENT_NOT_CONFIRMED" }
  | { code: "SLOT_NO_LONGER_AVAILABLE" }
  | { code: "CALENDAR_SYNC_FAILED"; retryable: boolean }
  | { code: "VALIDATION_ERROR"; message: string };

export type AppointmentLookupError = { code: "APPOINTMENT_NOT_FOUND" };

export interface AppointmentService {
  createAppointment(
    command: CreateAppointmentCommand,
  ): Promise<Result<Appointment, CreateAppointmentError>>;
  cancelAppointment(
    command: CancelAppointmentCommand,
  ): Promise<Result<Appointment, CancelAppointmentError>>;
  rescheduleAppointment(
    command: RescheduleAppointmentCommand,
  ): Promise<Result<Appointment, RescheduleAppointmentError>>;
  getAppointment(
    query: GetAppointmentQuery,
  ): Promise<Result<Appointment, AppointmentLookupError>>;
}
