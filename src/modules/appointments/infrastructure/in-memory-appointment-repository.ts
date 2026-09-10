import type { AppointmentId, IdempotencyKey, TenantId } from "../../../shared/types/identifiers.js";
import type { Appointment } from "../domain/appointment.js";
import type { AppointmentRepository } from "../ports/appointment-repository.js";
import type { ConfirmedAppointmentQuery, ConfirmedAppointmentReader } from "../../scheduling/index.js";

export class InMemoryAppointmentRepository implements AppointmentRepository, ConfirmedAppointmentReader {
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

  async hasProfessionalReferences(query: { tenantId: TenantId; professionalId: string; locationId?: string }) {
    return [...this.appointments.values()].some((appointment) => appointment.tenantId === query.tenantId
      && appointment.employeeId === query.professionalId
      && (query.locationId === undefined || appointment.locationId === query.locationId));
  }

  async findConfirmedIntervals(query: ConfirmedAppointmentQuery) {
    return [...this.appointments.values()]
      .filter((appointment) => appointment.tenantId === query.tenantId
        && appointment.locationId === query.locationId
        && appointment.employeeId === query.employeeId
        && appointment.status === "CONFIRMED"
        && appointment.startAt < query.rangeEnd && query.rangeStart < appointment.endAt)
      .map(({ startAt, endAt }) => ({ startAt, endAt }))
      .sort((left, right) => left.startAt.localeCompare(right.startAt));
  }

  async findConfirmedLocationIntervals(query: { tenantId: TenantId; locationId: string; rangeStart: string; rangeEnd: string }) {
    return [...this.appointments.values()]
      .filter((appointment) => appointment.tenantId === query.tenantId
        && appointment.locationId === query.locationId && appointment.status === "CONFIRMED"
        && appointment.startAt < query.rangeEnd && query.rangeStart < appointment.endAt)
      .map(({ startAt, endAt }) => ({ startAt, endAt }))
      .sort((left, right) => left.startAt.localeCompare(right.startAt));
  }

  async save(appointment: Appointment): Promise<void> {
    this.appointments.set(`${appointment.tenantId}:${appointment.id}`, { ...appointment });
  }
}
