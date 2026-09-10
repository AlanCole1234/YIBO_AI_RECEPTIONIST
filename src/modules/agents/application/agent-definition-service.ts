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

export class AgentDefinitionService implements AgentDefinitionFactory {
  constructor(
    private readonly configuration: AgentConfigurationSource,
    private readonly toolExecutor: ToolExecutor,
  ) {}

  async prepare(command: PrepareAgentDefinitionCommand) {
    const configuration = await this.configuration.getConfiguration(command.tenantId);
    if (!configuration) {
      return failure<AgentDefinitionError>({ code: "CONFIGURATION_NOT_FOUND" });
    }

    const definition: AgentDefinition = {
      instructions: configuration.instructions,
      locale: configuration.locale,
      ...(configuration.voice ? { voice: configuration.voice } : {}),
      conversation: structuredClone(configuration.conversation),
      tools: AGENT_TOOL_DEFINITIONS.filter((tool) => configuration.enabledTools.includes(tool.name)),
      toolExecutor: this.toolExecutor,
      trustedContext: { ...command },
    };
    return success(definition);
  }
}
