import type { TenantId } from "../../../shared/types/identifiers.js";
import type { AgentConfiguration, AgentConfigurationRepository, VersionedAgentConfiguration } from "../ports/agent-dependencies.js";
import { AGENT_TOOL_DEFINITIONS } from "./tool-definitions.js";
import {
  createDefaultAgentConfiguration,
  type DefaultAgentConfigurationInput,
} from "./agent-configuration-defaults.js";
import { AGENT_CONFIGURATION_SCHEMA_VERSION, upgradeAgentConfiguration } from "./upgrade-agent-configuration.js";
import {
  RealtimeModelCapabilityRegistry,
  type RealtimeModelCapability,
} from "./model-capability-registry.js";

export interface AgentConfigurationServiceContract {
  get(tenantId: TenantId): Promise<AgentConfiguration | null>;
  update(tenantId: TenantId, configuration: VersionedAgentConfiguration): Promise<AgentConfiguration>;
  recommended(
    locale: string,
    businessName: string,
    model: string,
    overrides?: Omit<DefaultAgentConfigurationInput, "locale" | "businessName" | "model">,
  ): AgentConfiguration;
  modelCapabilities(): RealtimeModelCapability[];
}

export class AgentConfigurationService implements AgentConfigurationServiceContract {
  constructor(
    private readonly repository: AgentConfigurationRepository,
    private readonly capabilityRegistry = new RealtimeModelCapabilityRegistry(),
  ) {}

  get(tenantId: TenantId): Promise<AgentConfiguration | null> {
    return this.repository.getConfiguration(tenantId);
  }

  async update(tenantId: TenantId, configuration: VersionedAgentConfiguration): Promise<AgentConfiguration> {
    const validated = validateConfiguration(upgradeAgentConfiguration(configuration), this.capabilityRegistry);
    await this.repository.saveConfiguration(tenantId, validated);
    return structuredClone(validated);
  }

  recommended(
    locale: string,
    businessName: string,
    model: string,
    overrides: Omit<DefaultAgentConfigurationInput, "locale" | "businessName" | "model"> = {},
  ): AgentConfiguration {
    return validateConfiguration(
      createDefaultAgentConfiguration({ locale, businessName, model, ...overrides }),
      this.capabilityRegistry,
    );
  }

  modelCapabilities(): RealtimeModelCapability[] {
    return this.capabilityRegistry.list();
  }
}

function validateConfiguration(
  value: AgentConfiguration,
  capabilityRegistry: RealtimeModelCapabilityRegistry,
): AgentConfiguration {
  if (value.schemaVersion !== AGENT_CONFIGURATION_SCHEMA_VERSION) throw new Error("unsupported agent configuration schemaVersion");
  if (!value.identity.instructions.trim()) throw new Error("identity.instructions are required");
  if (!value.identity.locale.trim()) throw new Error("identity.locale is required");
  if (!value.conversation.model.trim()) throw new Error("conversation.model is required");
  const allowedTools = new Set(AGENT_TOOL_DEFINITIONS.map((tool) => tool.name));
  if (new Set(value.enabledTools).size !== value.enabledTools.length
    || value.enabledTools.some((tool) => !allowedTools.has(tool))) {
    throw new Error("enabledTools contains an unknown or duplicate tool");
  }
  capabilityRegistry.validate(value);
  validateConversationControls(value);
  return structuredClone(value);
}

function validateConversationControls(value: AgentConfiguration): void {
  const turn = value.audio.turnDetection;
  if (turn.type === "server_vad" && turn.idleTimeoutMs !== undefined && turn.idleTimeoutMs !== null
    && (!Number.isInteger(turn.idleTimeoutMs) || turn.idleTimeoutMs < 1 || turn.idleTimeoutMs > 120_000)) {
    throw new Error("audio.turnDetection.idleTimeoutMs must be between 1 and 120000");
  }
  const truncation = value.conversation.truncation;
  if (truncation.mode === "retention_ratio") {
    if (!Number.isFinite(truncation.retentionRatio)
      || truncation.retentionRatio <= 0
      || truncation.retentionRatio > 1) {
      throw new Error("conversation.truncation.retentionRatio must be greater than 0 and at most 1");
    }
    if (truncation.postInstructionsTokens !== undefined
      && (!Number.isInteger(truncation.postInstructionsTokens)
        || truncation.postInstructionsTokens < 1
        || truncation.postInstructionsTokens > 127_999)) {
      throw new Error("conversation.truncation.postInstructionsTokens must be between 1 and 127999");
    }
  }
}
