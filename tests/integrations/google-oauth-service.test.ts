import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { GoogleOAuthService, type GoogleToken, type GoogleTokenStore } from "../../src/modules/integrations/index.js";

class MemoryTokenStore implements GoogleTokenStore {
  value: GoogleToken | null = null;
  async get(): Promise<GoogleToken | null> { return this.value; }
  async save(_tenantId: string, token: GoogleToken): Promise<void> { this.value = token; }
}

const config = { clientId: "client-id", clientSecret: "client-secret", redirectUri: "http://localhost:3000/api/integrations/google/callback", stateSigningKey: "a".repeat(64) };
const hostedOrigin = "https://dashboard.example.test";
const signedState = (returnTo: string, expiresAt = Date.now() + 60_000): string => {
  const payload = Buffer.from(JSON.stringify({ tenantId: "tenant-1", returnTo, expiresAt, nonce: "synthetic-nonce" })).toString("base64url");
  return `${payload}.${createHmac("sha256", config.stateSigningKey).update(payload).digest("base64url")}`;
};

describe("GoogleOAuthService", () => {
  it("accepts the configured HTTPS dashboard when reading and completing signed state", async () => {
    const dashboardOrigin = "https://dashboard.example.test";
    const service = new GoogleOAuthService({ ...config, dashboardOrigin }, new MemoryTokenStore(),
      async () => new Response(JSON.stringify({ access_token: "synthetic-access", refresh_token: "synthetic-refresh" })));
    const url = new URL(service.authorizationUrl("tenant-1", dashboardOrigin)!);
    const state = url.searchParams.get("state")!;
    expect(service.returnToForState(state)).toBe(dashboardOrigin);
    await expect(service.completeAuthorization("synthetic-code", state)).resolves.toEqual({ tenantId: "tenant-1", returnTo: dashboardOrigin });
  });

  it.each([
    "https://untrusted.example.test", "https://dashboard.example.test.evil.test",
    "http://dashboard.example.test", "https://dashboard.example.test:444",
    "https://user:pass@dashboard.example.test", "https://dashboard.example.test/redirect",
    "https://dashboard.example.test/?next=https://untrusted.example.test",
    "https://dashboard.example.test/#redirect", "//dashboard.example.test", "javascript:alert(1)",
    "http://user@localhost:5173",
  ])("rejects untrusted return address %s at issuance and callback", async returnTo => {
    const tokens = new MemoryTokenStore();
    const fetcher = vi.fn<typeof fetch>();
    const service = new GoogleOAuthService({ ...config, dashboardOrigin: hostedOrigin }, tokens, fetcher);
    expect(service.authorizationUrl("tenant-1", returnTo)).toBeNull();
    // A valid signature must not bypass the current redirect policy.
    const state = signedState(returnTo);
    expect(service.returnToForState(state)).toBeNull();
    await expect(service.completeAuthorization("synthetic-code", state)).resolves.toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
    expect(tokens.value).toBeNull();
  });

  it.each(["http://localhost:5274", "http://127.0.0.1:5174", "http://[::1]:5174"])(
    "preserves the development return address %s", async returnTo => {
      const service = new GoogleOAuthService({ ...config, dashboardOrigin: hostedOrigin }, new MemoryTokenStore(),
        async () => new Response(JSON.stringify({ access_token: "synthetic-access", refresh_token: "synthetic-refresh" })));
      const state = new URL(service.authorizationUrl("tenant-1", returnTo)!).searchParams.get("state")!;
      await expect(service.completeAuthorization("synthetic-code", state)).resolves.toEqual({ tenantId: "tenant-1", returnTo });
    },
  );

  it("does not infer a trusted HTTPS dashboard from the Google callback URI", async () => {
    const fetcher = vi.fn<typeof fetch>();
    const service = new GoogleOAuthService({ ...config, redirectUri: `${hostedOrigin}/api/integrations/google/callback` }, new MemoryTokenStore(), fetcher);
    expect(service.authorizationUrl("tenant-1", hostedOrigin)).toBeNull();
    await expect(service.completeAuthorization("synthetic-code", signedState(hostedOrigin))).resolves.toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("rejects an old signed hosted destination after the configured origin changes", async () => {
    const first = new GoogleOAuthService({ ...config, dashboardOrigin: hostedOrigin }, new MemoryTokenStore());
    const state = new URL(first.authorizationUrl("tenant-1", hostedOrigin)!).searchParams.get("state")!;
    const fetcher = vi.fn<typeof fetch>();
    const restarted = new GoogleOAuthService({ ...config, dashboardOrigin: "https://new.example.test" }, new MemoryTokenStore(), fetcher);
    expect(restarted.returnToForState(state)).toBeNull();
    await expect(restarted.completeAuthorization("synthetic-code", state)).resolves.toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each(["expired", "tampered"])("keeps rejecting %s hosted state before token exchange", async kind => {
    const fetcher = vi.fn<typeof fetch>();
    const service = new GoogleOAuthService({ ...config, dashboardOrigin: hostedOrigin }, new MemoryTokenStore(), fetcher);
    let state = signedState(hostedOrigin, kind === "expired" ? Date.now() - 1 : Date.now() + 60_000);
    if (kind === "tampered") {
      const [payload, signature] = state.split(".");
      const changed = { ...JSON.parse(Buffer.from(payload!, "base64url").toString("utf8")), tenantId: "different-tenant" };
      state = `${Buffer.from(JSON.stringify(changed)).toString("base64url")}.${signature}`;
    }
    expect(service.returnToForState(state)).toBeNull();
    await expect(service.completeAuthorization("synthetic-code", state)).resolves.toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("creates an authorization URL with a short-lived state and exchanges the matching callback", async () => {
    const tokens = new MemoryTokenStore();
    const fetcher: typeof fetch = async () => new Response(JSON.stringify({ access_token: "access", refresh_token: "refresh", expires_in: 3600 }), { status: 200 });
    const service = new GoogleOAuthService(config, tokens, fetcher);
    const url = service.authorizationUrl("tenant-1", "http://127.0.0.1:5174");
    if (!url) throw new Error("Expected configured OAuth URL");
    const state = new URL(url).searchParams.get("state");
    if (!state) throw new Error("Expected state");
    expect(new URL(url).searchParams.get("scope")).toContain("calendar.events.freebusy");

    await expect(service.completeAuthorization("code", state)).resolves.toEqual({ tenantId: "tenant-1", returnTo: "http://127.0.0.1:5174" });
    await expect(service.status("tenant-1")).resolves.toMatchObject({ configured: true, connected: true });
    expect(JSON.stringify({ url, status: await service.status("tenant-1") })).not.toContain(config.clientSecret);
  });

  it("returns connection state without the stored OAuth tokens", async () => {
    const tokens = new MemoryTokenStore();
    const accessMarker = "ya29.not-a-live-token";
    const refreshMarker = "refresh-marker-not-live";
    const fetcher: typeof fetch = async () => new Response(JSON.stringify({
      access_token: accessMarker, refresh_token: refreshMarker, expires_in: 3600,
    }), { status: 200 });
    const service = new GoogleOAuthService(config, tokens, fetcher);
    const url = service.authorizationUrl("tenant-1", "http://127.0.0.1:5174");
    const state = url ? new URL(url).searchParams.get("state") : null;
    if (!url || !state) throw new Error("Expected configured OAuth URL");
    const completed = await service.completeAuthorization("code", state);
    const status = await service.status("tenant-1");
    const serialized = JSON.stringify({ completed, status, url });
    expect(serialized).not.toContain(accessMarker);
    expect(serialized).not.toContain(refreshMarker);
    expect(serialized).not.toContain(config.clientSecret);
    expect(status).toEqual({ configured: true, connected: true });
  });

  it("rejects a callback whose state was never issued", async () => {
    const service = new GoogleOAuthService(config, new MemoryTokenStore());
    await expect(service.completeAuthorization("code", "untrusted-state")).resolves.toBeNull();
  });

  it("preserves a signed authorization state across a service restart", async () => {
    const tokens = new MemoryTokenStore();
    const first = new GoogleOAuthService(config, tokens);
    const url = first.authorizationUrl("tenant-1", "http://localhost:5173");
    if (!url) throw new Error("Expected URL");
    const state = new URL(url).searchParams.get("state");
    if (!state) throw new Error("Expected state");
    const restarted = new GoogleOAuthService(config, tokens, async () => new Response(JSON.stringify({ access_token: "access", refresh_token: "refresh" }), { status: 200 }));
    await expect(restarted.completeAuthorization("code", state)).resolves.toEqual({ tenantId: "tenant-1", returnTo: "http://localhost:5173" });
  });

  it("refreshes an expired access token without exposing the refresh token", async () => {
    const tokens = new MemoryTokenStore();
    tokens.value = { accessToken: "expired", refreshToken: "refresh", expiresAt: "2020-01-01T00:00:00.000Z" };
    const fetcher: typeof fetch = async () => new Response(JSON.stringify({ access_token: "fresh", expires_in: 3600 }), { status: 200 });
    const service = new GoogleOAuthService(config, tokens, fetcher);
    await expect(service.accessToken("tenant-1")).resolves.toBe("fresh");
    expect(tokens.value).toMatchObject({ accessToken: "fresh", refreshToken: "refresh" });
  });

  it("does not report a revoked or unreachable token as connected", async () => {
    const tokens = new MemoryTokenStore();
    tokens.value = { accessToken: "expired", refreshToken: "revoked", expiresAt: "2020-01-01T00:00:00.000Z" };
    const rejected = new GoogleOAuthService(config, tokens, async () => new Response(null, { status: 400 }));
    await expect(rejected.status("tenant-1")).resolves.toEqual({ configured: true, connected: false });

    const unreachable = new GoogleOAuthService(config, tokens, async () => { throw new Error("offline"); });
    await expect(unreachable.status("tenant-1")).resolves.toEqual({ configured: true, connected: false });
  });

  it("checks calendar access with the tenant token and maps safe statuses", async () => {
    const tokens = new MemoryTokenStore();
    tokens.value = { accessToken: "tenant-access", expiresAt: "2099-01-01T00:00:00.000Z" };
    const requests: string[] = [];
    const service = new GoogleOAuthService(config, tokens, async (input, init) => {
      requests.push(`${String(input)}:${new Headers(init?.headers).get("authorization")}`);
      return String(input).includes("missing") ? new Response(null, { status: 404 })
        : new Response(JSON.stringify({ kind: "calendar#events" }), { status: 200 });
    });
    await expect(service.verifyCalendarAccess("tenant-1", "team@example.com")).resolves.toBe("accessible");
    await expect(service.verifyCalendarAccess("tenant-1", "missing@example.com")).resolves.toBe("not_found");
    expect(requests[0]).toBe("https://www.googleapis.com/calendar/v3/calendars/team%40example.com/events?maxResults=1&fields=kind:Bearer tenant-access");
  });

  it("verifies access with event-only authorization instead of requesting calendar metadata", async () => {
    const tokens = new MemoryTokenStore();
    tokens.value = { accessToken: "events-scope", expiresAt: "2099-01-01T00:00:00.000Z" };
    const service = new GoogleOAuthService(config, tokens, async input => {
      const url = new URL(String(input));
      expect(url.searchParams.get("fields")).toBe("kind");
      expect(url.searchParams.get("maxResults")).toBe("1");
      return url.pathname.endsWith("/events")
        ? new Response(JSON.stringify({ kind: "calendar#events" }), { status: 200 })
        : new Response(JSON.stringify({ error: { message: "Request had insufficient authentication scopes." } }), { status: 403 });
    });
    await expect(service.verifyCalendarAccess("tenant-1", "calendar@example.com")).resolves.toBe("accessible");
  });

  it.each([[401, "disconnected"], [403, "forbidden"], [404, "not_found"], [503, "unavailable"]] as const)(
    "preserves authorization failure status %s", async (status, expected) => {
      const tokens = new MemoryTokenStore();
      tokens.value = { accessToken: "access", expiresAt: "2099-01-01T00:00:00.000Z" };
      const service = new GoogleOAuthService(config, tokens, async () => new Response(null, { status }));
      await expect(service.verifyCalendarAccess("tenant-1", "calendar")).resolves.toBe(expected);
    },
  );

  it("reports disconnected for invalid_grant without probing the calendar or overwriting the token", async () => {
    const tokens = new MemoryTokenStore();
    tokens.value = { accessToken: "expired", refreshToken: "revoked", expiresAt: "2020-01-01T00:00:00.000Z" };
    const original = tokens.value;
    const requests: string[] = [];
    const service = new GoogleOAuthService(config, tokens, async input => {
      requests.push(String(input));
      return new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 });
    });
    await expect(service.verifyCalendarAccess("tenant-1", "calendar")).resolves.toBe("disconnected");
    expect(requests).toEqual(["https://oauth2.googleapis.com/token"]);
    expect(tokens.value).toBe(original);
  });

  it("uses the configured isolated callback in both authorization and code exchange", async () => {
    const redirectUri = "http://localhost:3101/api/integrations/google/callback";
    const service = new GoogleOAuthService({ ...config, redirectUri }, new MemoryTokenStore(), async (_input, init) => {
      expect(new URLSearchParams(String(init?.body)).get("redirect_uri")).toBe(redirectUri);
      return new Response(JSON.stringify({ access_token: "access", refresh_token: "refresh" }), { status: 200 });
    });
    const url = new URL(service.authorizationUrl("tenant-1", "http://localhost:5274")!);
    expect(url.searchParams.get("redirect_uri")).toBe(redirectUri);
    await expect(service.completeAuthorization("code", url.searchParams.get("state")!)).resolves.toMatchObject({ tenantId: "tenant-1" });
  });

  it("distinguishes a disabled Calendar API from denied calendar access", async () => {
    const tokens = new MemoryTokenStore();
    tokens.value = { accessToken: "tenant-access", expiresAt: "2099-01-01T00:00:00.000Z" };
    const service = new GoogleOAuthService(config, tokens, async () => new Response(JSON.stringify({
      error: { errors: [{ reason: "accessNotConfigured" }] },
    }), { status: 403 }));
    await expect(service.verifyCalendarAccess("tenant-1", "team@example.com")).resolves.toBe("api_not_enabled");
  });
});
