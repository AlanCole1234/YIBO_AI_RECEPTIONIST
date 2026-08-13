import type { DatabaseSync } from "node:sqlite";
import type { Appointment, AppointmentRepository } from "../../modules/appointments/index.js";
import type { ConfirmedAppointmentReader, ConfirmedAppointmentQuery, OccupiedInterval } from "../../modules/scheduling/index.js";
import type { AppointmentId, IdempotencyKey, RegionId, TenantId } from "../../shared/types/identifiers.js";

type AppointmentRow = {
  id: string; tenant_id: string; customer_id: string; service_id: string; employee_id: string;
  start_at: string; end_at: string; status: Appointment["status"]; idempotency_key: string;
  source: Appointment["source"]; source_call_id: string | null; external_calendar_event_id: string | null;
};

export class SqliteAppointmentRepository implements AppointmentRepository, ConfirmedAppointmentReader {
  constructor(private readonly database: DatabaseSync, private readonly region: RegionId) {}

  async findById(tenantId: TenantId, appointmentId: AppointmentId): Promise<Appointment | null> {
    return this.row(this.database.prepare(`${SELECT_APPOINTMENT} AND id = ?`)
      .get(this.region, tenantId, appointmentId) as AppointmentRow | undefined);
  }

  async findByIdempotencyKey(tenantId: TenantId, key: IdempotencyKey): Promise<Appointment | null> {
    return this.row(this.database.prepare(`${SELECT_APPOINTMENT} AND idempotency_key = ?`)
      .get(this.region, tenantId, key) as AppointmentRow | undefined);
  }

  async save(value: Appointment): Promise<void> {
    this.database.prepare(`
      INSERT INTO appointments(
        region_id, tenant_id, id, customer_id, service_id, employee_id, start_at, end_at,
        status, idempotency_key, source, source_call_id, external_calendar_event_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(region_id, tenant_id, id) DO UPDATE SET
        customer_id = excluded.customer_id, service_id = excluded.service_id,
        employee_id = excluded.employee_id, start_at = excluded.start_at, end_at = excluded.end_at,
        status = excluded.status, idempotency_key = excluded.idempotency_key, source = excluded.source,
        source_call_id = excluded.source_call_id, external_calendar_event_id = excluded.external_calendar_event_id
    `).run(
      this.region, value.tenantId, value.id, value.customerId, value.serviceId, value.employeeId,
      value.startAt, value.endAt, value.status, value.idempotencyKey, value.source,
      value.sourceCallId ?? null, value.externalCalendarEventId ?? null,
    );
  }

  async findConfirmedIntervals(query: ConfirmedAppointmentQuery): Promise<OccupiedInterval[]> {
    return this.database.prepare(`
      SELECT start_at, end_at FROM appointments
      WHERE region_id = ? AND tenant_id = ? AND employee_id = ? AND status = 'CONFIRMED'
        AND start_at < ? AND ? < end_at
      ORDER BY start_at
    `).all(this.region, query.tenantId, query.employeeId, query.rangeEnd, query.rangeStart)
      .map((row) => {
        const value = row as { start_at: string; end_at: string };
        return { startAt: value.start_at, endAt: value.end_at };
      });
  }

  private row(value: AppointmentRow | undefined): Appointment | null {
    if (!value) return null;
    return {
      id: value.id, tenantId: value.tenant_id, customerId: value.customer_id,
      serviceId: value.service_id, employeeId: value.employee_id, startAt: value.start_at,
      endAt: value.end_at, status: value.status, idempotencyKey: value.idempotency_key,
      source: value.source,
      ...(value.source_call_id ? { sourceCallId: value.source_call_id } : {}),
      ...(value.external_calendar_event_id ? { externalCalendarEventId: value.external_calendar_event_id } : {}),
    };
  }
}

const SELECT_APPOINTMENT = `
  SELECT id, tenant_id, customer_id, service_id, employee_id, start_at, end_at, status,
    idempotency_key, source, source_call_id, external_calendar_event_id
  FROM appointments WHERE region_id = ? AND tenant_id = ?
`;
