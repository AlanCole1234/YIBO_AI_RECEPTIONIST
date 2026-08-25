import type { CallId, TenantId } from "../../../shared/types/identifiers.js";

export interface ConversationUsageIncrement {
  tenantId: TenantId;
  callId: CallId;
  occurredAt: string;
  inputTokens: number;
  outputTokens: number;
  inputAudioMs: number;
  outputAudioMs: number;
  toolCalls: number;
}

export interface ConversationUsageSummary {
  inputTokens: number;
  outputTokens: number;
  inputAudioMs: number;
  outputAudioMs: number;
  toolCalls: number;
}

export interface ConversationUsageRecorder {
  record(increment: ConversationUsageIncrement): Promise<void>;
}

export interface ConversationUsageReader {
  summarize(tenantId: TenantId): Promise<ConversationUsageSummary>;
}
