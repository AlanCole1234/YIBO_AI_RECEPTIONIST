import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { createApiServer } from "../../src/api/index.js";
import type { YiboApplication } from "../../src/bootstrap/index.js";

let server: FastifyInstance | undefined;
afterEach(async () => { await server?.close(); server = undefined; });

describe("Google Calendar OAuth callback", () => {
  it("returns the real calendar health instead of treating a saved token as Connected", async () => {
    const checkConnection = async () => ({
      configured: true,
      connected: false,
      calendarId: "clinic@example.com",
      lastCheckedAt: "2026-09-08T12:00:00.000Z",
      errorCode: "AUTHORIZATION_REQUIRED" as const,
    });
    server = await createApiServer({
      tenantId: "tenant-1",
      googleOAuth: { status: async () => ({ configured: true, connected: true }) },
      calendar: { checkConnection },
    } as unknown as YiboApplication);

    const status = await server.inject({ method: "GET", url: "/api/integrations/google/status" });

    expect(status.statusCode).toBe(200);
    expect(status.json()).toMatchObject({ connected: false, errorCode: "AUTHORIZATION_REQUIRED" });
  });

  it("returns the browser to the dashboard origin that started authorization", async () => {
    const googleOAuth = {
      authorizationUrl: (_tenantId: string, returnTo: string) => `https://accounts.google.com/o/oauth2/v2/auth?returnTo=${encodeURIComponent(returnTo)}`,
      completeAuthorization: async () => ({ tenantId: "tenant-1", returnTo: "http://127.0.0.1:5174" }),
      returnToForState: () => "http://127.0.0.1:5174",
    };
    server = await createApiServer({ tenantId: "tenant-1", googleOAuth } as unknown as YiboApplication);

    const connect = await server.inject({ method: "GET", url: "/api/integrations/google/connect?returnTo=http%3A%2F%2F127.0.0.1%3A5174" });
    expect(connect.statusCode).toBe(200);
    expect(connect.json()).toEqual({ url: "https://accounts.google.com/o/oauth2/v2/auth?returnTo=http%3A%2F%2F127.0.0.1%3A5174" });

    const callback = await server.inject({ method: "GET", url: "/api/integrations/google/callback?code=one-time-code&state=signed-state" });
    expect(callback.statusCode).toBe(302);
    expect(callback.headers.location).toBe("http://127.0.0.1:5174/?calendar=connected");
  });
});
