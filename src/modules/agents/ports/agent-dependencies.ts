import type { Result } from "../../../shared/domain/result.js";
import type { CallId, LocationId, TenantId } from "../../../shared/types/identifiers.js";
import type {
  AgentAudioConfiguration,
  AgentConversationConfiguration,
  AgentToolName,
} from "../application/contracts.js";

export interface AgentConfiguration {
  schemaVersion: 2;
  identity: {
    instructions: string;
    locale: string;
  };
  conversation: AgentConversationConfiguration;
  audio: AgentAudioConfiguration;
  enabledTools: AgentToolName[];
}

export interface AgentConfigurationV1 {
  schemaVersion: 1;
  instructions: string;
  locale: string;
  voice?: string;
  enabledTools: AgentToolName[];
  conversation: LegacyConversationBehavior;
}

export interface LegacyAgentConfiguration {
  schemaVersion?: undefined;
  instructions: string;
  locale: string;
  voice?: string;
  enabledTools: AgentToolName[];
  conversation: LegacyConversationBehavior;
}

export interface LegacyConversationBehavior {
  model: string;
  maxOutputTokens: number;
  reasoningEffort: "minimal" | "low" | "medium" | "high";
  turnDetection: {
    threshold?: number;
    prefixPaddingMs?: number;
    silenceDurationMs?: number;
  };
}

export type VersionedAgentConfiguration = AgentConfiguration | AgentConfigurationV1 | LegacyAgentConfiguration;

export interface AgentConfigurationSource {
  getConfiguration(tenantId: TenantId): Promise<AgentConfiguration | null>;
}

export interface AgentConfigurationRepository extends AgentConfigurationSource {
  saveConfiguration(tenantId: TenantId, configuration: AgentConfiguration): Promise<void>;
}

export interface HumanTransferPort {
  transferToConfiguredDestination(input: {
    tenantId: TenantId;
    locationId: LocationId;
    callId: CallId;
  }): Promise<Result<void, { code: "DESTINATION_NOT_CONFIGURED" | "TRANSFER_FAILED"; retryable: boolean }>>;
}
