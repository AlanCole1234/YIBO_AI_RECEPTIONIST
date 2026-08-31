import { failure, success } from "../../../shared/domain/result.js";
import type { AppointmentCalendarPort } from "../../appointments/index.js";
import type { BusyInterval, CalendarPort } from "../../scheduling/index.js";
import type { GoogleOAuthService } from "./google-oauth-service.js";

export class GoogleCalendarAdapter implements CalendarPort, AppointmentCalendarPort {
  constructor(
    private readonly calendarId: string,
    private readonly timeZone: string | ((tenantId: string) => string | Promise<string>),
    private readonly oauth: GoogleOAuthService,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  async getBusyIntervals(query: { tenantId: string; employeeId: string; rangeStart: string; rangeEnd: string }) {
    const token = await this.tokenFor(query.tenantId);
    if (!token.ok) return token;
    try {
      const timeZone = await this.timeZoneFor(query.tenantId);
      const response = await this.fetcher(new URL("https://www.googleapis.com/calendar/v3/freeBusy"), {
        method: "POST", headers: { authorization: `Bearer ${token.value}`, "content-type": "application/json" },
        body: JSON.stringify({ timeMin: query.rangeStart, timeMax: query.rangeEnd, timeZone, items: [{ id: this.calendarId }] }),
      });
      if (!response.ok) return failure(providerError(response.status));
      const body = await response.json() as { calendars?: Record<string, { busy?: Array<{ start: string; end: string }>; errors?: unknown[] }> };
      if (body.calendars?.[this.calendarId]?.errors?.length) return failure({ code: "PROVIDER_UNAVAILABLE" as const, retryable: false });
      const busy = body.calendars?.[this.calendarId]?.busy ?? [];
      return success(busy.map(({ start, end }) => ({ startAt: start, endAt: end })) as BusyInterval[]);
    } catch { return failure({ code: "PROVIDER_UNAVAILABLE" as const, retryable: true }); }
  }

  async createEvent(command: { tenantId: string; appointmentId: string; employeeId: string; title: string; startAt: string; endAt: string; idempotencyKey: string }) {
    const token = await this.tokenFor(command.tenantId);
    if (!token.ok) return token;
    const externalEventId = googleEventId(command.appointmentId);
    const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(this.calendarId)}/events`;
    const response = await this.fetcher(url, {
      method: "POST", headers: { authorization: `Bearer ${token.value}`, "content-type": "application/json", "x-goog-request-id": command.idempotencyKey },
      body: JSON.stringify({
        id: externalEventId,
        summary: command.title,
        // The appointment stores an instant in UTC. Supplying the clinic zone makes
        // the intended wall-clock time explicit to Google Calendar as well.
        start: googleEventDateTime(command.startAt, await this.timeZoneFor(command.tenantId)),
        end: googleEventDateTime(command.endAt, await this.timeZoneFor(command.tenantId)),
        extendedProperties: { private: { yiboAppointmentId: command.appointmentId } },
      }),
    });
    if (response.status === 409) return success({ provider: "google-calendar", externalEventId });
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

  private async timeZoneFor(tenantId: string): Promise<string> {
    return typeof this.timeZone === "string" ? this.timeZone : this.timeZone(tenantId);
  }

  private async tokenFor(tenantId: string) {
    const status = await this.oauth.status(tenantId);
    if (!status.configured || !status.connected) return failure({ code: "CALENDAR_NOT_CONNECTED" as const });
    const token = await this.oauth.accessToken(tenantId);
    return token ? success(token) : failure({ code: "AUTHORIZATION_REQUIRED" as const });
  }
}

const googleEventId = (appointmentId: string): string => `a${appointmentId.replace(/[^0-9a-f]/gi, "").toLowerCase()}`;

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
