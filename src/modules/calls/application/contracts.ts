import type { CustomerId, LocationId, TenantId } from "../../../shared/types/identifiers.js";
import type { AssistantPlaybackPosition } from "../../conversation/index.js";

export interface CallOrchestrator {
  handleTelephonyEvent(event: TelephonyEvent): Promise<void>;
  interrupt(callId: string, position?: AssistantPlaybackPosition): Promise<void>;
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
  locationId: LocationId;
  customerId?: CustomerId;
  from: string;
  to: string;
  state: CallState;
  createdAt: string;
  updatedAt: string;
}

export interface CallHistoryEntry extends CallRecord {
  usage: {
    inputTokens: number;
    outputTokens: number;
    inputAudioMs: number;
    outputAudioMs: number;
    toolCalls: number;
  };
}
