import { failure, success } from "../../../shared/domain/result.js";
import type { AppointmentCalendarPort } from "../../appointments/index.js";
import type { BusyInterval, CalendarPort } from "../../scheduling/index.js";
import type { GoogleOAuthService } from "./google-oauth-service.js";

export class GoogleCalendarAdapter implements CalendarPort, AppointmentCalendarPort {
  constructor(private readonly calendarId: string, private readonly oauth: GoogleOAuthService, private readonly fetcher: typeof fetch = fetch) {}

  async getBusyIntervals(query: { tenantId: string; employeeId: string; rangeStart: string; rangeEnd: string }) {
    const token = await this.oauth.accessToken(query.tenantId);
    if (!token) return failure({ code: "AUTHORIZATION_REQUIRED" as const });
    const url = new URL(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(this.calendarId)}/freeBusy`);
    const response = await this.fetcher(url, {
      method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ timeMin: query.rangeStart, timeMax: query.rangeEnd, items: [{ id: this.calendarId }] }),
    });
    if (!response.ok) return failure(providerError(response.status));
    const body = await response.json() as { calendars?: Record<string, { busy?: Array<{ start: string; end: string }> }> };
    const busy = body.calendars?.[this.calendarId]?.busy ?? [];
    return success(busy.map(({ start, end }) => ({ startAt: start, endAt: end })) as BusyInterval[]);
  }

  async createEvent(command: { tenantId: string; appointmentId: string; employeeId: string; title: string; startAt: string; endAt: string; idempotencyKey: string }) {
    const token = await this.oauth.accessToken(command.tenantId);
    if (!token) return failure({ code: "AUTHORIZATION_REQUIRED" as const });
    const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(this.calendarId)}/events`;
    const response = await this.fetcher(url, {
      method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json", "x-goog-request-id": command.idempotencyKey },
      body: JSON.stringify({ summary: command.title, start: { dateTime: command.startAt }, end: { dateTime: command.endAt }, extendedProperties: { private: { yiboAppointmentId: command.appointmentId } } }),
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
}

const providerError = (status: number) => {
  if (status === 401 || status === 403) return { code: "AUTHORIZATION_REQUIRED" as const };
  if (status === 429) return { code: "RATE_LIMITED" as const };
  return { code: "PROVIDER_UNAVAILABLE" as const, retryable: status >= 500 };
};
