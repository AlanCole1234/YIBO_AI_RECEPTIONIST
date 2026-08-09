import { failure, success } from "../../../shared/domain/result.js";
import type {
  AgentAIProvider,
  AgentConfigurationProvider,
} from "../ports/agent-dependencies.js";
import type {
  AgentError,
  AgentRuntime,
  AgentSession,
  StartAgentSessionCommand,
  ToolExecutor,
} from "./contracts.js";
import { AGENT_TOOL_DEFINITIONS } from "./tool-definitions.js";

export class AgentRuntimeImpl implements AgentRuntime {
  constructor(
    private readonly configuration: AgentConfigurationProvider,
    private readonly provider: AgentAIProvider,
    private readonly tools: ToolExecutor,
  ) {}

  async startSession(command: StartAgentSessionCommand) {
    const configuration = await this.configuration.getConfiguration(command.tenantId);
    if (!configuration) return failure<AgentError>({ code: "CONFIGURATION_NOT_FOUND" });
    const opened = await this.provider.openSession({
      callId: command.callId,
      tenantId: command.tenantId,
      instructions: configuration.instructions,
      locale: configuration.locale,
      ...(configuration.voice ? { voice: configuration.voice } : {}),
      tools: AGENT_TOOL_DEFINITIONS,
    });
    if (!opened.ok) {
      return failure<AgentError>({
        code: "AI_PROVIDER_UNAVAILABLE",
        retryable: opened.error.code === "PROVIDER_UNAVAILABLE" ? opened.error.retryable : opened.error.code === "RATE_LIMITED",
      });
    }
    const providerSession = opened.value;
    providerSession.onToolCall(async (call) => {
      const result = await this.tools.execute(command, call);
      await providerSession.sendToolResult(result);
    });
    const session: AgentSession = {
      callId: command.callId,
      tenantId: command.tenantId,
      close: () => providerSession.close(),
    };
    return success(session);
  }
}
