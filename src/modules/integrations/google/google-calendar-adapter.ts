import { failure, success } from "../../../shared/domain/result.js";
import type { AppointmentCalendarPort } from "../../appointments/index.js";
import type { BusyInterval, CalendarPort } from "../../scheduling/index.js";
import type { GoogleOAuthService } from "./google-oauth-service.js";

export class GoogleCalendarAdapter implements CalendarPort, AppointmentCalendarPort {
  constructor(
    private readonly calendarId: string,
    private readonly timeZoneForTenant: string | ((tenantId: string) => Promise<string>),
    private readonly oauth: GoogleOAuthService,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  async getBusyIntervals(query: { tenantId: string; employeeId: string; rangeStart: string; rangeEnd: string }) {
    const token = await this.oauth.accessToken(query.tenantId);
    if (!token) return failure({ code: "AUTHORIZATION_REQUIRED" as const });
    const timeZone = await this.timeZone(query.tenantId);
    const url = new URL("https://www.googleapis.com/calendar/v3/freeBusy");
    const response = await this.fetcher(url, {
      method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ timeMin: query.rangeStart, timeMax: query.rangeEnd, timeZone, items: [{ id: this.calendarId }] }),
    });
    if (!response.ok) return failure(providerError(response.status));
    const body = await response.json() as { calendars?: Record<string, { busy?: Array<{ start: string; end: string }> }> };
    const busy = body.calendars?.[this.calendarId]?.busy ?? [];
    return success(busy.map(({ start, end }) => ({ startAt: start, endAt: end })) as BusyInterval[]);
  }

  async createEvent(command: { tenantId: string; appointmentId: string; employeeId: string; title: string; startAt: string; endAt: string; idempotencyKey: string }) {
    const token = await this.oauth.accessToken(command.tenantId);
    if (!token) return failure({ code: "AUTHORIZATION_REQUIRED" as const });
    const timeZone = await this.timeZone(command.tenantId);
    const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(this.calendarId)}/events`;
    const response = await this.fetcher(url, {
      method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json", "x-goog-request-id": command.idempotencyKey },
      body: JSON.stringify({
        summary: command.title,
        // The appointment stores an instant in UTC. Supplying the clinic zone makes
        // the intended wall-clock time explicit to Google Calendar as well.
        start: googleEventDateTime(command.startAt, timeZone),
        end: googleEventDateTime(command.endAt, timeZone),
        extendedProperties: { private: { yiboAppointmentId: command.appointmentId } },
      }),
    });
    if (!response.ok) return failure(providerError(response.status));
    const body = await response.json() as { id?: string };
    if (!body.id) return failure({ code: "VALIDATION_ERROR" as const, message: "Google Calendar did not return an event ID." });
    return success({ provider: "google-calendar", externalEventId: body.id });
  }

  async cancelEvent(command: { tenantId: string; externalEventId: string }) {
    const token = await this.oauth.accessToken(command.tenantId);
    if (!token) return failure({ code: "AUTHORIZATION_REQUIRED" as const });
    const response = await this.fetcher(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(this.calendarId)}/events/${encodeURIComponent(command.externalEventId)}`, { method: "DELETE", headers: { authorization: `Bearer ${token}` } });
    if (response.status === 404) return failure({ code: "EVENT_NOT_FOUND" as const });
    if (!response.ok) return failure(providerError(response.status));
    return success(undefined);
  }

  private async timeZone(tenantId: string): Promise<string> {
    return typeof this.timeZoneForTenant === "string"
      ? this.timeZoneForTenant
      : this.timeZoneForTenant(tenantId);
  }
}

const googleEventDateTime = (value: string, timeZone: string): { dateTime: string; timeZone: string } => {
  const instant = new Date(value);
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const parts = formatter.formatToParts(instant);
  const part = (type: Intl.DateTimeFormatPartTypes): number => Number(parts.find((item) => item.type === type)?.value);
  const year = part("year");
  const month = part("month");
  const day = part("day");
  const hour = part("hour");
  const minute = part("minute");
  const second = part("second");
  const offsetMinutes = Math.round((Date.UTC(year, month - 1, day, hour, minute, second) - instant.valueOf()) / 60_000);
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const absoluteOffset = Math.abs(offsetMinutes);
  const offset = `${String(Math.floor(absoluteOffset / 60)).padStart(2, "0")}:${String(absoluteOffset % 60).padStart(2, "0")}`;
  const dateTime = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:${String(second).padStart(2, "0")}${sign}${offset}`;
  return { dateTime, timeZone };
};

const providerError = (status: number) => {
  if (status === 401 || status === 403) return { code: "AUTHORIZATION_REQUIRED" as const };
  if (status === 429) return { code: "RATE_LIMITED" as const };
  return { code: "PROVIDER_UNAVAILABLE" as const, retryable: status >= 500 };
};
