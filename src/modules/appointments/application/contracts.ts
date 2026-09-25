import type { Result } from "../../../shared/domain/result.js";
import type {
  AppointmentId,
  CallId,
  CustomerId,
  EmployeeId,
  IdempotencyKey,
  ISODateTime,
  LocationId,
  ServiceId,
  TenantId,
} from "../../../shared/types/identifiers.js";
import type { Appointment, AppointmentEvent } from "../domain/appointment.js";

export interface CreateAppointmentCommand {
  tenantId: TenantId;
  locationId: LocationId;
  customerId: CustomerId;
  serviceId: ServiceId;
  employeeId: EmployeeId;
  startAt: ISODateTime;
  idempotencyKey: IdempotencyKey;
  source: "AI_CALL" | "DASHBOARD" | "API" | "DEVELOPER_TEST";
  sourceCallId?: CallId;
}

export interface CancelAppointmentCommand {
  tenantId: TenantId;
  locationId: LocationId;
  appointmentId: AppointmentId;
}

export interface RescheduleAppointmentCommand {
  tenantId: TenantId;
  locationId: LocationId;
  appointmentId: AppointmentId;
  startAt: ISODateTime;
}

export interface GetAppointmentQuery {
  tenantId: TenantId;
  locationId: LocationId;
  appointmentId: AppointmentId;
}

export interface ListUpcomingAppointmentsQuery {
  tenantId: TenantId;
  locationId: LocationId;
  customerId: CustomerId;
}
export interface ListAppointmentsQuery { tenantId: TenantId; locationId: LocationId; rangeStart: ISODateTime; rangeEnd: ISODateTime;
  employeeId?: EmployeeId; serviceId?: ServiceId; status?: string }
export interface MarkAppointmentOutcomeCommand { tenantId: TenantId; locationId: LocationId; appointmentId: AppointmentId;
  outcome: "COMPLETED" | "NO_SHOW" }

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
  | { code: "CANCELLATION_NOTICE_NOT_MET" }
  | { code: "CALENDAR_SYNC_FAILED"; retryable: boolean };

export type RescheduleAppointmentError =
  | { code: "APPOINTMENT_NOT_FOUND" }
  | { code: "APPOINTMENT_NOT_CONFIRMED" }
  | { code: "RESCHEDULE_NOTICE_NOT_MET" }
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
  listUpcomingAppointments(query: ListUpcomingAppointmentsQuery): Promise<Appointment[]>;
  listAppointments(query: ListAppointmentsQuery): Promise<Appointment[]>;
  listAppointmentEvents(query: GetAppointmentQuery): Promise<AppointmentEvent[]>;
  markAppointmentOutcome(command: MarkAppointmentOutcomeCommand): Promise<Result<Appointment, AppointmentLookupError>>;
  listCustomerHistory(tenantId: TenantId, customerId: CustomerId, limit?: number): Promise<Appointment[]>;
  listTenantHistory(tenantId: TenantId, limit?: number): Promise<Appointment[]>;
}
