export interface GoogleToken {
  accessToken: string;
  refreshToken?: string;
  expiresAt: string;
}

export interface GoogleTokenStore {
  get(tenantId: string): Promise<GoogleToken | null>;
  save(tenantId: string, token: GoogleToken): Promise<void>;
}

export type GoogleCalendarConnectionError =
  | "CALENDAR_NOT_CONNECTED"
  | "AUTHORIZATION_REQUIRED"
  | "CALENDAR_PERMISSION_DENIED"
  | "CALENDAR_API_UNAVAILABLE";

export interface GoogleIntegrationStatus {
  configured: boolean;
  connected: boolean;
  calendarId?: string;
  lastCheckedAt?: string;
  errorCode?: GoogleCalendarConnectionError;
}
