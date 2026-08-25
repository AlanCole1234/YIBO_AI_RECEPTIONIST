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
  type CustomerReader,
} from "../modules/appointments/index.js";
import {
  BusinessDirectoryService,
  InMemoryBusinessRepository,
  type BusinessDirectory,
  type BusinessProfile,
} from "../modules/business/index.js";
import {
  CallOrchestratorService,
  InMemoryCallRepository,
  type CallOrchestrator,
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
import { InMemoryCalendarAdapter } from "../modules/integrations/index.js";
import {
  SchedulingServiceImpl,
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
  runtime: ConversationRuntimePort;
  voice: VoiceMediaGateway;
  calendar: InMemoryCalendarAdapter;
  telephony: InMemoryCallTelephonyGateway;
  ids: IdGenerator;
  registerCallMedia(callId: string, transport: ConversationTransport): void;
}

export interface BuildApplicationOptions {
  environment?: NodeJS.ProcessEnv;
  config?: ApplicationConfiguration;
  tenantId?: string;
  businesses?: BusinessProfile[];
  clock?: Clock;
  ids?: IdGenerator;
  runtime?: ConversationRuntimePort;
  humanTransfer?: HumanTransferPort;
  agentConfigurationRepository?: AgentConfigurationRepository;
  usageRecorder?: ConversationUsageRecorder;
}

export function buildApplication(options: BuildApplicationOptions = {}): YiboApplication {
  const config = options.config ?? loadConfiguration(options.environment);
  const clock = options.clock ?? systemClock;
  const ids = options.ids ?? uuidGenerator;
  const profiles = options.businesses ?? [DEVELOPMENT_BUSINESS, DEVELOPMENT_US_BUSINESS];
  const tenantId = options.tenantId ?? DEVELOPMENT_BUSINESS.tenantId;
  const tenant = profiles.find((profile) => profile.tenantId === tenantId);
  if (!tenant) throw new Error(`Unknown bootstrap tenant: ${tenantId}`);

  const runtime = selectRuntime(config, options.runtime);
  const businessRepository = new InMemoryBusinessRepository(profiles);
  const business = new BusinessDirectoryService(businessRepository);
  const customerRepository = new InMemoryCustomerRepository();
  const customers = new DefaultCustomerService(
    customerRepository,
    () => ids.generate("customer"),
  );
  const appointmentRepository = new InMemoryAppointmentRepository();
  const calendar = new InMemoryCalendarAdapter();

  const customerReader: CustomerReader = {
    exists: async (candidateTenantId, customerId) =>
      (await customerRepository.findById(candidateTenantId, customerId)) !== null,
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
  const tools = new ToolExecutorImpl(scheduling, appointments, transfer);
  const configurationRepository = options.agentConfigurationRepository ?? new InMemoryAgentConfigurationSource(profiles.map((profile) => ({
      tenantId: profile.tenantId,
      configuration: {
        instructions: [
          `You are the phone receptionist for ${profile.name}.`,
          "Speak warmly and naturally, using complete sentences and a conversational rhythm.",
          "Be concise, but never cut off a sentence or end abruptly.",
          "Do not sound like a script and do not recite unnecessary lists.",
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
  const voice = new ScriptedVoiceMediaGateway();
  const telephony = new InMemoryCallTelephonyGateway();
  const callRepository = new InMemoryCallRepository();
  const calls = new CallOrchestratorService(
    business,
    customers,
    telephony,
    agentDefinitions,
    voice,
    conversations,
    callRepository,
  );

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
    runtime,
    voice,
    calendar,
    telephony,
    ids,
    registerCallMedia: (callId, transport) => voice.register(callId, transport),
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
