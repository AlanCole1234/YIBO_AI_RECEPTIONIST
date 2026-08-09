import type { CallRecord, CallState } from "../application/contracts.js";

export interface CallRepository {
  findByCallId(callId: string): Promise<CallRecord | null>;
  create(record: CallRecord): Promise<void>;
  updateState(callId: string, state: CallState, updatedAt: string): Promise<void>;
  setCustomer(callId: string, customerId: string, updatedAt: string): Promise<void>;
}
