import { failure, success } from "../../../shared/domain/result.js";
import type { AgentConfigurationSource } from "../ports/agent-dependencies.js";
import type {
  AgentDefinition,
  AgentDefinitionError,
  AgentDefinitionFactory,
  PrepareAgentDefinitionCommand,
  ToolExecutor,
} from "./contracts.js";
import { AGENT_TOOL_DEFINITIONS } from "./tool-definitions.js";
import type { BusinessDirectory } from "../../business/index.js";
import { AgentPromptCompiler } from "./agent-prompt-compiler.js";

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

    const instructions = this.prompts.compile({
      editableInstructions: configuration.identity.instructions,
      locale: configuration.identity.locale,
      businessName: location.value.business.name,
      locationName: location.value.location.name,
      locationTimezone: location.value.location.timezone,
      enabledTools: configuration.enabledTools,
    });

    const definition: AgentDefinition = {
      instructions,
      locale: configuration.identity.locale,
      voice: configuration.audio.voice,
      conversation: structuredClone(configuration.conversation),
      audio: structuredClone(configuration.audio),
      tools: AGENT_TOOL_DEFINITIONS.filter((tool) =>
        isDeveloperTestTool(tool.name)
          ? command.developerTestModeAuthorized
          : configuration.enabledTools.includes(tool.name),
      ),
      toolExecutor: this.toolExecutor,
      trustedContext: { ...command },
    };
    return success(definition);
  }
}

const isDeveloperTestTool = (name: string): boolean =>
  name === "enable_developer_test_mode" || name === "delete_test_appointments";
