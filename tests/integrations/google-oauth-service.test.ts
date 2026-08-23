import { describe, expect, it } from "vitest";
import { GoogleOAuthService, type GoogleToken, type GoogleTokenStore } from "../../src/modules/integrations/index.js";

class MemoryTokenStore implements GoogleTokenStore {
  value: GoogleToken | null = null;
  async get(): Promise<GoogleToken | null> { return this.value; }
  async save(_tenantId: string, token: GoogleToken): Promise<void> { this.value = token; }
}

const config = { clientId: "client-id", clientSecret: "client-secret", redirectUri: "http://localhost:3000/api/integrations/google/callback", calendarId: "calendar@example.com" };

describe("GoogleOAuthService", () => {
  it("creates an authorization URL with a short-lived state and exchanges the matching callback", async () => {
    const tokens = new MemoryTokenStore();
    const fetcher: typeof fetch = async () => new Response(JSON.stringify({ access_token: "access", refresh_token: "refresh", expires_in: 3600 }), { status: 200 });
    const service = new GoogleOAuthService(config, tokens, fetcher);
    const url = service.authorizationUrl("tenant-1");
    if (!url) throw new Error("Expected configured OAuth URL");
    const state = new URL(url).searchParams.get("state");
    if (!state) throw new Error("Expected state");
    expect(new URL(url).searchParams.get("scope")).toContain("calendar.events.freebusy");

    await expect(service.completeAuthorization("code", state)).resolves.toEqual({ tenantId: "tenant-1" });
    await expect(service.status("tenant-1")).resolves.toMatchObject({ configured: true, connected: true });
  });

  it("rejects a callback whose state was never issued", async () => {
    const service = new GoogleOAuthService(config, new MemoryTokenStore());
    await expect(service.completeAuthorization("code", "untrusted-state")).resolves.toBeNull();
  });

  it("refreshes an expired access token without exposing the refresh token", async () => {
    const tokens = new MemoryTokenStore();
    tokens.value = { accessToken: "expired", refreshToken: "refresh", expiresAt: "2020-01-01T00:00:00.000Z" };
    const fetcher: typeof fetch = async () => new Response(JSON.stringify({ access_token: "fresh", expires_in: 3600 }), { status: 200 });
    const service = new GoogleOAuthService(config, tokens, fetcher);
    await expect(service.accessToken("tenant-1")).resolves.toBe("fresh");
    expect(tokens.value).toMatchObject({ accessToken: "fresh", refreshToken: "refresh" });
  });
});
