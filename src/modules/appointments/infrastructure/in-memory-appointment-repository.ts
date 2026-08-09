import type { AppointmentId, IdempotencyKey, TenantId } from "../../../shared/types/identifiers.js";
import type { Appointment } from "../domain/appointment.js";
import type { AppointmentRepository } from "../ports/appointment-repository.js";

export class InMemoryAppointmentRepository implements AppointmentRepository {
  private readonly appointments = new Map<string, Appointment>();

  async findById(tenantId: TenantId, appointmentId: AppointmentId): Promise<Appointment | null> {
    const value = this.appointments.get(`${tenantId}:${appointmentId}`);
    return value ? { ...value } : null;
  }

  async findByIdempotencyKey(tenantId: TenantId, key: IdempotencyKey): Promise<Appointment | null> {
    const value = [...this.appointments.values()].find(
      (appointment) => appointment.tenantId === tenantId && appointment.idempotencyKey === key,
    );
    return value ? { ...value } : null;
  }

  async save(appointment: Appointment): Promise<void> {
    this.appointments.set(`${appointment.tenantId}:${appointment.id}`, { ...appointment });
  }
}
