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

export type AppointmentStatus =
  | "PENDING_CONFIRMATION"
  | "CONFIRMED"
  | "CANCELLED"
  | "FAILED";

export interface Appointment {
  id: AppointmentId;
  tenantId: TenantId;
  customerId: CustomerId;
  serviceId: ServiceId;
  employeeId: EmployeeId;
  startAt: ISODateTime;
  endAt: ISODateTime;
  status: AppointmentStatus;
  idempotencyKey: IdempotencyKey;
  source: "AI_CALL" | "DASHBOARD" | "API";
  sourceCallId?: CallId;
  externalCalendarEventId?: string;
}
