import { failure, success } from "../../../shared/domain/result.js";
import type { AppointmentCalendarPort } from "../../appointments/index.js";
import type { BusyInterval, CalendarPort } from "../../scheduling/index.js";
import { dateTimeInTimezone } from "../../scheduling/domain/time.js";
import type { GoogleOAuthService } from "./google-oauth-service.js";
import type { CalendarAssignmentResolver } from "../calendar/calendar-assignment-resolver.js";

export class GoogleCalendarAdapter implements CalendarPort, AppointmentCalendarPort {
  constructor(
    private readonly calendars: CalendarAssignmentResolver,
    private readonly oauth: GoogleOAuthService,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  async getBusyIntervals(query: { tenantId: string; locationId: string; employeeId: string; rangeStart: string; rangeEnd: string }) {
    const assignment = await this.calendars.resolve(query);
    if (!assignment.ok) return failure({ code: "CALENDAR_NOT_CONNECTED" as const });
    const token = await this.tokenFor(query.tenantId);
    if (!token.ok) return token;
    try {
      const { calendarId, timezone: timeZone } = assignment.value;
      googleLog("calendar.trace.google.availability.request", {
        tenantId: query.tenantId,
        clinicTimezone: timeZone,
        rangeStart: traceDateTime(query.rangeStart, timeZone),
        rangeEnd: traceDateTime(query.rangeEnd, timeZone),
      });
      const response = await this.fetcher(new URL("https://www.googleapis.com/calendar/v3/freeBusy"), {
        method: "POST", headers: { authorization: `Bearer ${token.value}`, "content-type": "application/json" },
        body: JSON.stringify({ timeMin: query.rangeStart, timeMax: query.rangeEnd, timeZone, items: [{ id: calendarId }] }),
      });
      if (!response.ok) return failure(providerError(response.status));
      const body = await response.json() as { calendars?: Record<string, { busy?: Array<{ start: string; end: string }>; errors?: unknown[] }> };
      if (body.calendars?.[calendarId]?.errors?.length) return failure({ code: "PROVIDER_UNAVAILABLE" as const, retryable: false });
      const busy = body.calendars?.[calendarId]?.busy ?? [];
      googleLog("calendar.trace.google.availability.response", {
        tenantId: query.tenantId,
        busyIntervals: busy.map((interval) => ({
          startAt: traceDateTime(interval.start, timeZone), endAt: traceDateTime(interval.end, timeZone),
        })),
      });
      return success(busy.map(({ start, end }) => ({ startAt: start, endAt: end })) as BusyInterval[]);
    } catch { return failure({ code: "PROVIDER_UNAVAILABLE" as const, retryable: true }); }
  }

  async createEvent(command: { tenantId: string; locationId: string; appointmentId: string; employeeId: string; title: string; serviceName: string; patient?: { name?: string; phone: string }; startAt: string; endAt: string; idempotencyKey: string }) {
    const assignment = await this.calendars.resolve(command);
    if (!assignment.ok) return failure({ code: "CALENDAR_NOT_CONNECTED" as const });
    const token = await this.tokenFor(command.tenantId);
    if (!token.ok) return token;
    const externalEventId = googleEventId(command.appointmentId);
    const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(assignment.value.calendarId)}/events`;
    try {
      const timeZone = assignment.value.timezone;
      const start = dateTimeInTimezone(new Date(command.startAt), timeZone);
      const end = dateTimeInTimezone(new Date(command.endAt), timeZone);
      googleLog("calendar.trace.google.adapter.input", {
        tenantId: command.tenantId,
        appointmentId: command.appointmentId,
        clinicTimezone: timeZone,
        startAt: traceDateTime(command.startAt, timeZone),
        endAt: traceDateTime(command.endAt, timeZone),
      });
      googleLog("calendar.google.event.creating", {
        tenantId: command.tenantId,
        appointmentId: command.appointmentId,
        clinicTimezone: timeZone,
        normalizedLocalDateTime: start.dateTime,
        googleCalendarStart: start.dateTime,
        googleCalendarTimezone: timeZone,
        googleCalendarEnd: end.dateTime,
      });
      const response = await this.fetcher(url, {
        method: "POST", headers: { authorization: `Bearer ${token.value}`, "content-type": "application/json", "x-goog-request-id": command.idempotencyKey },
        body: JSON.stringify({
          id: externalEventId,
          // Test appointments are intentionally recognizable in a connected calendar.
          // Normal patient appointments retain their existing, patient-friendly title.
          summary: command.title.startsWith("[YIBO TEST]")
            ? command.title
            : command.patient?.name ? `${command.serviceName} — ${command.patient.name}` : command.title,
          description: calendarDescription(command),
          // The appointment stores an instant in UTC. Supplying the clinic zone makes
          // the intended wall-clock time explicit to Google Calendar as well.
          start,
          end,
          extendedProperties: { private: { yiboAppointmentId: command.appointmentId } },
        }),
      });
      if (response.status === 409) {
        googleLog("calendar.google.event.created", { tenantId: command.tenantId, appointmentId: command.appointmentId, externalEventId, duplicate: true });
        return success({ provider: "google-calendar", externalEventId });
      }
      if (!response.ok) {
        googleLog("calendar.google.event.failed", { tenantId: command.tenantId, appointmentId: command.appointmentId, httpStatus: response.status, error: await responseError(response) });
        return failure(providerError(response.status));
      }
      const body = await response.json() as { id?: string };
      if (!body.id) {
        googleLog("calendar.google.event.failed", { tenantId: command.tenantId, appointmentId: command.appointmentId, error: "Google Calendar did not return an event ID" });
        return failure({ code: "VALIDATION_ERROR" as const, message: "Google Calendar did not return an event ID." });
      }
      googleLog("calendar.google.event.created", {
        tenantId: command.tenantId,
        appointmentId: command.appointmentId,
        externalEventId: body.id,
        returnedStart: typeof (body as { start?: unknown }).start === "object" ? (body as { start?: unknown }).start : undefined,
        returnedEnd: typeof (body as { end?: unknown }).end === "object" ? (body as { end?: unknown }).end : undefined,
      });
      return success({ provider: "google-calendar", externalEventId: body.id });
    } catch (error) {
      googleLog("calendar.google.event.failed", { tenantId: command.tenantId, appointmentId: command.appointmentId, error: safeErrorMessage(error) });
      return failure({ code: "PROVIDER_UNAVAILABLE" as const, retryable: true });
    }
  }

  async cancelEvent(command: { tenantId: string; locationId: string; employeeId: string; externalEventId: string }) {
    const assignment = await this.calendars.resolve(command);
    if (!assignment.ok) return failure({ code: "CALENDAR_NOT_CONNECTED" as const });
    const token = await this.oauth.accessToken(command.tenantId);
    if (!token) return failure({ code: "AUTHORIZATION_REQUIRED" as const });
    const response = await this.fetcher(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(assignment.value.calendarId)}/events/${encodeURIComponent(command.externalEventId)}`, { method: "DELETE", headers: { authorization: `Bearer ${token}` } });
    if (response.status === 404) return failure({ code: "EVENT_NOT_FOUND" as const });
    if (!response.ok) return failure(providerError(response.status));
    return success(undefined);
  }

  private async tokenFor(tenantId: string) {
    const status = await this.oauth.status(tenantId);
    if (!status.configured || !status.connected) return failure({ code: "CALENDAR_NOT_CONNECTED" as const });
    const token = await this.oauth.accessToken(tenantId);
    return token ? success(token) : failure({ code: "AUTHORIZATION_REQUIRED" as const });
  }
}

const googleEventId = (appointmentId: string): string => `a${appointmentId.replace(/[^0-9a-f]/gi, "").toLowerCase()}`;

const providerError = (status: number) => {
  if (status === 401 || status === 403) return { code: "AUTHORIZATION_REQUIRED" as const };
  if (status === 429) return { code: "RATE_LIMITED" as const };
  return { code: "PROVIDER_UNAVAILABLE" as const, retryable: status >= 500 };
};

const calendarDescription = (command: { serviceName: string; patient?: { phone: string } }): string => [
  `Service: ${command.serviceName}`,
  ...(command.patient?.phone ? [`Phone: ${maskPhone(command.patient.phone)}`] : []),
].join("\n");

const maskPhone = (phone: string): string => {
  const digits = phone.replace(/\D/g, "");
  return digits.length >= 4 ? `***${digits.slice(-4)}` : "***";
};

const responseError = async (response: Response): Promise<string> => {
  try {
    const body = await response.json() as { error?: { message?: unknown } };
    return typeof body.error?.message === "string" ? body.error.message.slice(0, 300) : `Google Calendar HTTP ${response.status}`;
  } catch {
    return `Google Calendar HTTP ${response.status}`;
  }
};

const safeErrorMessage = (error: unknown): string => error instanceof Error ? error.message.slice(0, 300) : "Unexpected Google Calendar request error";
const googleLog = (event: string, metadata: Record<string, unknown>): void => console.log(JSON.stringify({ event, ...metadata }));

const traceDateTime = (value: string, timeZone: string) => {
  const instant = new Date(value);
  return Number.isNaN(instant.valueOf())
    ? { input: value, invalid: true }
    : { input: value, iso: instant.toISOString(), ...dateTimeInTimezone(instant, timeZone) };
};
