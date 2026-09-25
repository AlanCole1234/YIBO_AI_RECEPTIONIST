import { trustedToolScope } from "./trusted-tool-scope.js";
import { randomBytes } from "node:crypto";
import type {
  AgentToolCall,
  AgentToolName,
  AgentToolResult,
  ToolExecutionContext,
  ToolExecutor,
} from "./contracts.js";

type PendingConfirmation = {
  scope: string;
  tool: AgentToolName;
  argumentsFingerprint: string;
  issuedAtTurn: number;
  issuedAtMs: number;
};

const CONFIRMATION_TTL_MS = 2 * 60_000;

export class ConfirmationGateToolExecutor implements ToolExecutor {
  private readonly pending = new Map<string, PendingConfirmation>();
  private readonly requiredFor: Set<AgentToolName>;

  constructor(
    private readonly delegate: ToolExecutor,
    requiredFor: AgentToolName[],
    private readonly createToken: () => string = () => randomBytes(24).toString("base64url"),
    private readonly now: () => number = () => Date.now(),
  ) {
    this.requiredFor = new Set(requiredFor);
  }

  async execute(context: ToolExecutionContext, call: AgentToolCall): Promise<AgentToolResult> {
    if (!this.requiredFor.has(call.name)) return this.delegate.execute(context, call);
    if (!isRecord(call.arguments)) return this.delegate.execute(context, call);
    const { confirmationToken, ...actionArguments } = call.arguments;
    if (confirmationToken === undefined) {
      const token = this.createToken();
      this.pending.set(token, {
        scope: trustedToolScope(context),
        tool: call.name,
        argumentsFingerprint: stableJson(actionArguments),
        issuedAtTurn: context.turnSequence,
        issuedAtMs: this.now(),
      });
      return confirmationRequired(call, token);
    }
    if (typeof confirmationToken !== "string" || !confirmationToken) {
      return failure(call, "INVALID_CONFIRMATION_TOKEN", "The confirmation token is invalid. Ask the caller to confirm again.");
    }
    const pending = this.pending.get(confirmationToken);
    if (!pending
      || pending.scope !== trustedToolScope(context)
      || pending.tool !== call.name
      || pending.argumentsFingerprint !== stableJson(actionArguments)) {
      return failure(call, "CONFIRMATION_MISMATCH", "The confirmation does not match this action. Start confirmation again.");
    }
    if (this.now() - pending.issuedAtMs > CONFIRMATION_TTL_MS) {
      this.pending.delete(confirmationToken);
      return failure(call, "CONFIRMATION_EXPIRED", "The confirmation expired. Describe the action and ask the caller to confirm again.");
    }
    if (context.turnSequence <= pending.issuedAtTurn) {
      return failure(
        call,
        "CONFIRMATION_PENDING_NEW_TURN",
        `Ask the caller to confirm the action in a new turn, then retry with confirmation token ${confirmationToken}.`,
      );
    }
    this.pending.delete(confirmationToken);
    return this.delegate.execute(context, { ...call, arguments: actionArguments });
  }
}

function confirmationRequired(call: AgentToolCall, token: string): AgentToolResult {
  return {
    toolCallId: call.toolCallId,
    ok: false,
    error: {
      code: "CONFIRMATION_REQUIRED",
      messageForAgent: `Describe the exact action and ask the caller to confirm. After a new caller turn, retry with confirmation token ${token}.`,
      retryable: false,
      confirmationToken: token,
    },
  };
}

function failure(call: AgentToolCall, code: string, messageForAgent: string): AgentToolResult {
  return { toolCallId: call.toolCallId, ok: false, error: { code, messageForAgent, retryable: false } };
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
