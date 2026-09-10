import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import type { GoogleCalendarConnectionError, GoogleIntegrationStatus, GoogleToken, GoogleTokenStore } from "./contracts.js";

export interface GoogleOAuthConfig {
  clientId?: string;
  clientSecret?: string;
  redirectUri?: string;
  calendarId?: string;
  stateSigningKey?: string;
}

type AuthorizationState = { tenantId: string; returnTo: string; expiresAt: number; nonce: string };
type AccessTokenResult =
  | { ok: true; token: string }
  | { ok: false; errorCode: Extract<GoogleCalendarConnectionError, "CALENDAR_NOT_CONNECTED" | "AUTHORIZATION_REQUIRED" | "CALENDAR_API_UNAVAILABLE"> };

export class GoogleOAuthService {
  constructor(
    private readonly config: GoogleOAuthConfig,
    private readonly tokens: GoogleTokenStore,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  async status(tenantId: string): Promise<GoogleIntegrationStatus> {
    const configured = this.isConfigured();
    const token = configured ? await this.tokens.get(tenantId) : null;
    return { configured, connected: token !== null, ...(this.config.calendarId ? { calendarId: this.config.calendarId } : {}) };
  }

  authorizationUrl(tenantId: string, returnTo: string): string | null {
    if (!this.isConfigured()) return null;
    const state = this.signState({ tenantId, returnTo, expiresAt: Date.now() + 10 * 60_000, nonce: randomUUID() });
    const query = new URLSearchParams({
      client_id: this.config.clientId!, redirect_uri: this.config.redirectUri!, response_type: "code",
      scope: "https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.events.freebusy",
      access_type: "offline", prompt: "consent", state,
    });
    return `https://accounts.google.com/o/oauth2/v2/auth?${query}`;
  }

  async completeAuthorization(code: string, state: string): Promise<{ tenantId: string; returnTo: string } | null> {
    const pending = this.readState(state);
    if (!pending || !code || !this.isConfigured()) return null;

    const response = await this.fetcher("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code, client_id: this.config.clientId!, client_secret: this.config.clientSecret!,
        redirect_uri: this.config.redirectUri!, grant_type: "authorization_code",
      }),
    });
    if (!response.ok) {
      oauthLog("google.oauth.token_exchange.failed", { tenantId: pending.tenantId, httpStatus: response.status });
      return null;
    }
    const payload = await response.json() as { access_token?: string; refresh_token?: string; expires_in?: number };
    const previous = await this.tokens.get(pending.tenantId);
    const refreshToken = payload.refresh_token ?? previous?.refreshToken;
    if (!payload.access_token || !refreshToken) {
      oauthLog("google.oauth.token_exchange.failed", { tenantId: pending.tenantId, reason: "refresh_token_missing" });
      return null;
    }
    await this.tokens.save(pending.tenantId, {
      accessToken: payload.access_token, refreshToken,
      expiresAt: new Date(Date.now() + (payload.expires_in ?? 3600) * 1000).toISOString(),
    });
    return { tenantId: pending.tenantId, returnTo: pending.returnTo };
  }

  returnToForState(state: string): string | null {
    return this.readState(state)?.returnTo ?? null;
  }

  async accessToken(tenantId: string): Promise<string | null> {
    const result = await this.accessTokenResult(tenantId);
    return result.ok ? result.token : null;
  }

  async accessTokenResult(tenantId: string): Promise<AccessTokenResult> {
    const current = await this.tokens.get(tenantId);
    if (!current) return { ok: false, errorCode: "CALENDAR_NOT_CONNECTED" };
    if (new Date(current.expiresAt).valueOf() > Date.now() + 60_000) return { ok: true, token: current.accessToken };
    if (!current.refreshToken || !this.isConfigured()) return { ok: false, errorCode: "AUTHORIZATION_REQUIRED" };

    try {
      const response = await this.fetcher("https://oauth2.googleapis.com/token", {
        method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: this.config.clientId!, client_secret: this.config.clientSecret!,
          refresh_token: current.refreshToken, grant_type: "refresh_token",
        }),
      });
      if (!response.ok) {
        const errorCode = response.status === 400 || response.status === 401 ? "AUTHORIZATION_REQUIRED" : "CALENDAR_API_UNAVAILABLE";
        oauthLog("google.oauth.refresh.failed", { tenantId, httpStatus: response.status, errorCode });
        return { ok: false, errorCode };
      }
      const payload = await response.json() as { access_token?: string; expires_in?: number };
      if (!payload.access_token) {
        oauthLog("google.oauth.refresh.failed", { tenantId, reason: "access_token_missing", errorCode: "AUTHORIZATION_REQUIRED" });
        return { ok: false, errorCode: "AUTHORIZATION_REQUIRED" };
      }
      const refreshed: GoogleToken = {
        accessToken: payload.access_token, refreshToken: current.refreshToken,
        expiresAt: new Date(Date.now() + (payload.expires_in ?? 3600) * 1000).toISOString(),
      };
      await this.tokens.save(tenantId, refreshed);
      oauthLog("google.oauth.refresh.completed", { tenantId });
      return { ok: true, token: refreshed.accessToken };
    } catch {
      oauthLog("google.oauth.refresh.failed", { tenantId, errorCode: "CALENDAR_API_UNAVAILABLE" });
      return { ok: false, errorCode: "CALENDAR_API_UNAVAILABLE" };
    }
  }

  private isConfigured(): boolean {
    return Boolean(this.config.clientId && this.config.clientSecret && this.config.redirectUri && this.config.calendarId && this.config.stateSigningKey);
  }

  private signState(value: AuthorizationState): string {
    const payload = Buffer.from(JSON.stringify(value)).toString("base64url");
    return `${payload}.${this.signature(payload)}`;
  }

  private readState(value: string): AuthorizationState | null {
    const [payload, signature] = value.split(".");
    if (!payload || !signature || !this.config.stateSigningKey) return null;
    const expected = this.signature(payload);
    if (signature.length !== expected.length || !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
    try {
      const state = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as AuthorizationState;
      return state.tenantId && isLocalDashboardUrl(state.returnTo) && state.expiresAt > Date.now() ? state : null;
    } catch { return null; }
  }

  private signature(payload: string): string {
    return createHmac("sha256", this.config.stateSigningKey!).update(payload).digest("base64url");
  }
}

const oauthLog = (event: string, metadata: Record<string, unknown>): void => console.log(JSON.stringify({ event, ...metadata }));

const isLocalDashboardUrl = (value: string): boolean => {
  try {
    const url = new URL(value);
    return url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) && Boolean(url.port);
  } catch { return false; }
};
