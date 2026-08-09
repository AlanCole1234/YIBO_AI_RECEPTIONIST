import type {
  AppointmentId,
  IdempotencyKey,
  TenantId,
} from "../../../shared/types/identifiers.js";
import type { Appointment } from "../domain/appointment.js";

export interface AppointmentRepository {
  findById(tenantId: TenantId, appointmentId: AppointmentId): Promise<Appointment | null>;
  findByIdempotencyKey(tenantId: TenantId, key: IdempotencyKey): Promise<Appointment | null>;
  save(appointment: Appointment): Promise<void>;
}
