import { failure, success } from "../../../shared/domain/result.js";
import type { AgentConfigurationSource } from "../ports/agent-dependencies.js";
import type {
  AgentDefinition,
  AgentDefinitionError,
  AgentDefinitionFactory,
  PrepareAgentDefinitionCommand,
  ToolExecutor,
} from "./contracts.js";
import { AGENT_TOOL_DEFINITIONS, isDeveloperTestTool } from "./tool-definitions.js";
import type { BusinessDirectory } from "../../business/index.js";
import { AgentPromptCompiler } from "./agent-prompt-compiler.js";
import { PolicyEnforcingToolExecutor } from "./policy-enforcing-tool-executor.js";
import { ConfirmationGateToolExecutor } from "./confirmation-gate-tool-executor.js";

export class AgentDefinitionService implements AgentDefinitionFactory {
  constructor(
    private readonly configuration: AgentConfigurationSource,
    private readonly toolExecutor: ToolExecutor,
    private readonly businesses: BusinessDirectory,
    private readonly prompts: AgentPromptCompiler = new AgentPromptCompiler(),
  ) {}

  async prepare(command: PrepareAgentDefinitionCommand) {
    const configuration = await this.configuration.getConfiguration(command.tenantId);
    if (!configuration) {
      return failure<AgentDefinitionError>({ code: "CONFIGURATION_NOT_FOUND" });
    }
    const location = await this.businesses.getLocation(command.tenantId, command.locationId);
    if (!location.ok) return failure<AgentDefinitionError>({ code: "BUSINESS_CONTEXT_NOT_FOUND" });

    const channel = command.developerTestModeAuthorized ? "voice_lab" : "phone";
    if (channel === "phone" && configuration.audio.turnDetection.type === "manual") {
      return failure<AgentDefinitionError>({ code: "CHANNEL_CONFIGURATION_INCOMPATIBLE" });
    }
    const channelPolicy = configuration.toolPolicies.channels[channel];
    const channelTools = new Set(channelPolicy.toolChoice === "none" ? [] : channelPolicy.enabledTools);
    const tools = AGENT_TOOL_DEFINITIONS.filter((tool) =>
      isDeveloperTestTool(tool.name)
        ? command.developerTestModeAuthorized && channelPolicy.toolChoice !== "none"
        : configuration.enabledTools.includes(tool.name) && channelTools.has(tool.name),
    );
    const instructions = this.prompts.compile({
      editableInstructions: configuration.identity.instructions,
      locale: configuration.identity.locale,
      businessName: location.value.business.name,
      locationName: location.value.location.name,
      locationTimezone: location.value.location.timezone,
      enabledTools: tools.map(({ name }) => name),
      confirmationRequiredFor: configuration.toolPolicies.confirmations.requiredFor
        .filter((name) => tools.some((tool) => tool.name === name)),
      behavior: configuration.behavior,
    });

    const definition: AgentDefinition = {
      instructions,
      locale: configuration.identity.locale,
      voice: configuration.audio.voice,
      conversation: structuredClone(configuration.conversation),
      audio: structuredClone(configuration.audio),
      behavior: structuredClone(configuration.behavior),
      toolChoice: channelPolicy.toolChoice,
      parallelToolCalls: channelPolicy.parallelToolCalls,
      channel,
      tools,
      toolExecutor: new ConfirmationGateToolExecutor(
        new PolicyEnforcingToolExecutor(
          this.toolExecutor,
          tools.map(({ name }) => name),
          configuration.toolPolicies,
        ),
        configuration.toolPolicies.confirmations.requiredFor,
      ),
      trustedContext: { ...command },
    };
    return success(definition);
  }
}
