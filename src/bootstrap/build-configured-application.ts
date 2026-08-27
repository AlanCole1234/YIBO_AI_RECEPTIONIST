import {
  defaultDatabasePath,
  migrateDatabase,
  openRegionalDatabase,
  seedBusiness,
} from "../infrastructure/database/regional-database.js";
import { SqliteAgentConfigurationRepository } from "../infrastructure/database/sqlite-agent-configuration-repository.js";
import { SqliteCallRepository } from "../infrastructure/database/sqlite-call-repository.js";
import { SqliteConversationUsageRepository } from "../infrastructure/database/sqlite-conversation-usage-repository.js";
import { SqliteGoogleTokenStore } from "../infrastructure/database/sqlite-google-token-store.js";
import { AgentConfigurationService } from "../modules/agents/index.js";
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

export async function buildConfiguredApplication(options: BuildApplicationOptions = {}): Promise<YiboApplication> {
  const environment = options.environment ?? process.env;
  const businesses = options.businesses ?? [DEVELOPMENT_BUSINESS, DEVELOPMENT_US_BUSINESS];
  const tenantId = options.tenantId ?? DEVELOPMENT_BUSINESS.tenantId;
  const tenant = businesses.find((profile) => profile.tenantId === tenantId);
  if (!tenant) throw new Error(`Unknown bootstrap tenant: ${tenantId}`);
  const path = environment[`YIBO_DATABASE_${tenant.region}`]?.trim() || defaultDatabasePath(tenant.region);
  const database = openRegionalDatabase(tenant.region, path);
  migrateDatabase(database);
  seedBusiness(database, tenant);

  const configurationRepository = options.agentConfigurationRepository
    ?? new SqliteAgentConfigurationRepository(database, tenant.region);
  const usageRecorder = options.usageRecorder
    ?? new SqliteConversationUsageRepository(database, tenant.region);
  const callRepository = options.callRepository
    ?? new SqliteCallRepository(database, tenant.region);
  const configurationService = new AgentConfigurationService(configurationRepository);
  if (!await configurationService.get(tenantId)) {
    const applicationConfig = options.config;
    const model = applicationConfig?.openAiRealtimeModel
      ?? environment.OPENAI_REALTIME_MODEL?.trim()
      ?? "gpt-realtime-2.1";
    await configurationService.update(
      tenantId,
      configurationService.recommended(tenant.locale, tenant.name, model),
    );
  }

  const google = buildGoogleIntegration(environment, tenant, database);
  return buildApplication({
    ...options,
    environment,
    businesses,
    tenantId,
    agentConfigurationRepository: configurationRepository,
    usageRecorder,
    callRepository,
    ...(google ? { googleOAuth: google.oauth, calendar: google.calendar } : {}),
  });
}

function buildGoogleIntegration(
  environment: NodeJS.ProcessEnv,
  tenant: BusinessProfile,
  database: ReturnType<typeof openRegionalDatabase>,
): { oauth: GoogleOAuthService; calendar: GoogleCalendarAdapter } | undefined {
  const clientId = environment.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = environment.GOOGLE_CLIENT_SECRET?.trim();
  const redirectUri = environment.GOOGLE_REDIRECT_URI?.trim();
  const calendarId = environment.GOOGLE_CALENDAR_ID?.trim();
  const stateSigningKey = environment.YIBO_TOKEN_ENCRYPTION_KEY?.trim();
  if (!clientId || !clientSecret || !redirectUri || !calendarId || !stateSigningKey) return undefined;
  const oauth = new GoogleOAuthService(
    { clientId, clientSecret, redirectUri, calendarId, stateSigningKey },
    new SqliteGoogleTokenStore(database, tenant.region, stateSigningKey),
  );
  return { oauth, calendar: new GoogleCalendarAdapter(calendarId, tenant.timezone, oauth) };
}
