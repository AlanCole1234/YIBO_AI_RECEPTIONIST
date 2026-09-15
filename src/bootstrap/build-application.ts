import { randomUUID } from "node:crypto";
import {
  AgentDefinitionService,
  AgentConfigurationService,
  AGENT_TOOL_DEFINITIONS,
  InMemoryAgentConfigurationSource,
  ToolExecutorImpl,
  type HumanTransferPort,
  type AgentDefinitionFactory,
  type AgentConfigurationRepository,
  type AgentConfigurationServiceContract,
  type ToolExecutor,
} from "../modules/agents/index.js";
import {
  AppointmentServiceImpl,
  InMemoryAppointmentConcurrencyGuard,
  InMemoryAppointmentRepository,
  type AppointmentService,
  type AppointmentCalendarPort,
  type CustomerReader,
} from "../modules/appointments/index.js";
import {
  BusinessDirectoryService,
  InMemoryBusinessRepository,
  type BusinessDirectory,
  type BusinessProfile,
  type BusinessRepository,
} from "../modules/business/index.js";
import {
  CallOrchestratorService,
  InMemoryCallRepository,
  type CallOrchestrator,
  type CallHistoryReader,
  type CallRepository,
} from "../modules/calls/index.js";
import {
  ConversationService,
  OpenAIRealtimeAdapter,
  ScriptedConversationRuntime,
  type ConversationRuntimePort,
  type ConversationServiceContract,
  type ConversationTransport,
  type ConversationUsageRecorder,
} from "../modules/conversation/index.js";
import {
  DefaultCustomerService,
  InMemoryCustomerRepository,
  type CustomerService,
} from "../modules/customers/index.js";
import {
  GoogleOAuthService,
  InMemoryCalendarAdapter,
  type GoogleIntegrationStatus,
} from "../modules/integrations/index.js";
import {
  SchedulingServiceImpl,
  type CalendarPort,
  type ConfirmedAppointmentReader,
  type EmployeeWorkingHoursProvider,
  type SchedulingService,
} from "../modules/scheduling/index.js";
import {
  ScriptedVoiceMediaGateway,
  type VoiceMediaGateway,
} from "../modules/voice/index.js";
import type { Clock, IdGenerator } from "../shared/application/system.js";
import { failure } from "../shared/domain/result.js";
import {
  DEVELOPMENT_BUSINESS,
  DEVELOPMENT_US_BUSINESS,
} from "../app/development-fixtures.js";
import { loadConfiguration, type ApplicationConfiguration } from "./configuration.js";
import { InMemoryCallTelephonyGateway } from "./in-memory-telephony.js";
import type { CallTelephonyGateway } from "../modules/calls/index.js";
import type { OrganizationCostReader } from "../modules/billing/index.js";
import { OpenAIOrganizationCostsAdapter } from "../infrastructure/billing/openai-organization-costs-adapter.js";
type ApplicationCalendar = CalendarPort & AppointmentCalendarPort & {
  checkConnection?: (tenantId: string) => Promise<GoogleIntegrationStatus>;
};

export interface YiboApplication {
  tenantId: string;
  config: ApplicationConfiguration;
  business: BusinessDirectory;
  customers: CustomerService;
  scheduling: SchedulingService;
  appointments: AppointmentService;
  tools: ToolExecutor;
  agents: AgentDefinitionFactory;
  agentConfiguration: AgentConfigurationServiceContract;
  conversations: ConversationServiceContract;
  calls: CallOrchestrator;
  callHistory: CallHistoryReader;
  runtime: ConversationRuntimePort;
  voice: VoiceMediaGateway;
  calendar: ApplicationCalendar;
  telephony: CallTelephonyGateway & { answeredCallIds?: string[]; hungUpCallIds?: string[] };
  ids: IdGenerator;
  billing?: OrganizationCostReader;
  googleOAuth?: GoogleOAuthService;
  registerCallMedia(callId: string, transport: ConversationTransport): void;
}

export interface BuildApplicationOptions {
  environment?: NodeJS.ProcessEnv;
  config?: ApplicationConfiguration;
  tenantId?: string;
  businesses?: BusinessProfile[];
  businessRepository?: BusinessRepository;
  clock?: Clock;
  ids?: IdGenerator;
  runtime?: ConversationRuntimePort;
  humanTransfer?: HumanTransferPort;
  agentConfigurationRepository?: AgentConfigurationRepository;
  usageRecorder?: ConversationUsageRecorder;
  callRepository?: CallRepository & CallHistoryReader;
  billing?: OrganizationCostReader;
  calendar?: ApplicationCalendar;
  googleOAuth?: GoogleOAuthService;
  voice?: VoiceMediaGateway;
  telephony?: CallTelephonyGateway & { onEvent?(handler: (event: import("../modules/telephony/index.js").TelephonyEvent) => Promise<void>): void };
  /** Only the API process owns the real ARI subscription; browser Voice Test stays isolated. */
  enableAsteriskTelephony?: boolean;
}

export function buildApplication(options: BuildApplicationOptions = {}): YiboApplication {
  const environment = options.environment ?? process.env;
  const config = options.config ?? loadConfiguration(environment);
  const clock = options.clock ?? systemClock;
  const ids = options.ids ?? uuidGenerator;
  const profiles = options.businesses ?? [DEVELOPMENT_BUSINESS, DEVELOPMENT_US_BUSINESS];
  const tenantId = options.tenantId ?? DEVELOPMENT_BUSINESS.tenantId;
  const tenant = profiles.find((profile) => profile.tenantId === tenantId);
  if (!tenant) throw new Error(`Unknown bootstrap tenant: ${tenantId}`);

  const runtime = selectRuntime(config, options.runtime);
  const billing = options.billing ?? (config.openAiAdminKey
    ? new OpenAIOrganizationCostsAdapter(config.openAiAdminKey)
    : undefined);
  const businessRepository = options.businessRepository ?? new InMemoryBusinessRepository(profiles);
  const business = new BusinessDirectoryService(businessRepository);
  const customerRepository = new InMemoryCustomerRepository();
  const customers = new DefaultCustomerService(
    customerRepository,
    () => ids.generate("customer"),
  );
  const appointmentRepository = new InMemoryAppointmentRepository();
  const calendar = options.calendar ?? new InMemoryCalendarAdapter();

  const customerReader: CustomerReader = {
    exists: async (candidateTenantId, customerId) =>
      (await customerRepository.findById(candidateTenantId, customerId)) !== null,
    get: async (candidateTenantId, customerId) => {
      const customer = await customerRepository.findById(candidateTenantId, customerId);
      return customer ? { name: customer.name, phone: customer.phone } : null;
    },
  };
  const workingHours: EmployeeWorkingHoursProvider = {
    getWorkingHours: async ({ tenantId: candidateTenantId, employeeId }) => {
      const profile = await business.getBusinessProfile(candidateTenantId);
      if (!profile.ok || !profile.value.employees.some((employee) => employee.id === employeeId && employee.active)) return [];
      return profile.value.openingHours.map((rule) => ({ ...rule }));
    },
  };
  const confirmedAppointments: ConfirmedAppointmentReader = {
    findConfirmedIntervals: async () => [],
  };
  const scheduling = new SchedulingServiceImpl(
    business,
    workingHours,
    confirmedAppointments,
    calendar,
    clock,
  );
  const appointments = new AppointmentServiceImpl(
    appointmentRepository,
    customerReader,
    business,
    scheduling,
    calendar,
    new InMemoryAppointmentConcurrencyGuard(),
    () => ids.generate("appointment"),
  );
  const transfer = options.humanTransfer ?? unavailableTransfer;
  const tools = new ToolExecutorImpl(scheduling, appointments, transfer, business, clock, customers);
  const configurationRepository = options.agentConfigurationRepository ?? new InMemoryAgentConfigurationSource(profiles.map((profile) => ({
      tenantId: profile.tenantId,
      configuration: {
        instructions: [
          `You are the phone receptionist for ${profile.name}.`,
          "Speak warmly and naturally, using complete sentences and a conversational rhythm.",
        "Be concise, but never cut off a sentence or end abruptly.",
        "Do not sound like a script and do not recite unnecessary lists.",
        "For booking, first use check_availability. Once the caller selects an available time, use create_appointment and only confirm the booking after the tool confirms it.",
        ].join(" "),
        locale: profile.locale,
        voice: config.conversationVoice,
        enabledTools: AGENT_TOOL_DEFINITIONS.map((tool) => tool.name),
        conversation: {
          model: config.openAiRealtimeModel,
          maxOutputTokens: config.maxOutputTokens,
          reasoningEffort: "minimal",
          turnDetection: {
            ...(config.vadThreshold === undefined ? {} : { threshold: config.vadThreshold }),
            ...(config.vadPrefixPaddingMs === undefined ? {} : { prefixPaddingMs: config.vadPrefixPaddingMs }),
            ...(config.vadSilenceDurationMs === undefined ? {} : { silenceDurationMs: config.vadSilenceDurationMs }),
          },
        },
      },
    })));
  const agentConfiguration = new AgentConfigurationService(configurationRepository);
  const agentDefinitions = new AgentDefinitionService(configurationRepository, tools);
  const conversations = new ConversationService({
    runtime,
    ...(options.usageRecorder ? { usageRecorder: options.usageRecorder } : {}),
  });
  const voice = options.voice ?? new ScriptedVoiceMediaGateway();
  const telephony = options.telephony ?? new InMemoryCallTelephonyGateway();
  const callRepository = options.callRepository ?? new InMemoryCallRepository();
  const calls = new CallOrchestratorService(
    business,
    customers,
    telephony,
    agentDefinitions,
    voice,
    conversations,
    callRepository,
  );
  const eventSource = telephony as CallTelephonyGateway & {
    onEvent?(handler: (event: import("../modules/telephony/index.js").TelephonyEvent) => Promise<void>): void;
  };
  eventSource.onEvent?.((event) => calls.handleTelephonyEvent(event));

  return {
    tenantId,
    config,
    business,
    customers,
    scheduling,
    appointments,
    tools,
    agents: agentDefinitions,
    agentConfiguration,
    conversations,
    calls,
    callHistory: callRepository,
    runtime,
    voice,
    calendar,
    telephony,
    ids,
    ...(billing ? { billing } : {}),
    ...(options.googleOAuth ? { googleOAuth: options.googleOAuth } : {}),
    registerCallMedia: (callId, transport) => {
      if (!(voice instanceof ScriptedVoiceMediaGateway)) {
        throw new Error("Call media is supplied by the live telephony transport in this runtime");
      }
      voice.register(callId, transport);
    },
  };
}

const systemClock: Clock = { now: () => new Date() };
const uuidGenerator: IdGenerator = { generate: (scope) => `${scope}-${randomUUID()}` };
const unavailableTransfer: HumanTransferPort = {
  transferToConfiguredDestination: async () => failure({
    code: "DESTINATION_NOT_CONFIGURED" as const,
    retryable: false,
  }),
};

function selectRuntime(
  config: ApplicationConfiguration,
  injected: ConversationRuntimePort | undefined,
): ConversationRuntimePort {
  if (injected) return injected;
  if (config.runtime === "in-memory") return new ScriptedConversationRuntime();
  if (!config.openAiApiKey) {
    throw new Error("OPENAI_API_KEY is required when YIBO_RUNTIME=openai-realtime");
  }
  return new OpenAIRealtimeAdapter({
    apiKey: config.openAiApiKey,
    model: config.openAiRealtimeModel,
    maxOutputTokens: config.maxOutputTokens,
    turnDetection: {
      ...(config.vadThreshold === undefined ? {} : { threshold: config.vadThreshold }),
      ...(config.vadPrefixPaddingMs === undefined ? {} : { prefixPaddingMs: config.vadPrefixPaddingMs }),
      ...(config.vadSilenceDurationMs === undefined ? {} : { silenceDurationMs: config.vadSilenceDurationMs }),
    },
  });
}
