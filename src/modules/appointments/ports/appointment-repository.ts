import type {
  AppointmentId,
  CustomerId,
  IdempotencyKey,
  ISODateTime,
  LocationId,
  TenantId,
} from "../../../shared/types/identifiers.js";
import type { Appointment } from "../domain/appointment.js";

export interface AppointmentRepository {
  findById(tenantId: TenantId, appointmentId: AppointmentId): Promise<Appointment | null>;
  findByIdempotencyKey(tenantId: TenantId, key: IdempotencyKey): Promise<Appointment | null>;
  findUpcomingByCustomer(query: {
    tenantId: TenantId;
    locationId: LocationId;
    customerId: CustomerId;
    startsAtOrAfter: ISODateTime;
  }): Promise<Appointment[]>;
  hasProfessionalReferences(query: {
    tenantId: TenantId;
    professionalId: string;
    locationId?: string;
  }): Promise<boolean>;
  /** Local atomic read used inside configuration persistence; includes uncertain failed bookings. */
  calendarRouteReferences(tenantId: TenantId): Array<{ locationId: string; employeeId: string }>;
  save(appointment: Appointment): Promise<void>;
}
