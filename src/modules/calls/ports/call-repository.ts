import type { CallHistoryEntry, CallRecord, CallState } from "../application/contracts.js";
import type { TenantId } from "../../../shared/types/identifiers.js";

export interface CallRepository {
  findByCallId(callId: string): Promise<CallRecord | null>;
  create(record: CallRecord): Promise<void>;
  updateState(callId: string, state: CallState, updatedAt: string): Promise<void>;
  setCustomer(callId: string, customerId: string, updatedAt: string): Promise<void>;
}

export interface CallHistoryReader {
  listByTenant(tenantId: TenantId, limit: number): Promise<CallHistoryEntry[]>;
}
