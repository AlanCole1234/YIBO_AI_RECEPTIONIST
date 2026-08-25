import {
  defaultDatabasePath,
  migrateDatabase,
  openRegionalDatabase,
  seedBusiness,
} from "../infrastructure/database/regional-database.js";
import { SqliteGoogleTokenStore } from "../infrastructure/database/sqlite-google-token-store.js";
import {
  GoogleCalendarAdapter,
  GoogleOAuthService,
} from "../modules/integrations/index.js";
import type { BusinessProfile } from "../modules/business/index.js";
import {
  DEVELOPMENT_BUSINESS,
  DEVELOPMENT_US_BUSINESS,
} from "../app/development-fixtures.js";
import {
  buildApplication,
  type BuildApplicationOptions,
  type YiboApplication,
} from "./build-application.js";

export function buildConfiguredApplication(options: BuildApplicationOptions = {}): YiboApplication {
  const environment = options.environment ?? process.env;
  const businesses = options.businesses ?? [DEVELOPMENT_BUSINESS, DEVELOPMENT_US_BUSINESS];
  const tenantId = options.tenantId ?? DEVELOPMENT_BUSINESS.tenantId;
  const tenant = businesses.find((profile) => profile.tenantId === tenantId);
  if (!tenant) throw new Error(`Unknown bootstrap tenant: ${tenantId}`);
  const google = buildGoogleIntegration(environment, tenant);
  return buildApplication({
    ...options,
    environment,
    businesses,
    tenantId,
    ...(google ? { googleOAuth: google.oauth, calendar: google.calendar } : {}),
  });
}

function buildGoogleIntegration(
  environment: NodeJS.ProcessEnv,
  tenant: BusinessProfile,
): { oauth: GoogleOAuthService; calendar: GoogleCalendarAdapter } | undefined {
  const clientId = environment.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = environment.GOOGLE_CLIENT_SECRET?.trim();
  const redirectUri = environment.GOOGLE_REDIRECT_URI?.trim();
  const calendarId = environment.GOOGLE_CALENDAR_ID?.trim();
  const stateSigningKey = environment.YIBO_TOKEN_ENCRYPTION_KEY?.trim();
  if (!clientId || !clientSecret || !redirectUri || !calendarId || !stateSigningKey) return undefined;
  const path = environment[`YIBO_DATABASE_${tenant.region}`]?.trim() || defaultDatabasePath(tenant.region);
  const database = openRegionalDatabase(tenant.region, path);
  migrateDatabase(database);
  seedBusiness(database, tenant);
  const oauth = new GoogleOAuthService(
    { clientId, clientSecret, redirectUri, calendarId, stateSigningKey },
    new SqliteGoogleTokenStore(database, tenant.region, stateSigningKey),
  );
  return { oauth, calendar: new GoogleCalendarAdapter(calendarId, tenant.timezone, oauth) };
}
