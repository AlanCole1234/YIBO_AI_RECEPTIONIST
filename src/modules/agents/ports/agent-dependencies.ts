import type { Result } from "../../../shared/domain/result.js";
import type { CallId, LocationId, TenantId } from "../../../shared/types/identifiers.js";
import type { AgentToolName, ConversationBehavior } from "../application/contracts.js";

export interface AgentConfiguration {
  schemaVersion: 1;
  instructions: string;
  locale: string;
  voice?: string;
  enabledTools: AgentToolName[];
  conversation: ConversationBehavior;
}

export interface LegacyAgentConfiguration {
  schemaVersion?: undefined;
  instructions: string;
  locale: string;
  voice?: string;
  enabledTools: AgentToolName[];
  conversation: ConversationBehavior;
}

export type VersionedAgentConfiguration = AgentConfiguration | LegacyAgentConfiguration;

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
