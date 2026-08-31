import { describe, expect, it, vi } from "vitest";
import { GoogleCalendarAdapter, type GoogleOAuthService } from "../../src/modules/integrations/index.js";

describe("GoogleCalendarAdapter", () => {
  it("uses Google's FreeBusy endpoint with the configured calendar ID in the request body", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({
      calendars: { "yibo-test@example.com": { busy: [{ start: "2026-08-24T15:00:00.000Z", end: "2026-08-24T15:30:00.000Z" }] } },
    }), { status: 200 }));
    const oauth = { status: async () => ({ configured: true, connected: true }), accessToken: async () => "test-access-token" } as unknown as GoogleOAuthService;
    const adapter = new GoogleCalendarAdapter("yibo-test@example.com", "America/Chicago", oauth, fetcher);

    await expect(adapter.getBusyIntervals({
      tenantId: "tenant-1", employeeId: "employee-1", rangeStart: "2026-08-24T00:00:00.000Z", rangeEnd: "2026-08-25T00:00:00.000Z",
    })).resolves.toEqual({ ok: true, value: [{ startAt: "2026-08-24T15:00:00.000Z", endAt: "2026-08-24T15:30:00.000Z" }] });
    expect(fetcher).toHaveBeenCalledWith(new URL("https://www.googleapis.com/calendar/v3/freeBusy"), expect.objectContaining({
      method: "POST", body: expect.stringContaining("yibo-test@example.com"),
    }));
  });

  it("writes an 11:00 AM Chicago appointment as 11:00 AM Central in Google Calendar", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ id: "event-1" }), { status: 200 }));
    const oauth = { status: async () => ({ configured: true, connected: true }), accessToken: async () => "test-access-token" } as unknown as GoogleOAuthService;
    const adapter = new GoogleCalendarAdapter("yibo-test@example.com", "America/Chicago", oauth, fetcher);

    await expect(adapter.createEvent({
      tenantId: "tenant-1", appointmentId: "appointment-1", employeeId: "employee-1", title: "Consultation",
      startAt: "2026-08-24T16:00:00.000Z", endAt: "2026-08-24T16:30:00.000Z", idempotencyKey: "request-1",
    })).resolves.toEqual({ ok: true, value: { provider: "google-calendar", externalEventId: "event-1" } });

    const request = fetcher.mock.calls[0]?.[1];
    expect(JSON.parse(String(request?.body))).toMatchObject({
      start: { dateTime: "2026-08-24T11:00:00-05:00", timeZone: "America/Chicago" },
      end: { dateTime: "2026-08-24T11:30:00-05:00", timeZone: "America/Chicago" },
    });
  });

  it("uses each business's selected timezone when writing the same local appointment time", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ id: "event-1" }), { status: 200 }));
    const oauth = { status: async () => ({ configured: true, connected: true }), accessToken: async () => "test-access-token" } as unknown as GoogleOAuthService;
    const zones: Record<string, string> = { central: "America/Chicago", mountain: "America/Denver" };
    const adapter = new GoogleCalendarAdapter("yibo-test@example.com", (tenantId) => zones[tenantId]!, oauth, fetcher);

    await adapter.createEvent({ tenantId: "central", appointmentId: "central-1", employeeId: "employee-1", title: "Consultation", startAt: "2026-08-24T16:00:00.000Z", endAt: "2026-08-24T16:30:00.000Z", idempotencyKey: "central-1" });
    await adapter.createEvent({ tenantId: "mountain", appointmentId: "mountain-1", employeeId: "employee-1", title: "Consultation", startAt: "2026-08-24T17:00:00.000Z", endAt: "2026-08-24T17:30:00.000Z", idempotencyKey: "mountain-1" });

    const central = JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body));
    const mountain = JSON.parse(String(fetcher.mock.calls[1]?.[1]?.body));
    expect(central.start).toEqual({ dateTime: "2026-08-24T11:00:00-05:00", timeZone: "America/Chicago" });
    expect(mountain.start).toEqual({ dateTime: "2026-08-24T11:00:00-06:00", timeZone: "America/Denver" });
  });

  it("distinguishes an unconnected calendar, expired authorization, and a Google API failure", async () => {
    const disconnected = new GoogleCalendarAdapter("calendar@example.com", "America/Denver", {
      status: async () => ({ configured: true, connected: false }), accessToken: async () => null,
    } as unknown as GoogleOAuthService);
    await expect(disconnected.getBusyIntervals({ tenantId: "tenant-1", employeeId: "employee-1", rangeStart: "2026-08-24T00:00:00.000Z", rangeEnd: "2026-08-25T00:00:00.000Z" }))
      .resolves.toEqual({ ok: false, error: { code: "CALENDAR_NOT_CONNECTED" } });

    const expired = new GoogleCalendarAdapter("calendar@example.com", "America/Denver", {
      status: async () => ({ configured: true, connected: true }), accessToken: async () => null,
    } as unknown as GoogleOAuthService);
    await expect(expired.getBusyIntervals({ tenantId: "tenant-1", employeeId: "employee-1", rangeStart: "2026-08-24T00:00:00.000Z", rangeEnd: "2026-08-25T00:00:00.000Z" }))
      .resolves.toEqual({ ok: false, error: { code: "AUTHORIZATION_REQUIRED" } });
  });
});
