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

  async findUpcomingByCustomer(query: {
    tenantId: string; locationId: string; customerId: string; startsAtOrAfter: string;
  }): Promise<Appointment[]> {
    return [...this.appointments.values()]
      .filter((appointment) => appointment.tenantId === query.tenantId
        && appointment.locationId === query.locationId
        && appointment.customerId === query.customerId
        && appointment.status === "CONFIRMED"
        && appointment.startAt >= query.startsAtOrAfter)
      .sort((left, right) => left.startAt.localeCompare(right.startAt))
      .map((appointment) => ({ ...appointment }));
  }

  async findInRange(query: { tenantId: string; locationId: string; rangeStart: string; rangeEnd: string }): Promise<Appointment[]> {
    return [...this.appointments.values()]
      .filter(item => item.tenantId === query.tenantId && item.locationId === query.locationId
        && item.startAt < query.rangeEnd && item.endAt > query.rangeStart)
      .sort((a, b) => a.startAt.localeCompare(b.startAt) || a.id.localeCompare(b.id))
      .map(item => ({ ...item }));
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

  calendarRouteReferences(tenantId: TenantId) {
    return [...this.appointments.values()]
      .filter(appointment => appointment.tenantId === tenantId && appointment.status !== "CANCELLED")
      .map(({ locationId, employeeId }) => ({ locationId, employeeId }));
  }

  async save(appointment: Appointment): Promise<void> {
    this.appointments.set(`${appointment.tenantId}:${appointment.id}`, { ...appointment });
  }
}
