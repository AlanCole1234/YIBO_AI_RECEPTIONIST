import { failure, success } from "../../../shared/domain/result.js";
import type {
  AppointmentCalendarError,
  AppointmentCalendarPort,
} from "../ports/appointment-dependencies.js";

export class InMemoryAppointmentCalendar implements AppointmentCalendarPort {
  private readonly events = new Map<string, { idempotencyKey: string }>();
  private nextFailure?: AppointmentCalendarError;

  failNext(error: AppointmentCalendarError): void {
    this.nextFailure = error;
  }

  async createEvent(command: Parameters<AppointmentCalendarPort["createEvent"]>[0]) {
    const error = this.consumeFailure();
    if (error) return failure<AppointmentCalendarError>(error);
    const existing = [...this.events.entries()].find(([, event]) => event.idempotencyKey === command.idempotencyKey);
    const externalEventId = existing?.[0] ?? `event-${this.events.size + 1}`;
    this.events.set(externalEventId, { idempotencyKey: command.idempotencyKey });
    return success({ provider: "memory", externalEventId });
  }

  async cancelEvent(command: Parameters<AppointmentCalendarPort["cancelEvent"]>[0]) {
    const error = this.consumeFailure();
    if (error) return failure<AppointmentCalendarError>(error);
    if (!this.events.delete(command.externalEventId)) {
      return failure<AppointmentCalendarError>({ code: "EVENT_NOT_FOUND" });
    }
    return success(undefined);
  }

  private consumeFailure(): AppointmentCalendarError | undefined {
    const error = this.nextFailure;
    this.nextFailure = undefined;
    return error;
  }
}
