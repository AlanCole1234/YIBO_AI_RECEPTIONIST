import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { failure, success } from "../../shared/domain/result.js";
import type { AppointmentCalendarPort } from "../../modules/appointments/index.js";
import type { BusyInterval, CalendarPort } from "../../modules/scheduling/index.js";
import type { RegionId } from "../../shared/types/identifiers.js";

export class SqliteCalendarAdapter implements CalendarPort, AppointmentCalendarPort {
  constructor(private readonly database: DatabaseSync, private readonly region: RegionId) {}

  async getBusyIntervals(query: { tenantId: string; employeeId: string; rangeStart: string; rangeEnd: string }) {
    if (!validRange(query.rangeStart, query.rangeEnd)) {
      return failure({ code: "VALIDATION_ERROR" as const, message: "A valid calendar range is required." });
    }
    const rows = this.database.prepare(`
      SELECT start_at, end_at FROM calendar_events
      WHERE region_id = ? AND tenant_id = ? AND employee_id = ? AND cancelled = 0
        AND start_at < ? AND ? < end_at ORDER BY start_at
    `).all(this.region, query.tenantId, query.employeeId, query.rangeEnd, query.rangeStart);
    return success(rows.map((row) => {
      const value = row as { start_at: string; end_at: string };
      return { startAt: value.start_at, endAt: value.end_at } satisfies BusyInterval;
    }));
  }

  async createEvent(command: {
    tenantId: string; appointmentId: string; employeeId: string; title: string;
    startAt: string; endAt: string; idempotencyKey: string;
  }) {
    if (!command.tenantId || !command.appointmentId || !command.employeeId || !command.idempotencyKey ||
        !validRange(command.startAt, command.endAt)) {
      return failure({ code: "VALIDATION_ERROR" as const, message: "A complete and valid calendar event is required." });
    }
    const existing = this.database.prepare(`
      SELECT external_event_id FROM calendar_events
      WHERE region_id = ? AND tenant_id = ? AND idempotency_key = ?
    `).get(this.region, command.tenantId, command.idempotencyKey) as { external_event_id: string } | undefined;
    if (existing) return success({ provider: "sqlite-local", externalEventId: existing.external_event_id });

    const externalEventId = `local-calendar-${randomUUID()}`;
    this.database.prepare(`
      INSERT INTO calendar_events(
        region_id, tenant_id, external_event_id, appointment_id, employee_id, title,
        start_at, end_at, idempotency_key, cancelled
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
    `).run(
      this.region, command.tenantId, externalEventId, command.appointmentId, command.employeeId,
      command.title, command.startAt, command.endAt, command.idempotencyKey,
    );
    return success({ provider: "sqlite-local", externalEventId });
  }

  async cancelEvent(command: { tenantId: string; externalEventId: string }) {
    const result = this.database.prepare(`
      UPDATE calendar_events SET cancelled = 1
      WHERE region_id = ? AND tenant_id = ? AND external_event_id = ?
    `).run(this.region, command.tenantId, command.externalEventId);
    return result.changes > 0 ? success(undefined) : failure({ code: "EVENT_NOT_FOUND" as const });
  }
}

const validRange = (start: string, end: string): boolean => {
  const startDate = new Date(start);
  const endDate = new Date(end);
  return !Number.isNaN(startDate.valueOf()) && !Number.isNaN(endDate.valueOf()) && startDate < endDate;
};
