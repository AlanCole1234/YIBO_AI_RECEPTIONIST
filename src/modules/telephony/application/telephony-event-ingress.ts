import { timingSafeEqual } from "node:crypto";
import { failure, success } from "../../../shared/domain/result.js";
import type { Result } from "../../../shared/domain/result.js";
import type { TelephonyEvent } from "./contracts.js";

export type TelephonyIngressError =
  | { code: "NOT_CONFIGURED" }
  | { code: "UNAUTHORIZED" }
  | { code: "INVALID_EVENT"; message: string }
  | { code: "DELIVERY_FAILED"; retryable: boolean };

/**
 * Provider-neutral HTTP ingress boundary. A provider adapter maps its event
 * into TelephonyEvent before handing it to this class; no provider SDK or
 * provider payload type is allowed past this point.
 */
export class TelephonyEventIngress {
  private readonly handlers: Array<(event: TelephonyEvent) => Promise<void>> = [];

  constructor(private readonly sharedSecret?: string) {}

  get configured(): boolean {
    return Boolean(this.sharedSecret);
  }

  onEvent(handler: (event: TelephonyEvent) => Promise<void>): void {
    this.handlers.push(handler);
  }

  async receive(event: unknown, suppliedSecret: string | undefined): Promise<Result<void, TelephonyIngressError>> {
    if (!this.sharedSecret) return failure({ code: "NOT_CONFIGURED" });
    if (!secureEqual(this.sharedSecret, suppliedSecret)) return failure({ code: "UNAUTHORIZED" });
    const normalized = normalizeEvent(event);
    if (!normalized.ok) return normalized;
    try {
      await Promise.all(this.handlers.map((handler) => handler(normalized.value)));
      return success(undefined);
    } catch {
      return failure({ code: "DELIVERY_FAILED", retryable: true });
    }
  }
}

const secureEqual = (expected: string, received: string | undefined): boolean => {
  if (!received) return false;
  const expectedBytes = Buffer.from(expected);
  const receivedBytes = Buffer.from(received);
  return expectedBytes.length === receivedBytes.length && timingSafeEqual(expectedBytes, receivedBytes);
};

const normalizeEvent = (event: unknown): Result<TelephonyEvent, TelephonyIngressError> => {
  if (!isRecord(event) || typeof event.type !== "string" || !validCallId(event.callId) || typeof event.occurredAt !== "string") {
    return failure({ code: "INVALID_EVENT", message: "type, callId, and occurredAt are required." });
  }
  const occurredAt = new Date(event.occurredAt);
  if (Number.isNaN(occurredAt.valueOf())) return failure({ code: "INVALID_EVENT", message: "occurredAt must be a valid ISO datetime." });
  const base = { callId: event.callId, occurredAt: occurredAt.toISOString() };
  if (event.type === "INCOMING_CALL") {
    if (!validPhone(event.from) || !validPhone(event.to)) {
      return failure({ code: "INVALID_EVENT", message: "Incoming calls require E.164 from and to numbers." });
    }
    return success({ type: event.type, ...base, from: event.from, to: event.to });
  }
  if (event.type === "CALL_HUNG_UP") return success({ type: event.type, ...base });
  if (event.type === "DTMF_RECEIVED") {
    if (typeof event.digit !== "string" || !/^[0-9A-D*#]$/.test(event.digit)) {
      return failure({ code: "INVALID_EVENT", message: "DTMF digit must be one supported telephone key." });
    }
    return success({ type: event.type, ...base, digit: event.digit });
  }
  return failure({ code: "INVALID_EVENT", message: "Unsupported telephony event type." });
};

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;
const validCallId = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value);
const validPhone = (value: unknown): value is string => typeof value === "string" && /^\+[1-9]\d{6,14}$/.test(value);
