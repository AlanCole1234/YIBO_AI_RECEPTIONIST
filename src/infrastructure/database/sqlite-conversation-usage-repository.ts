import type { DatabaseSync } from "node:sqlite";
import type {
  ConversationUsageIncrement,
  ConversationUsageReader,
  ConversationUsageRecorder,
  ConversationUsageSummary,
} from "../../modules/conversation/index.js";
import type { RegionId, TenantId } from "../../shared/types/identifiers.js";

type SummaryRow = {
  input_tokens: number;
  output_tokens: number;
  input_audio_ms: number;
  output_audio_ms: number;
  tool_calls: number;
};

export class SqliteConversationUsageRepository implements ConversationUsageRecorder, ConversationUsageReader {
  constructor(private readonly database: DatabaseSync, private readonly region: RegionId) {}

  async record(value: ConversationUsageIncrement): Promise<void> {
    this.database.prepare(`
      INSERT INTO conversation_usage(
        region_id, tenant_id, call_id, occurred_at,
        input_tokens, output_tokens, input_audio_ms, output_audio_ms, tool_calls
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      this.region, value.tenantId, value.callId, value.occurredAt,
      value.inputTokens, value.outputTokens, value.inputAudioMs, value.outputAudioMs, value.toolCalls,
    );
  }

  async summarize(tenantId: TenantId): Promise<ConversationUsageSummary> {
    const row = this.database.prepare(`
      SELECT
        COALESCE(SUM(input_tokens), 0) input_tokens,
        COALESCE(SUM(output_tokens), 0) output_tokens,
        COALESCE(SUM(input_audio_ms), 0) input_audio_ms,
        COALESCE(SUM(output_audio_ms), 0) output_audio_ms,
        COALESCE(SUM(tool_calls), 0) tool_calls
      FROM conversation_usage WHERE region_id = ? AND tenant_id = ?
    `).get(this.region, tenantId) as SummaryRow;
    return {
      inputTokens: row.input_tokens,
      outputTokens: row.output_tokens,
      inputAudioMs: row.input_audio_ms,
      outputAudioMs: row.output_audio_ms,
      toolCalls: row.tool_calls,
    };
  }
}
