import { PhoneReadbackToolExecutor } from "./phone-readback.js";
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
import { PriceDisclosureToolExecutor, resolveBusinessAgentPolicy } from "./business-agent-policy.js";

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
    const effective = resolveBusinessAgentPolicy(configuration, location.value.location);
    const disabledTools = new Set<string>(effective.disabledTools);
    const channelTools = new Set(channelPolicy.toolChoice === "none" ? [] : channelPolicy.enabledTools);
    const tools = AGENT_TOOL_DEFINITIONS.filter((tool) =>
      isDeveloperTestTool(tool.name)
        ? command.developerTestModeAuthorized && channelPolicy.toolChoice !== "none"
        : configuration.enabledTools.includes(tool.name) && channelTools.has(tool.name) && !disabledTools.has(tool.name),
    );
    const confirmationRequiredFor = configuration.toolPolicies.confirmations.requiredFor
      .filter((name) => tools.some((tool) => tool.name === name));
    const instructions = this.prompts.compile({
      editableInstructions: configuration.identity.instructions,
      locale: effective.locale,
      businessName: location.value.business.name,
      locationName: location.value.location.name,
      locationTimezone: location.value.location.timezone,
      enabledTools: tools.map(({ name }) => name),
      confirmationRequiredFor,
      behavior: effective.behavior,
    });

    const definition: AgentDefinition = {
      instructions,
      locale: effective.locale,
      voice: configuration.audio.voice,
      conversation: structuredClone(configuration.conversation),
      audio: structuredClone(configuration.audio),
      behavior: effective.behavior,
      // A location may remove the channel's last tool. Never require an impossible call.
      toolChoice: tools.length === 0 && channelPolicy.toolChoice === "required" ? "auto" : channelPolicy.toolChoice,
      parallelToolCalls: channelPolicy.parallelToolCalls,
      channel,
      tools,
      toolExecutor: new ConfirmationGateToolExecutor(
        new PolicyEnforcingToolExecutor(
          new PriceDisclosureToolExecutor(
            new PhoneReadbackToolExecutor(this.toolExecutor, effective.behavior.phoneReadback),
            effective.behavior.allowPriceDisclosure,
          ),
          tools.map(({ name }) => name),
          configuration.toolPolicies,
        ),
        confirmationRequiredFor,
      ),
      trustedContext: { ...command },
    };
    return success(definition);
  }
}
