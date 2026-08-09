import type { CustomerId, TenantId } from "../../../shared/types/identifiers.js";

export interface CallOrchestrator {
  handleTelephonyEvent(event: TelephonyEvent): Promise<void>;
}

export type CallState =
  | "RINGING"
  | "ANSWERED"
  | "AI_CONNECTING"
  | "IN_CONVERSATION"
  | "TRANSFERRING"
  | "TRANSFERRED"
  | "COMPLETED"
  | "FAILED";

export type TelephonyEvent =
  | { type: "INCOMING_CALL"; callId: string; from: string; to: string; occurredAt: string }
  | { type: "CALL_HUNG_UP"; callId: string; occurredAt: string }
  | { type: "DTMF_RECEIVED"; callId: string; digit: string; occurredAt: string };

export interface CallRecord {
  callId: string;
  tenantId: TenantId;
  customerId?: CustomerId;
  state: CallState;
  createdAt: string;
  updatedAt: string;
}
