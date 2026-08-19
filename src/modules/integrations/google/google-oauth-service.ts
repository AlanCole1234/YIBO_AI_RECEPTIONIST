import { randomUUID } from "node:crypto";
import type { GoogleIntegrationStatus, GoogleToken, GoogleTokenStore } from "./contracts.js";

export interface GoogleOAuthConfig {
  clientId?: string;
  clientSecret?: string;
  redirectUri?: string;
  calendarId?: string;
}

type PendingAuthorization = { tenantId: string; expiresAt: number };

export class GoogleOAuthService {
  private readonly pending = new Map<string, PendingAuthorization>();

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

  authorizationUrl(tenantId: string): string | null {
    if (!this.isConfigured()) return null;
    const state = randomUUID();
    this.pending.set(state, { tenantId, expiresAt: Date.now() + 10 * 60_000 });
    const query = new URLSearchParams({
      client_id: this.config.clientId!, redirect_uri: this.config.redirectUri!, response_type: "code",
      scope: "https://www.googleapis.com/auth/calendar.events", access_type: "offline", prompt: "consent", state,
    });
    return `https://accounts.google.com/o/oauth2/v2/auth?${query}`;
  }

  async completeAuthorization(code: string, state: string): Promise<{ tenantId: string } | null> {
    const pending = this.pending.get(state);
    this.pending.delete(state);
    if (!pending || pending.expiresAt < Date.now() || !code || !this.isConfigured()) return null;

    const response = await this.fetcher("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code, client_id: this.config.clientId!, client_secret: this.config.clientSecret!,
        redirect_uri: this.config.redirectUri!, grant_type: "authorization_code",
      }),
    });
    if (!response.ok) return null;
    const payload = await response.json() as { access_token?: string; refresh_token?: string; expires_in?: number };
    if (!payload.access_token || !payload.refresh_token) return null;
    await this.tokens.save(pending.tenantId, {
      accessToken: payload.access_token, refreshToken: payload.refresh_token,
      expiresAt: new Date(Date.now() + (payload.expires_in ?? 3600) * 1000).toISOString(),
    });
    return { tenantId: pending.tenantId };
  }

  async accessToken(tenantId: string): Promise<string | null> {
    const current = await this.tokens.get(tenantId);
    if (!current) return null;
    if (new Date(current.expiresAt).valueOf() > Date.now() + 60_000) return current.accessToken;
    if (!current.refreshToken || !this.isConfigured()) return null;

    const response = await this.fetcher("https://oauth2.googleapis.com/token", {
      method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: this.config.clientId!, client_secret: this.config.clientSecret!,
        refresh_token: current.refreshToken, grant_type: "refresh_token",
      }),
    });
    if (!response.ok) return null;
    const payload = await response.json() as { access_token?: string; expires_in?: number };
    if (!payload.access_token) return null;
    const refreshed: GoogleToken = {
      accessToken: payload.access_token, refreshToken: current.refreshToken,
      expiresAt: new Date(Date.now() + (payload.expires_in ?? 3600) * 1000).toISOString(),
    };
    await this.tokens.save(tenantId, refreshed);
    return refreshed.accessToken;
  }

  private isConfigured(): boolean {
    return Boolean(this.config.clientId && this.config.clientSecret && this.config.redirectUri && this.config.calendarId);
  }
}
