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
import { AgentConfigurationService } from "../modules/agents/index.js";
import {
  GoogleCalendarAdapter,
  GoogleOAuthService,
} from "../modules/integrations/index.js";
import { AsteriskAriClient, AsteriskRtpVoiceMediaGateway, AsteriskTelephonyGateway } from "../modules/telephony/index.js";
import { randomUUID } from "node:crypto";
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
  const businessRepository = new SqliteBusinessRepository(database, tenant.region);

  const configurationRepository = options.agentConfigurationRepository
    ?? new SqliteAgentConfigurationRepository(database, tenant.region);
  const usageRecorder = options.usageRecorder
    ?? new SqliteConversationUsageRepository(database, tenant.region);
  const callRepository = options.callRepository
    ?? new SqliteCallRepository(database, tenant.region);
  const configurationService = new AgentConfigurationService(configurationRepository);
  const existingConfiguration = await configurationService.get(tenantId);
  if (!existingConfiguration) {
    const applicationConfig = options.config;
    const model = applicationConfig?.openAiRealtimeModel
      ?? environment.OPENAI_REALTIME_MODEL?.trim()
      ?? "gpt-realtime-2.1";
    await configurationService.update(
      tenantId,
      configurationService.recommended(tenant.locale, tenant.name, model),
    );
  } else if (existingConfiguration.enabledTools.includes("create_appointment")
    && (!existingConfiguration.enabledTools.includes("check_availability")
      || !existingConfiguration.enabledTools.includes("update_customer")
      || !existingConfiguration.enabledTools.includes("reschedule_appointment"))) {
    // Booking agents must retain the availability tool; otherwise the realtime
    // prompt cannot safely consult Google Calendar before offering a time.
    await configurationService.update(tenantId, {
      ...existingConfiguration,
      enabledTools: [
        ...existingConfiguration.enabledTools,
        ...(existingConfiguration.enabledTools.includes("check_availability") ? [] : ["check_availability" as const]),
        ...(existingConfiguration.enabledTools.includes("update_customer") ? [] : ["update_customer" as const]),
        ...(existingConfiguration.enabledTools.includes("reschedule_appointment") ? [] : ["reschedule_appointment" as const]),
      ],
    });
  }

  const google = buildGoogleIntegration(environment, tenant, database, businessRepository);
  const telephony = options.enableAsteriskTelephony ? buildAsteriskTelephony(environment) : undefined;
  const application = buildApplication({
    ...options,
    environment,
    businesses,
    businessRepository,
    tenantId,
    agentConfigurationRepository: configurationRepository,
    usageRecorder,
    callRepository,
    ...(google ? { googleOAuth: google.oauth, calendar: google.calendar } : {}),
    ...(telephony ? { telephony: telephony.gateway, voice: telephony.media } : {}),
  });
  if (telephony) await telephony.client.connect();
  return application;
}

function buildAsteriskTelephony(environment: NodeJS.ProcessEnv): { client: AsteriskAriClient; gateway: AsteriskTelephonyGateway; media: AsteriskRtpVoiceMediaGateway } | undefined {
  const baseUrl = environment.ASTERISK_ARI_URL?.trim();
  const application = environment.ASTERISK_ARI_APPLICATION?.trim();
  const username = environment.ASTERISK_ARI_USERNAME?.trim();
  const password = environment.ASTERISK_ARI_PASSWORD?.trim();
  const supplied = [baseUrl, application, username, password].filter(Boolean).length;
  if (!supplied) return undefined;
  if (supplied !== 4) throw new Error("ASTERISK_ARI_URL, ASTERISK_ARI_APPLICATION, ASTERISK_ARI_USERNAME, and ASTERISK_ARI_PASSWORD must all be configured together");
  const mediaHost = environment.YIBO_ASTERISK_MEDIA_HOST?.trim();
  const mediaPortStart = requiredPort(environment.YIBO_ASTERISK_MEDIA_PORT_START, "YIBO_ASTERISK_MEDIA_PORT_START");
  const mediaPortEnd = requiredPort(environment.YIBO_ASTERISK_MEDIA_PORT_END, "YIBO_ASTERISK_MEDIA_PORT_END");
  if (!mediaHost) throw new Error("YIBO_ASTERISK_MEDIA_HOST is required when Asterisk ARI is configured");
  if (mediaPortEnd < mediaPortStart) throw new Error("YIBO_ASTERISK_MEDIA_PORT_END must be greater than or equal to YIBO_ASTERISK_MEDIA_PORT_START");
  console.log(JSON.stringify({ event: "telephony.ari.connecting", application, host: new URL(baseUrl!).host }));
  const client = new AsteriskAriClient({ baseUrl: baseUrl!, application: application!, username: username!, password: password! });
  const disableBargeInForTestDialedNumber = environment.NODE_ENV === "production"
    ? undefined
    : environment.YIBO_ASTERISK_PRIVATE_TEST_DISABLE_BARGE_IN_FOR_DIALED_NUMBER?.trim();
  const diagnosticDialedNumber = environment.NODE_ENV === "production"
    ? undefined
    : environment.YIBO_ASTERISK_AUDIO_DIAGNOSTIC_DIALED_NUMBER?.trim();
  const diagnosticSourceRaw = environment.YIBO_ASTERISK_AUDIO_DIAGNOSTIC_SOURCE?.trim();
  if (diagnosticSourceRaw && diagnosticSourceRaw !== "pcmu_tone" && diagnosticSourceRaw !== "realtime_tone") {
    throw new Error("YIBO_ASTERISK_AUDIO_DIAGNOSTIC_SOURCE must be pcmu_tone or realtime_tone");
  }
  const diagnosticSource = diagnosticSourceRaw === "pcmu_tone" || diagnosticSourceRaw === "realtime_tone"
    ? diagnosticSourceRaw
    : undefined;
  if (Boolean(diagnosticDialedNumber) !== Boolean(diagnosticSource)) {
    throw new Error("YIBO_ASTERISK_AUDIO_DIAGNOSTIC_DIALED_NUMBER and YIBO_ASTERISK_AUDIO_DIAGNOSTIC_SOURCE must be configured together");
  }
  const media = new AsteriskRtpVoiceMediaGateway(client, {
    host: mediaHost,
    portStart: mediaPortStart,
    portEnd: mediaPortEnd,
    ...(disableBargeInForTestDialedNumber ? { disableBargeInForTestDialedNumber } : {}),
    ...(diagnosticDialedNumber && diagnosticSource ? { audioDiagnostic: { dialedNumber: diagnosticDialedNumber, source: diagnosticSource } } : {}),
  });
  const gateway = new AsteriskTelephonyGateway(client, () => `call-${randomUUID()}`, media);
  return { client, gateway, media };
}

function requiredPort(raw: string | undefined, name: string): number {
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > 65_535) throw new Error(`${name} must be a UDP port number`);
  return value;
}

function buildGoogleIntegration(
  environment: NodeJS.ProcessEnv,
  tenant: BusinessProfile,
  database: ReturnType<typeof openRegionalDatabase>,
  businesses: SqliteBusinessRepository,
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
  return {
    oauth,
    calendar: new GoogleCalendarAdapter(
      calendarId,
      async (tenantId) => (await businesses.findByTenantId(tenantId))?.timezone ?? tenant.timezone,
      oauth,
    ),
  };
}
