import { failure, success } from "../../../shared/domain/result.js";
import type {
  AppointmentCalendarError,
  AppointmentCalendarPort,
} from "../ports/appointment-dependencies.js";

export class InMemoryAppointmentCalendar implements AppointmentCalendarPort {
  private readonly events = new Map<string, Parameters<AppointmentCalendarPort["createEvent"]>[0]>();
  private nextEventId = 1;
  private nextFailure?: AppointmentCalendarError;

  failNext(error: AppointmentCalendarError): void {
    this.nextFailure = error;
  }

  eventCount(): number {
    return this.events.size;
  }

  async createEvent(command: Parameters<AppointmentCalendarPort["createEvent"]>[0]) {
    const error = this.consumeFailure();
    if (error) return failure<AppointmentCalendarError>(error);
    const existing = [...this.events.entries()].find(([, event]) => event.tenantId === command.tenantId && event.idempotencyKey === command.idempotencyKey);
    const externalEventId = existing?.[0] ?? `event-${this.nextEventId++}`;
    this.events.set(externalEventId, { ...command });
    return success({ provider: "memory", externalEventId });
  }

  async rescheduleEvent(command: Parameters<AppointmentCalendarPort["rescheduleEvent"]>[0]) {
    const error = this.consumeFailure();
    if (error) return failure<AppointmentCalendarError>(error);
    const event = this.events.get(command.externalEventId);
    if (!event || event.tenantId !== command.tenantId || event.appointmentId !== command.appointmentId) {
      return failure<AppointmentCalendarError>({ code: "EVENT_NOT_FOUND" });
    }
    this.events.set(command.externalEventId, { ...event, startAt: command.startAt, endAt: command.endAt });
    return success(undefined);
  }

  async cancelEvent(command: Parameters<AppointmentCalendarPort["cancelEvent"]>[0]) {
    const error = this.consumeFailure();
    if (error) return failure<AppointmentCalendarError>(error);
    const event = this.events.get(command.externalEventId);
    if (!event || event.tenantId !== command.tenantId || event.appointmentId !== command.appointmentId) {
      return failure<AppointmentCalendarError>({ code: "EVENT_NOT_FOUND" });
    }
    this.events.delete(command.externalEventId);
    return success(undefined);
  }

  private consumeFailure(): AppointmentCalendarError | undefined {
    const error = this.nextFailure;
    this.nextFailure = undefined;
    return error;
  }
}
