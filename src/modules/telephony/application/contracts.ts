import type { Result } from "../../../shared/domain/result.js";
import type { CallId, ISODateTime } from "../../../shared/types/identifiers.js";

export interface TelephonyGateway {
  answer(callId: CallId): Promise<Result<void, TelephonyError>>;
  hangup(callId: CallId): Promise<Result<void, TelephonyError>>;
  transfer(callId: CallId, destination: TransferDestination): Promise<Result<void, TelephonyError>>;
  onEvent(handler: (event: TelephonyEvent) => Promise<void>): void;
}

export type TelephonyEvent =
  | { type: "INCOMING_CALL"; callId: CallId; from: string; to: string; occurredAt: ISODateTime }
  | { type: "CALL_HUNG_UP"; callId: CallId; occurredAt: ISODateTime }
  | { type: "DTMF_RECEIVED"; callId: CallId; digit: string; occurredAt: ISODateTime };

export type TransferDestination =
  | { type: "PHONE_NUMBER"; value: string }
  | { type: "EXTENSION"; value: string };

export type TelephonyError =
  | { code: "CALL_NOT_FOUND" }
  | { code: "INVALID_DESTINATION"; message: string }
  | { code: "PROVIDER_UNAVAILABLE"; retryable: boolean }
  | { code: "OPERATION_FAILED"; retryable: boolean };
