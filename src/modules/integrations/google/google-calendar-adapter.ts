import { createHash } from "node:crypto";
import { failure, success } from "../../../shared/domain/result.js";
import type { AppointmentCalendarError, AppointmentCalendarPort } from "../../appointments/index.js";
import type { BusyInterval, CalendarPort } from "../../scheduling/index.js";
import { dateTimeInTimezone } from "../../scheduling/domain/time.js";
import type { GoogleIntegrationStatus } from "./contracts.js";
import type { GoogleOAuthService } from "./google-oauth-service.js";

export class GoogleCalendarAdapter implements CalendarPort, AppointmentCalendarPort {
  constructor(
    private readonly calendarId: string,
    private readonly timeZone: string | ((tenantId: string) => string | Promise<string>),
    private readonly oauth: GoogleOAuthService,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  /**
   * Verifies the configured calendar with the same authenticated FreeBusy API
   * path that scheduling uses. A saved token alone is never treated as healthy.
   */
  async checkConnection(tenantId: string): Promise<GoogleIntegrationStatus> {
    const checkedAt = new Date().toISOString();
    const configured = await this.oauth.status(tenantId);
    if (!configured.configured) return { ...configured, connected: false, lastCheckedAt: checkedAt };

    const token = await this.tokenFor(tenantId);
    if (!token.ok) {
      const errorCode = token.error.code === "CALENDAR_NOT_CONNECTED"
        ? "CALENDAR_NOT_CONNECTED"
        : token.error.code === "AUTHORIZATION_REQUIRED"
          ? "AUTHORIZATION_REQUIRED"
          : "CALENDAR_API_UNAVAILABLE";
      googleLog("calendar.connection.failed", { tenantId, errorCode });
      return { configured: true, connected: false, calendarId: this.calendarId, lastCheckedAt: checkedAt, errorCode };
    }

    try {
      const now = new Date();
      const response = await this.fetcher(new URL("https://www.googleapis.com/calendar/v3/freeBusy"), {
        method: "POST",
        headers: { authorization: `Bearer ${token.value}`, "content-type": "application/json" },
        body: JSON.stringify({
          timeMin: now.toISOString(),
          timeMax: new Date(now.valueOf() + 60_000).toISOString(),
          items: [{ id: this.calendarId }],
        }),
      });
      if (!response.ok) {
        const errorCode = response.status === 401
          ? "AUTHORIZATION_REQUIRED"
          : response.status === 403 || response.status === 404
            ? "CALENDAR_PERMISSION_DENIED"
            : "CALENDAR_API_UNAVAILABLE";
        googleLog("calendar.connection.failed", { tenantId, httpStatus: response.status, errorCode });
        return { configured: true, connected: false, calendarId: this.calendarId, lastCheckedAt: checkedAt, errorCode };
      }
      const body = await response.json() as { calendars?: Record<string, { errors?: unknown[] }> };
      if (body.calendars?.[this.calendarId]?.errors?.length) {
        googleLog("calendar.connection.failed", { tenantId, errorCode: "CALENDAR_PERMISSION_DENIED" });
        return { configured: true, connected: false, calendarId: this.calendarId, lastCheckedAt: checkedAt, errorCode: "CALENDAR_PERMISSION_DENIED" };
      }
      googleLog("calendar.connection.completed", { tenantId });
      return { configured: true, connected: true, calendarId: this.calendarId, lastCheckedAt: checkedAt };
    } catch {
      googleLog("calendar.connection.failed", { tenantId, errorCode: "CALENDAR_API_UNAVAILABLE" });
      return { configured: true, connected: false, calendarId: this.calendarId, lastCheckedAt: checkedAt, errorCode: "CALENDAR_API_UNAVAILABLE" };
    }
  }

  async getBusyIntervals(query: { tenantId: string; employeeId: string; rangeStart: string; rangeEnd: string }) {
    const token = await this.tokenFor(query.tenantId);
    if (!token.ok) return token;
    try {
      const timeZone = await this.timeZoneFor(query.tenantId);
      googleLog("calendar.trace.google.availability.request", {
        tenantId: query.tenantId,
        clinicTimezone: timeZone,
        ...(process.env.YIBO_SCHEDULING_TRACE === "1" ? { calendarId: this.calendarId } : {}),
        rangeStart: traceDateTime(query.rangeStart, timeZone),
        rangeEnd: traceDateTime(query.rangeEnd, timeZone),
      });
      const response = await this.fetcher(new URL("https://www.googleapis.com/calendar/v3/freeBusy"), {
        method: "POST", headers: { authorization: `Bearer ${token.value}`, "content-type": "application/json" },
        body: JSON.stringify({ timeMin: query.rangeStart, timeMax: query.rangeEnd, timeZone, items: [{ id: this.calendarId }] }),
      });
      if (!response.ok) {
        const error = providerError(response.status);
        googleLog("calendar.availability.failed", { tenantId: query.tenantId, httpStatus: response.status, errorCode: error.code });
        return failure(error);
      }
      const body = await response.json() as { calendars?: Record<string, { busy?: Array<{ start: string; end: string }>; errors?: unknown[] }> };
      if (body.calendars?.[this.calendarId]?.errors?.length) {
        googleLog("calendar.availability.failed", { tenantId: query.tenantId, errorCode: "CALENDAR_PERMISSION_DENIED" });
        return failure({ code: "PROVIDER_UNAVAILABLE" as const, retryable: false });
      }
      const busy = body.calendars?.[this.calendarId]?.busy ?? [];
      googleLog("calendar.trace.google.availability.response", {
        tenantId: query.tenantId,
        busyIntervals: busy.map((interval) => ({
          startAt: traceDateTime(interval.start, timeZone), endAt: traceDateTime(interval.end, timeZone),
        })),
      });
      return success(busy.map(({ start, end }) => ({ startAt: start, endAt: end })) as BusyInterval[]);
    } catch (error) {
      googleLog("calendar.availability.failed", { tenantId: query.tenantId, errorCode: "CALENDAR_API_UNAVAILABLE", error: safeErrorMessage(error) });
      return failure({ code: "PROVIDER_UNAVAILABLE" as const, retryable: true });
    }
  }

  async createEvent(command: { tenantId: string; appointmentId: string; employeeId: string; title: string; serviceName: string; patient?: { name?: string; phone: string }; startAt: string; endAt: string; idempotencyKey: string }) {
    const token = await this.tokenFor(command.tenantId);
    if (!token.ok) return token;
    const externalEventId = googleEventId(command.tenantId, command.appointmentId);
    const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(this.calendarId)}/events`;
    try {
      const timeZone = await this.timeZoneFor(command.tenantId);
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
          summary: command.patient?.name ? `${command.serviceName} — ${command.patient.name}` : command.title,
          description: calendarDescription(command),
          // The appointment stores an instant in UTC. Supplying the clinic zone makes
          // the intended wall-clock time explicit to Google Calendar as well.
          start,
          end,
          extendedProperties: { private: { yiboAppointmentId: command.appointmentId, yiboTenantId: command.tenantId } },
        }),
      });
      if (response.status === 409) {
        // Duplicate ID is not proof of a successful retry. It could name an
        // unrelated event, a deleted event, or an appointment at another time.
        const existing = await this.readOwnedEvent({ ...command, externalEventId }, token.value);
        if (!existing.ok) return existing;
        if (!matchesTimes(existing.value, command)) return eventMismatch("The existing event has different appointment times.");
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

  async rescheduleEvent(command: Parameters<AppointmentCalendarPort["rescheduleEvent"]>[0]) {
    if (!validTimes(command)) return eventMismatch("A valid appointment time range is required.");
    const token = await this.tokenFor(command.tenantId);
    if (!token.ok) return token;
    try {
      const existing = await this.readOwnedEvent(command, token.value);
      if (!existing.ok) return existing;
      if (!existing.value.etag) return eventMismatch("The calendar event has no version identifier.");
      const timeZone = await this.timeZoneFor(command.tenantId);
      const response = await this.fetcher(this.eventUrl(command.externalEventId), {
        method: "PATCH",
        headers: { authorization: `Bearer ${token.value}`, "content-type": "application/json", "if-match": existing.value.etag },
        // Preserve event identity, attendees, reminders, notes, and other fields.
        body: JSON.stringify({ start: dateTimeInTimezone(new Date(command.startAt), timeZone), end: dateTimeInTimezone(new Date(command.endAt), timeZone) }),
      });
      if (!response.ok) return failure<AppointmentCalendarError>(eventOperationError(response.status));
      const updated = await response.json() as GoogleEvent;
      if (updated.id !== command.externalEventId || updated.status === "cancelled" || !matchesTimes(updated, command)) {
        return eventMismatch("The calendar did not return the expected rescheduled event.");
      }
      return success(undefined);
    } catch {
      return failure<AppointmentCalendarError>({ code: "PROVIDER_UNAVAILABLE", retryable: true });
    }
  }

  async cancelEvent(command: Parameters<AppointmentCalendarPort["cancelEvent"]>[0]) {
    const token = await this.tokenFor(command.tenantId);
    if (!token.ok) return token;
    try {
      const existing = await this.readOwnedEvent(command, token.value);
      if (!existing.ok) return existing;
      if (!existing.value.etag) return eventMismatch("The calendar event has no version identifier.");
      const response = await this.fetcher(this.eventUrl(command.externalEventId), {
        method: "DELETE", headers: { authorization: `Bearer ${token.value}`, "if-match": existing.value.etag },
      });
      if (!response.ok) return failure<AppointmentCalendarError>(eventOperationError(response.status));
      return success(undefined);
    } catch {
      return failure<AppointmentCalendarError>({ code: "PROVIDER_UNAVAILABLE", retryable: true });
    }
  }

  private eventUrl(externalEventId: string): string {
    return `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(this.calendarId)}/events/${encodeURIComponent(externalEventId)}`;
  }

  private async readOwnedEvent(command: { tenantId: string; appointmentId: string; externalEventId: string }, token: string) {
    const response = await this.fetcher(this.eventUrl(command.externalEventId), { headers: { authorization: `Bearer ${token}` } });
    if (!response.ok) return failure<AppointmentCalendarError>(eventOperationError(response.status));
    const event = await response.json() as GoogleEvent;
    if (event.status === "cancelled") return failure<AppointmentCalendarError>({ code: "EVENT_NOT_FOUND" });
    const identity = event.extendedProperties?.private;
    // Older YIBO events have only yiboAppointmentId. Preserve their persisted IDs
    // and accept that marker; new events additionally record the tenant.
    if (event.id !== command.externalEventId || identity?.yiboAppointmentId !== command.appointmentId
      || (identity.yiboTenantId !== undefined && identity.yiboTenantId !== command.tenantId)) {
      return eventMismatch("The calendar event does not belong to this appointment.");
    }
    return success(event);
  }

  private async timeZoneFor(tenantId: string): Promise<string> {
    return typeof this.timeZone === "string" ? this.timeZone : this.timeZone(tenantId);
  }

  private async tokenFor(tenantId: string) {
    const status = await this.oauth.status(tenantId);
    if (!status.configured || !status.connected) return failure({ code: "CALENDAR_NOT_CONNECTED" as const });
    const token = await this.oauth.accessTokenResult(tenantId);
    if (token.ok) return success(token.token);
    if (token.errorCode === "CALENDAR_API_UNAVAILABLE") {
      return failure({ code: "PROVIDER_UNAVAILABLE" as const, retryable: true });
    }
    return failure({ code: token.errorCode === "CALENDAR_NOT_CONNECTED" ? "CALENDAR_NOT_CONNECTED" as const : "AUTHORIZATION_REQUIRED" as const });
  }
}

// Full, unambiguous input; lowercase hexadecimal satisfies Google's base32hex
// event-ID alphabet. Existing appointments continue using their persisted IDs.
const googleEventId = (tenantId: string, appointmentId: string): string =>
  `a${createHash("sha256").update(JSON.stringify([tenantId, appointmentId])).digest("hex")}`;

interface GoogleEvent {
  id?: string;
  etag?: string;
  status?: string;
  start?: { dateTime?: string };
  end?: { dateTime?: string };
  extendedProperties?: { private?: { yiboAppointmentId?: string; yiboTenantId?: string } };
}
const validTimes = (command: { startAt: string; endAt: string }): boolean =>
  Number.isFinite(Date.parse(command.startAt)) && Number.isFinite(Date.parse(command.endAt)) && Date.parse(command.startAt) < Date.parse(command.endAt);
const matchesTimes = (event: GoogleEvent, command: { startAt: string; endAt: string }): boolean =>
  Date.parse(event.start?.dateTime ?? "") === Date.parse(command.startAt) && Date.parse(event.end?.dateTime ?? "") === Date.parse(command.endAt);
const eventMismatch = (message: string) => failure<AppointmentCalendarError>({ code: "VALIDATION_ERROR", message });
const eventOperationError = (status: number): AppointmentCalendarError => {
  if (status === 404 || status === 410) return { code: "EVENT_NOT_FOUND" };
  if (status === 412) return { code: "VALIDATION_ERROR", message: "The calendar event changed during this operation. Check it again before retrying." };
  return providerError(status);
};

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
