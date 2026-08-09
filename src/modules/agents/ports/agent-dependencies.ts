import type { Result } from "../../../shared/domain/result.js";
import type { CallId, TenantId } from "../../../shared/types/identifiers.js";
import type {
  AgentToolCall,
  AgentToolDefinition,
  AgentToolResult,
} from "../application/contracts.js";

export interface AgentConfiguration {
  instructions: string;
  locale: string;
  voice?: string;
}

export interface AgentConfigurationProvider {
  getConfiguration(tenantId: TenantId): Promise<AgentConfiguration | null>;
}

export interface AgentAIProvider {
  openSession(config: {
    callId: CallId;
    tenantId: TenantId;
    instructions: string;
    locale: string;
    voice?: string;
    tools: AgentToolDefinition[];
  }): Promise<Result<ProviderAgentSession, AgentAIProviderError>>;
}

export interface ProviderAgentSession {
  sendToolResult(result: AgentToolResult): Promise<void>;
  onToolCall(handler: (call: AgentToolCall) => Promise<void>): void;
  close(): Promise<void>;
}

export type AgentAIProviderError =
  | { code: "AUTHORIZATION_REQUIRED" }
  | { code: "RATE_LIMITED"; retryAfterMs?: number }
  | { code: "PROVIDER_UNAVAILABLE"; retryable: boolean }
  | { code: "VALIDATION_ERROR"; message: string };

export interface HumanTransferPort {
  transferToConfiguredDestination(input: {
    tenantId: TenantId;
    callId: CallId;
  }): Promise<Result<void, { code: "DESTINATION_NOT_CONFIGURED" | "TRANSFER_FAILED"; retryable: boolean }>>;
}
