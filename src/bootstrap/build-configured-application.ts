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
import { SqliteBusinessRepository } from "../infrastructure/database/sqlite-business-repository.js";
import { SqliteAdminIdentityRepository } from "../infrastructure/database/sqlite-admin-identity-repository.js";
import { SqliteAdminAuditLog } from "../infrastructure/database/sqlite-admin-audit-log.js";
import { SqliteCustomerRepository } from "../infrastructure/database/sqlite-customer-repository.js";
import { SqliteAppointmentRepository } from "../infrastructure/database/sqlite-appointment-repository.js";
import { AgentConfigurationService, DEFAULT_REALTIME_MODEL } from "../modules/agents/index.js";
import {
  GoogleCalendarAdapter,
  GoogleOAuthService,
  BusinessCalendarAssignmentResolver,
} from "../modules/integrations/index.js";
import { BusinessDirectoryService, upgradeBusinessProfile, type BusinessConfigurationV2 } from "../modules/business/index.js";
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
  const businesses = (options.businesses ?? [DEVELOPMENT_BUSINESS, DEVELOPMENT_US_BUSINESS])
    .map(upgradeBusinessProfile);
  const tenantId = options.tenantId ?? DEVELOPMENT_BUSINESS.tenantId;
  const tenant = businesses.find((profile) => profile.tenantId === tenantId);
  if (!tenant) throw new Error(`Unknown bootstrap tenant: ${tenantId}`);
  const path = environment[`YIBO_DATABASE_${tenant.region}`]?.trim() || defaultDatabasePath(tenant.region);
  const database = openRegionalDatabase(tenant.region, path);
  migrateDatabase(database);
  seedBusiness(database, tenant);
  const businessRepository = new SqliteBusinessRepository(database, tenant.region);
  await importLegacyDefaultCalendar(environment, tenantId, businessRepository);

  const configurationRepository = options.agentConfigurationRepository
    ?? new SqliteAgentConfigurationRepository(database, tenant.region);
  const usageRecorder = options.usageRecorder
    ?? new SqliteConversationUsageRepository(database, tenant.region);
  const callRepository = options.callRepository
    ?? new SqliteCallRepository(database, tenant.region);
  const customerRepository = options.customerRepository
    ?? new SqliteCustomerRepository(database, tenant.region);
  const appointmentRepository = options.appointmentRepository
    ?? new SqliteAppointmentRepository(database, tenant.region);
  const configurationService = new AgentConfigurationService(configurationRepository);
  const existingConfiguration = await configurationService.get(tenantId);
  if (!existingConfiguration) {
    const applicationConfig = options.config;
    const model = applicationConfig?.openAiRealtimeModel
      ?? environment.OPENAI_REALTIME_MODEL?.trim()
      ?? DEFAULT_REALTIME_MODEL;
    await configurationService.update(
      tenantId,
      configurationService.recommended(tenant.locations[0]!.locale, tenant.name, model, {
        ...(applicationConfig?.conversationVoice ? { voice: applicationConfig.conversationVoice } : {}),
        ...(applicationConfig?.maxOutputTokens ? { maxOutputTokens: applicationConfig.maxOutputTokens } : {}),
        ...(applicationConfig?.vadThreshold !== undefined
          || applicationConfig?.vadPrefixPaddingMs !== undefined
          || applicationConfig?.vadSilenceDurationMs !== undefined
          ? { turnDetection: {
              ...(applicationConfig.vadThreshold === undefined ? {} : { threshold: applicationConfig.vadThreshold }),
              ...(applicationConfig.vadPrefixPaddingMs === undefined ? {} : { prefixPaddingMs: applicationConfig.vadPrefixPaddingMs }),
              ...(applicationConfig.vadSilenceDurationMs === undefined ? {} : { silenceDurationMs: applicationConfig.vadSilenceDurationMs }),
            } }
          : {}),
      }),
    );
  } else if (existingConfiguration.enabledTools.includes("create_appointment")
    && (!existingConfiguration.enabledTools.includes("update_customer")
      || !existingConfiguration.enabledTools.includes("reschedule_appointment"))) {
    // Existing booking agents gain the minimum contact and rescheduling tools so
    // the dashboard and the live agent agree without replacing configuration.
    await configurationService.update(tenantId, {
      ...existingConfiguration,
      enabledTools: [
        ...existingConfiguration.enabledTools,
        ...(existingConfiguration.enabledTools.includes("update_customer") ? [] : ["update_customer" as const]),
        ...(existingConfiguration.enabledTools.includes("reschedule_appointment") ? [] : ["reschedule_appointment" as const]),
      ],
    });
  }

  const google = buildGoogleIntegration(environment, tenant, database, businessRepository);
  return buildApplication({
    ...options,
    environment,
    businesses,
    businessRepository,
    tenantId,
    agentConfigurationRepository: configurationRepository,
    usageRecorder,
    callRepository,
    customerRepository,
    appointmentRepository,
    adminIdentityRepository: options.adminIdentityRepository
      ?? new SqliteAdminIdentityRepository(database, tenant.region),
    adminAuditLog: options.adminAuditLog ?? new SqliteAdminAuditLog(database, tenant.region),
    ...(environment.YIBO_ADMIN_SESSION_KEY?.trim()
      ? { adminSessionSecret: environment.YIBO_ADMIN_SESSION_KEY.trim() }
      : {}),
    ...(google ? { googleOAuth: google.oauth, calendar: google.calendar } : {}),
  });
}

function buildGoogleIntegration(
  environment: NodeJS.ProcessEnv,
  tenant: BusinessConfigurationV2,
  database: ReturnType<typeof openRegionalDatabase>,
  businesses: SqliteBusinessRepository,
): { oauth: GoogleOAuthService; calendar: GoogleCalendarAdapter } | undefined {
  const clientId = environment.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = environment.GOOGLE_CLIENT_SECRET?.trim();
  const redirectUri = environment.GOOGLE_REDIRECT_URI?.trim();
  const stateSigningKey = environment.YIBO_TOKEN_ENCRYPTION_KEY?.trim();
  if (!clientId || !clientSecret || !redirectUri || !stateSigningKey) return undefined;
  const oauth = new GoogleOAuthService(
    { clientId, clientSecret, redirectUri, stateSigningKey },
    new SqliteGoogleTokenStore(database, tenant.region, stateSigningKey),
  );
  return {
    oauth,
    calendar: new GoogleCalendarAdapter(
      new BusinessCalendarAssignmentResolver(new BusinessDirectoryService(businesses)),
      oauth,
    ),
  };
}

async function importLegacyDefaultCalendar(
  environment: NodeJS.ProcessEnv,
  tenantId: string,
  repository: SqliteBusinessRepository,
): Promise<void> {
  const calendarId = environment.GOOGLE_CALENDAR_ID?.trim();
  if (!calendarId) return;
  const stored = await repository.findConfigurationByTenantId(tenantId);
  if (!stored) return;
  const profile = upgradeBusinessProfile(stored.profile);
  const location = profile.locations.find(({ id }) => id === "default") ?? profile.locations[0];
  if (!location || location.defaultCalendarId) return;
  location.defaultCalendarId = calendarId;
  await repository.saveIfVersion(profile, stored.version);
}
