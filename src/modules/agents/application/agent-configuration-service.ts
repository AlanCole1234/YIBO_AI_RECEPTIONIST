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
  if (!value.instructions.trim()) throw new Error("instructions are required");
  if (!value.locale.trim()) throw new Error("locale is required");
  if (!value.conversation.model.trim()) throw new Error("conversation.model is required");
  const allowedTools = new Set(AGENT_TOOL_DEFINITIONS.map((tool) => tool.name));
  if (new Set(value.enabledTools).size !== value.enabledTools.length
    || value.enabledTools.some((tool) => !allowedTools.has(tool))) {
    throw new Error("enabledTools contains an unknown or duplicate tool");
  }
  capabilityRegistry.validate(value);
  return structuredClone(value);
}
