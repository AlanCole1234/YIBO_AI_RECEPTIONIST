import type { DatabaseSync } from "node:sqlite";
import type {
  CallHistoryEntry,
  CallHistoryReader,
  CallRecord,
  CallRepository,
  CallState,
} from "../../modules/calls/index.js";
import type { RegionId, TenantId } from "../../shared/types/identifiers.js";

type CallRow = { call_id:string; tenant_id:string; customer_id:string|null; caller_number:string; called_number:string; state:CallState; created_at:string; updated_at:string };
type HistoryRow = CallRow & { input_tokens:number; output_tokens:number; input_audio_ms:number; output_audio_ms:number; tool_calls:number };

export class SqliteCallRepository implements CallRepository, CallHistoryReader {
  constructor(private readonly database: DatabaseSync, private readonly region: RegionId) {}

  async findByCallId(callId: string): Promise<CallRecord | null> {
    const row = this.database.prepare("SELECT * FROM calls WHERE region_id = ? AND call_id = ?").get(this.region, callId) as CallRow | undefined;
    return row ? toRecord(row) : null;
  }

  async create(record: CallRecord): Promise<void> {
    this.database.prepare(`INSERT INTO calls(region_id,tenant_id,call_id,customer_id,caller_number,called_number,state,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)`)
      .run(this.region,record.tenantId,record.callId,record.customerId??null,record.from,record.to,record.state,record.createdAt,record.updatedAt);
    this.insertTransition(record.tenantId, record.callId, record.state, record.createdAt);
  }

  async updateState(callId: string, state: CallState, updatedAt: string): Promise<void> {
    const record = await this.findByCallId(callId); if (!record) throw new Error(`Unknown call: ${callId}`);
    this.database.prepare("UPDATE calls SET state = ?, updated_at = ? WHERE region_id = ? AND call_id = ?").run(state,updatedAt,this.region,callId);
    this.insertTransition(record.tenantId, callId, state, updatedAt);
  }

  async setCustomer(callId: string, customerId: string, updatedAt: string): Promise<void> {
    this.database.prepare("UPDATE calls SET customer_id = ?, updated_at = ? WHERE region_id = ? AND call_id = ?").run(customerId,updatedAt,this.region,callId);
  }

  async listByTenant(tenantId: TenantId, limit: number): Promise<CallHistoryEntry[]> {
    const rows = this.database.prepare(`SELECT c.*,
      COALESCE(SUM(u.input_tokens),0) input_tokens, COALESCE(SUM(u.output_tokens),0) output_tokens,
      COALESCE(SUM(u.input_audio_ms),0) input_audio_ms, COALESCE(SUM(u.output_audio_ms),0) output_audio_ms,
      COALESCE(SUM(u.tool_calls),0) tool_calls
      FROM calls c LEFT JOIN conversation_usage u ON u.region_id=c.region_id AND u.tenant_id=c.tenant_id AND u.call_id=c.call_id
      WHERE c.region_id=? AND c.tenant_id=? GROUP BY c.call_id ORDER BY c.created_at DESC LIMIT ?`)
      .all(this.region, tenantId, limit) as unknown as HistoryRow[];
    return rows.map((row) => ({ ...toRecord(row), usage: { inputTokens:row.input_tokens,outputTokens:row.output_tokens,inputAudioMs:row.input_audio_ms,outputAudioMs:row.output_audio_ms,toolCalls:row.tool_calls } }));
  }

  private insertTransition(tenantId:string,callId:string,state:CallState,occurredAt:string):void {
    this.database.prepare("INSERT INTO call_state_transitions(region_id,tenant_id,call_id,state,occurred_at) VALUES(?,?,?,?,?)").run(this.region,tenantId,callId,state,occurredAt);
  }
}

const toRecord=(row:CallRow):CallRecord=>({callId:row.call_id,tenantId:row.tenant_id,...(row.customer_id?{customerId:row.customer_id}:{}),from:row.caller_number,to:row.called_number,state:row.state,createdAt:row.created_at,updatedAt:row.updated_at});
