import type { CallRecord, CallState } from "../application/contracts.js";
import type { CallHistoryReader, CallRepository } from "../ports/call-repository.js";

export class InMemoryCallRepository implements CallRepository, CallHistoryReader {
  private readonly records = new Map<string, CallRecord>();
  readonly stateHistory: Array<{ callId: string; state: CallState }> = [];

  async findByCallId(callId: string): Promise<CallRecord | null> {
    return this.records.get(callId) ?? null;
  }

  async create(record: CallRecord): Promise<void> {
    this.records.set(record.callId, record);
    this.stateHistory.push({ callId: record.callId, state: record.state });
  }

  async updateState(callId: string, state: CallState, updatedAt: string): Promise<void> {
    const record = this.records.get(callId);
    if (!record) throw new Error(`Unknown call: ${callId}`);
    this.records.set(callId, { ...record, state, updatedAt });
    this.stateHistory.push({ callId, state });
  }

  async setCustomer(callId: string, customerId: string, updatedAt: string): Promise<void> {
    const record = this.records.get(callId);
    if (!record) throw new Error(`Unknown call: ${callId}`);
    this.records.set(callId, { ...record, customerId, updatedAt });
  }

  async listByTenant(tenantId: string, limit: number) {
    return [...this.records.values()].filter((record) => record.tenantId === tenantId)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt)).slice(0, limit)
      .map((record) => ({ ...record, usage: { inputTokens: 0, outputTokens: 0, inputAudioMs: 0, outputAudioMs: 0, toolCalls: 0 } }));
  }
}
