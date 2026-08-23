import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { createApiServer } from "../../src/api/index.js";
import type { YiboApplication } from "../../src/app/index.js";

let server: FastifyInstance | undefined;
afterEach(async () => { await server?.close(); server = undefined; });

describe("Google Calendar OAuth callback", () => {
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
