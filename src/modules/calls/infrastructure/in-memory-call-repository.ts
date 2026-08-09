import type { CallRecord, CallState } from "../application/contracts.js";
import type { CallRepository } from "../ports/call-repository.js";

export class InMemoryCallRepository implements CallRepository {
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
}
