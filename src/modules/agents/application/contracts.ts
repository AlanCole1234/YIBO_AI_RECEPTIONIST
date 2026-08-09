import type { Result } from "../../../shared/domain/result.js";
import type {
  CallId,
  CustomerId,
  TenantId,
  ToolCallId,
} from "../../../shared/types/identifiers.js";

export type AgentToolName =
  | "check_availability"
  | "create_appointment"
  | "cancel_appointment"
  | "transfer_to_human";

export interface AgentToolDefinition {
  name: AgentToolName;
  description: string;
  inputSchema: object;
}

export interface AgentToolCall {
  toolCallId: ToolCallId;
  name: AgentToolName;
  arguments: unknown;
}

export type AgentToolResult =
  | { toolCallId: ToolCallId; ok: true; data: unknown }
  | {
      toolCallId: ToolCallId;
      ok: false;
      error: { code: string; messageForAgent: string; retryable: boolean };
    };

export interface ToolExecutionContext {
  tenantId: TenantId;
  callId: CallId;
  customerId?: CustomerId;
}

export interface ToolExecutor {
  execute(context: ToolExecutionContext, call: AgentToolCall): Promise<AgentToolResult>;
}

export interface StartAgentSessionCommand {
  callId: CallId;
  tenantId: TenantId;
  customerId?: CustomerId;
}

export interface AgentSession {
  callId: CallId;
  tenantId: TenantId;
  close(): Promise<void>;
}

export type AgentError =
  | { code: "CONFIGURATION_NOT_FOUND" }
  | { code: "AI_PROVIDER_UNAVAILABLE"; retryable: boolean };

export interface AgentRuntime {
  startSession(command: StartAgentSessionCommand): Promise<Result<AgentSession, AgentError>>;
}
