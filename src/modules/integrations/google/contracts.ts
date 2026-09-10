export interface GoogleToken {
  accessToken: string;
  refreshToken?: string;
  expiresAt: string;
}

export interface GoogleTokenStore {
  get(tenantId: string): Promise<GoogleToken | null>;
  save(tenantId: string, token: GoogleToken): Promise<void>;
}

export interface GoogleIntegrationStatus {
  configured: boolean;
  connected: boolean;
}

export type GoogleCalendarAccessStatus =
  | "accessible"
  | "integration_not_configured"
  | "disconnected"
  | "forbidden"
  | "not_found"
  | "unavailable";
