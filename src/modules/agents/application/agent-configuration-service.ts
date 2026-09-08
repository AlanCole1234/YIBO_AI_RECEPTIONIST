import type { TenantId } from "../../../shared/types/identifiers.js";
import type { AgentConfiguration, AgentConfigurationRepository } from "../ports/agent-dependencies.js";
import { AGENT_TOOL_DEFINITIONS } from "./tool-definitions.js";

export interface AgentConfigurationServiceContract {
  get(tenantId: TenantId): Promise<AgentConfiguration | null>;
  update(tenantId: TenantId, configuration: AgentConfiguration): Promise<AgentConfiguration>;
  recommended(locale: string, businessName: string, model: string): AgentConfiguration;
}

export class AgentConfigurationService implements AgentConfigurationServiceContract {
  constructor(private readonly repository: AgentConfigurationRepository) {}

  get(tenantId: TenantId): Promise<AgentConfiguration | null> {
    return this.repository.getConfiguration(tenantId);
  }

  async update(tenantId: TenantId, configuration: AgentConfiguration): Promise<AgentConfiguration> {
    const validated = validateConfiguration(configuration);
    await this.repository.saveConfiguration(tenantId, validated);
    return structuredClone(validated);
  }

  recommended(locale: string, businessName: string, model: string): AgentConfiguration {
    return {
      instructions: [
        `You are the phone receptionist for ${businessName}.`,
        "Speak warmly and naturally, using complete sentences and a conversational rhythm.",
        "Be concise, but never cut off a sentence or end abruptly.",
        "Confirm important details before making changes and never invent availability.",
        "For a new booking, ask only: 'What day would you like to come in?' Wait for the answer before asking anything else. Resolve supported day phrases with check_availability, offer only the earliest available time first, and keep each reply to one or two short sentences. After the caller accepts an available time, collect the required contact details one question at a time, then create the appointment and confirm it only when the booking succeeds.",
      ].join(" "),
      locale,
      voice: "marin",
        enabledTools: AGENT_TOOL_DEFINITIONS
          .filter((tool) => tool.name !== "enable_developer_test_mode" && tool.name !== "delete_test_appointments")
          .map((tool) => tool.name),
      conversation: {
        model,
        maxOutputTokens: 512,
        reasoningEffort: "minimal",
        turnDetection: {},
      },
    };
  }
}

function validateConfiguration(value: AgentConfiguration): AgentConfiguration {
  if (!value.instructions.trim()) throw new Error("instructions are required");
  if (!value.locale.trim()) throw new Error("locale is required");
  if (!value.conversation.model.trim()) throw new Error("conversation.model is required");
  if (!Number.isInteger(value.conversation.maxOutputTokens)
    || value.conversation.maxOutputTokens < 1
    || value.conversation.maxOutputTokens > 4096) {
    throw new Error("conversation.maxOutputTokens must be an integer between 1 and 4096");
  }
  const allowedTools = new Set(AGENT_TOOL_DEFINITIONS.map((tool) => tool.name));
  if (new Set(value.enabledTools).size !== value.enabledTools.length
    || value.enabledTools.some((tool) => !allowedTools.has(tool))) {
    throw new Error("enabledTools contains an unknown or duplicate tool");
  }
  const { threshold, prefixPaddingMs, silenceDurationMs } = value.conversation.turnDetection;
  if (threshold !== undefined && (!Number.isFinite(threshold) || threshold < 0 || threshold > 1)) {
    throw new Error("turnDetection.threshold must be between 0 and 1");
  }
  for (const [name, candidate] of [["prefixPaddingMs", prefixPaddingMs], ["silenceDurationMs", silenceDurationMs]] as const) {
    if (candidate !== undefined && (!Number.isInteger(candidate) || candidate < 0)) {
      throw new Error(`turnDetection.${name} must be a non-negative integer`);
    }
  }
  return structuredClone(value);
}
