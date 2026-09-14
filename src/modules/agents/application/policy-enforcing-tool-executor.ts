import type {
  AgentToolCall,
  AgentToolName,
  AgentToolPoliciesConfiguration,
  AgentToolResult,
  ToolExecutionContext,
  ToolExecutor,
} from "./contracts.js";

export class PolicyEnforcingToolExecutor implements ToolExecutor {
  private totalCalls = 0;
  private readonly callsByTool = new Map<AgentToolName, number>();
  private readonly enabledTools: Set<AgentToolName>;

  constructor(
    private readonly delegate: ToolExecutor,
    enabledTools: AgentToolName[],
    private readonly policy: AgentToolPoliciesConfiguration,
  ) {
    this.enabledTools = new Set(enabledTools);
  }

  async execute(context: ToolExecutionContext, call: AgentToolCall): Promise<AgentToolResult> {
    if (!this.enabledTools.has(call.name)) {
      return failure(call, "TOOL_DISABLED", "This tool is disabled for the current channel.");
    }
    const perToolCalls = this.callsByTool.get(call.name) ?? 0;
    const perToolLimit = this.policy.limits.perTool[call.name];
    if (this.totalCalls >= this.policy.limits.totalPerCall
      || (perToolLimit !== undefined && perToolCalls >= perToolLimit)) {
      const transferred = this.policy.automaticTransfer.onLimitReached
        ? await this.tryAutomaticTransfer(context, call)
        : false;
      return failure(
        call,
        "TOOL_CALL_LIMIT_REACHED",
        transferred
          ? "The configured tool limit was reached and a transfer to a person has started."
          : "The configured tool limit was reached. Do not retry this tool.",
      );
    }

    this.totalCalls += 1;
    this.callsByTool.set(call.name, perToolCalls + 1);
    let result = await this.delegate.execute(context, call);
    for (let attempt = 1; !result.ok && result.error.retryable
      && attempt < this.policy.externalRetryAttempts; attempt += 1) {
      result = await this.delegate.execute(context, call);
    }
    if (!result.ok && result.error.retryable && this.policy.automaticTransfer.onRetryableFailure) {
      const transferred = await this.tryAutomaticTransfer(context, call);
      if (transferred) {
        return {
          ...result,
          error: {
            ...result.error,
            retryable: false,
            messageForAgent: `${result.error.messageForAgent} A transfer to a person has started.`,
          },
        };
      }
    }
    return result;
  }

  private async tryAutomaticTransfer(context: ToolExecutionContext, source: AgentToolCall): Promise<boolean> {
    if (source.name === "transfer_to_human" || !this.enabledTools.has("transfer_to_human")) return false;
    const result = await this.delegate.execute(context, {
      toolCallId: `${source.toolCallId}:automatic-transfer`,
      name: "transfer_to_human",
      arguments: {},
    });
    return result.ok;
  }
}

function failure(call: AgentToolCall, code: string, messageForAgent: string): AgentToolResult {
  return {
    toolCallId: call.toolCallId,
    ok: false,
    error: { code, messageForAgent, retryable: false },
  };
}
