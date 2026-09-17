import { createHash } from "node:crypto";
import type { TenantId } from "../../../shared/types/identifiers.js";
import type { AgentConfiguration, AgentConfigurationRepository, VersionedAgentConfiguration } from "../ports/agent-dependencies.js";
import type { AgentDataCollectionField, AgentToolName } from "./contracts.js";
import { AGENT_TOOL_DEFINITIONS, PUBLIC_AGENT_TOOL_DEFINITIONS } from "./tool-definitions.js";
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
  update(tenantId: TenantId, configuration: VersionedAgentConfiguration, expectedRevision?: string): Promise<AgentConfiguration>;
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

  async update(tenantId: TenantId, configuration: VersionedAgentConfiguration, expectedRevision?: string): Promise<AgentConfiguration> {
    const validated = validateConfiguration(upgradeAgentConfiguration(configuration), this.capabilityRegistry);
    if (expectedRevision !== undefined) {
      const current = await this.repository.getConfiguration(tenantId);
      if (agentConfigurationRevision(current) !== expectedRevision
        || !await this.repository.compareAndSaveConfiguration(tenantId, validated, current)) throw new AgentConfigurationConflict();
    } else await this.repository.saveConfiguration(tenantId, validated);
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
  const allowedTools = new Set(PUBLIC_AGENT_TOOL_DEFINITIONS.map((tool) => tool.name));
  if (new Set(value.enabledTools).size !== value.enabledTools.length
    || value.enabledTools.some((tool) => !allowedTools.has(tool))) {
    throw new Error("enabledTools contains an unknown or duplicate tool");
  }
  capabilityRegistry.validate(value);
  validateConversationControls(value);
  validateBehavior(value);
  validateToolPolicies(value);
  return structuredClone(value);
}

function validateToolPolicies(value: AgentConfiguration): void {
  const { toolPolicies } = value;
  const enabled = new Set(value.enabledTools);
  for (const [channel, policy] of Object.entries(toolPolicies.channels)) {
    if (new Set(policy.enabledTools).size !== policy.enabledTools.length
      || policy.enabledTools.some((tool) => !enabled.has(tool))) {
      throw new Error(`toolPolicies.channels.${channel}.enabledTools must be a unique subset of enabledTools`);
    }
    if (policy.toolChoice === "required" && policy.enabledTools.length === 0) {
      throw new Error(`toolPolicies.channels.${channel}.toolChoice cannot be required without tools`);
    }
    if (policy.parallelToolCalls) {
      const mutatingTool = policy.enabledTools.find((name) =>
        AGENT_TOOL_DEFINITIONS.find((definition) => definition.name === name)?.presentation?.kind !== "consult");
      if (mutatingTool || (channel === "voice_lab" && policy.toolChoice !== "none")) {
        throw new Error(`toolPolicies.channels.${channel}.parallelToolCalls requires read-only tools only`);
      }
    }
  }
  if (!Number.isInteger(toolPolicies.limits.totalPerCall)
    || toolPolicies.limits.totalPerCall < 1
    || toolPolicies.limits.totalPerCall > 100) {
    throw new Error("toolPolicies.limits.totalPerCall must be an integer between 1 and 100");
  }
  for (const [tool, limit] of Object.entries(toolPolicies.limits.perTool)) {
    if (!enabled.has(tool as AgentToolName) || !Number.isInteger(limit) || limit! < 1 || limit! > 100) {
      throw new Error("toolPolicies.limits.perTool must reference enabled tools with limits between 1 and 100");
    }
  }
  if (!Number.isInteger(toolPolicies.externalRetryAttempts)
    || toolPolicies.externalRetryAttempts < 1
    || toolPolicies.externalRetryAttempts > 3) {
    throw new Error("toolPolicies.externalRetryAttempts must be an integer between 1 and 3");
  }
  if ((toolPolicies.automaticTransfer.onLimitReached || toolPolicies.automaticTransfer.onRetryableFailure)
    && Object.values(toolPolicies.channels).some((channel) =>
      channel.enabledTools.length > 0 && !channel.enabledTools.includes("transfer_to_human"))) {
    throw new Error("automatic transfer requires transfer_to_human in every active channel");
  }
  const confirmations = toolPolicies.confirmations.requiredFor;
  if (new Set(confirmations).size !== confirmations.length
    || confirmations.some((tool) => !enabled.has(tool)
      || AGENT_TOOL_DEFINITIONS.find(({ name }) => name === tool)?.presentation?.kind !== "mutate")) {
    throw new Error("toolPolicies.confirmations.requiredFor must be unique enabled mutation tools");
  }
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

function validateBehavior(value: AgentConfiguration): void {
  const { behavior } = value;
  if (behavior.greeting.mode === "automatic" && !behavior.greeting.message.trim()) {
    throw new Error("behavior.greeting.message is required for an automatic greeting");
  }
  if (!behavior.silence.message.trim()) throw new Error("behavior.silence.message is required");
  if (!Number.isInteger(behavior.silence.maxPrompts)
    || behavior.silence.maxPrompts < 0
    || behavior.silence.maxPrompts > 3) {
    throw new Error("behavior.silence.maxPrompts must be an integer between 0 and 3");
  }
  if (!Number.isInteger(behavior.slotOffering.maximumOptions)
    || behavior.slotOffering.maximumOptions < 1
    || behavior.slotOffering.maximumOptions > 5) {
    throw new Error("behavior.slotOffering.maximumOptions must be an integer between 1 and 5");
  }
  const requiredFields: AgentDataCollectionField[] = ["full_name", "phone_number", "service"];
  if (behavior.dataCollectionOrder.length !== requiredFields.length
    || new Set(behavior.dataCollectionOrder).size !== requiredFields.length
    || requiredFields.some((field) => !behavior.dataCollectionOrder.includes(field))) {
    throw new Error("behavior.dataCollectionOrder must contain full_name, phone_number and service exactly once");
  }
}

/** Content revision is independent of the schema version and never enters provider payloads. */
export const agentConfigurationRevision = (configuration: AgentConfiguration | null): string =>
  createHash("sha256").update(JSON.stringify(configuration)).digest("hex");
export class AgentConfigurationConflict extends Error {}
