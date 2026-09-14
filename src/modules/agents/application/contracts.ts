import type { Result } from "../../../shared/domain/result.js";
import type {
  CallId,
  CustomerId,
  LocationId,
  TenantId,
  ToolCallId,
} from "../../../shared/types/identifiers.js";

export type AgentToolName =
  | "check_availability"
  | "create_appointment"
  | "update_customer"
  | "cancel_appointment"
  | "reschedule_appointment"
  | "transfer_to_human"
  | "enable_developer_test_mode"
  | "delete_test_appointments";

export interface AgentToolDefinition {
  name: AgentToolName;
  description: string;
  inputSchema: object;
  presentation?: {
    title: string;
    help: string;
    route: string;
    icon: string;
    kind: "consult" | "mutate" | "external";
  };
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
  locationId: LocationId;
  callId: CallId;
  customerId?: CustomerId;
  /** Server-trusted and available only from the local development harness. */
  developerTestModeAuthorized?: true;
}

export interface ToolExecutor {
  execute(context: ToolExecutionContext, call: AgentToolCall): Promise<AgentToolResult>;
}

export interface PrepareAgentDefinitionCommand extends ToolExecutionContext {}

export interface AgentDefinition {
  instructions: string;
  locale: string;
  voice?: string;
  conversation: AgentConversationConfiguration;
  audio: AgentAudioConfiguration;
  tools: AgentToolDefinition[];
  toolExecutor: ToolExecutor;
  trustedContext: ToolExecutionContext;
}

export interface AgentConversationConfiguration {
  model: string;
  maxOutputTokens: number;
  reasoningEffort: "minimal" | "low" | "medium" | "high";
  tracing: "disabled" | "auto";
  truncation:
    | { mode: "auto" | "disabled" }
    | { mode: "retention_ratio"; retentionRatio: number; postInstructionsTokens?: number };
}

export type ConversationBehavior = AgentConversationConfiguration;

export interface AgentAudioConfiguration {
  voice: string;
  noiseReduction: "disabled" | "near_field" | "far_field";
  turnDetection: AgentTurnDetectionConfiguration;
}

export type AgentTurnDetectionConfiguration =
  | {
      type: "server_vad";
      threshold?: number;
      prefixPaddingMs?: number;
      silenceDurationMs?: number;
      idleTimeoutMs?: number | null;
      createResponse: boolean;
      interruptResponse: boolean;
    }
  | {
      type: "semantic_vad";
      eagerness: "auto" | "low" | "medium" | "high";
      createResponse: boolean;
      interruptResponse: boolean;
    }
  | { type: "manual" };

export type AgentDefinitionError = {
  code: "CONFIGURATION_NOT_FOUND" | "BUSINESS_CONTEXT_NOT_FOUND";
};

export interface AgentDefinitionFactory {
  prepare(
    command: PrepareAgentDefinitionCommand,
  ): Promise<Result<AgentDefinition, AgentDefinitionError>>;
}
