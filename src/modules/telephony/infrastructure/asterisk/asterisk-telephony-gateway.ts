import { failure, success } from "../../../../shared/domain/result.js";
import type { CallId } from "../../../../shared/types/identifiers.js";
import type {
  TelephonyError,
  TelephonyEvent,
  TelephonyGateway,
  TransferDestination,
} from "../../application/contracts.js";
import { AsteriskCallRegistry } from "./asterisk-call-registry.js";
import type { AsteriskClient, AsteriskEvent, AsteriskFailure, ConnectableAsteriskClient } from "./asterisk-client.js";

export class AsteriskTelephonyGateway implements TelephonyGateway {
  private readonly handlers: Array<(event: TelephonyEvent) => Promise<void>> = [];
  private readonly calls: AsteriskCallRegistry;

  constructor(
    client: AsteriskClient,
    createCallId: () => CallId,
    private readonly media?: {
      prepare(callId: CallId, callerChannelId: string, dialedNumber?: string): Promise<void>;
      cleanup(callId: CallId): Promise<void>;
      isDiagnosticCall?(dialedNumber?: string): boolean;
    },
  ) {
    this.client = client;
    this.calls = new AsteriskCallRegistry(createCallId);
    client.onEvent((event) => this.handleAsteriskEvent(event));
  }

  private readonly client: AsteriskClient;

  onEvent(handler: (event: TelephonyEvent) => Promise<void>): void {
    this.handlers.push(handler);
  }

  close(): void {
    const client = this.client as Partial<ConnectableAsteriskClient>;
    client.close?.();
  }

  async answer(callId: CallId) {
    return this.withChannel(callId, (channelId) => this.client.answer(channelId));
  }

  async hangup(callId: CallId) {
    return this.withChannel(callId, (channelId) => this.client.hangup(channelId));
  }

  async transfer(callId: CallId, destination: TransferDestination) {
    const normalized = normalizeDestination(destination);
    if (!normalized) {
      return failure<TelephonyError>({
        code: "INVALID_DESTINATION",
        message: destination.type === "PHONE_NUMBER"
          ? "Phone number must contain between 7 and 15 digits"
          : "Extension must contain between 1 and 8 digits",
      });
    }
    return this.withChannel(callId, (channelId) => this.client.transfer(channelId, normalized));
  }

  private async withChannel(callId: CallId, operation: (channelId: string) => Promise<void>) {
    const channelId = this.calls.channelIdForCall(callId);
    if (!channelId) return failure<TelephonyError>({ code: "CALL_NOT_FOUND" });
    try {
      await operation(channelId);
      return success(undefined);
    } catch (error) {
      return failure<TelephonyError>(mapAsteriskFailure(error));
    }
  }

  private async handleAsteriskEvent(event: AsteriskEvent): Promise<void> {
    if (event.type === "CHANNEL_ENTERED_APPLICATION") {
      const callId = this.calls.register(event.channelId);
      if (this.media) {
        try {
          await this.media.prepare(callId, event.channelId, event.dialedNumber);
        } catch (error) {
          console.error(JSON.stringify({ event: "telephony.media.prepare_failed", callId, channelId: event.channelId, error: safeError(error) }));
          await this.client.hangup(event.channelId).catch(() => undefined);
          this.calls.unregisterChannel(event.channelId);
          return;
        }
      }
      if (this.media?.isDiagnosticCall?.(event.dialedNumber)) {
        await this.client.answer(event.channelId).catch((error) => console.error(JSON.stringify({ event: "telephony.media.audio_diagnostic_answer_failed", callId, error: safeError(error) })));
        return;
      }
      return this.emit({
        type: "INCOMING_CALL",
        callId,
        from: event.callerNumber,
        to: event.dialedNumber,
        occurredAt: normalizedTimestamp(event.occurredAt),
      });
    }
    const callId = event.type === "CHANNEL_DESTROYED"
      ? this.calls.unregisterChannel(event.channelId)
      : this.calls.callIdForChannel(event.channelId);
    if (!callId) return;
    if (event.type === "CHANNEL_DESTROYED") {
      console.log(JSON.stringify({ event: "telephony.asterisk.call_ended", callId, channelId: event.channelId }));
      // Realtime shutdown must not wait for remote bridge/channel deletion.
      await Promise.all([
        Promise.resolve().then(() => this.media?.cleanup(callId)).catch(error => {
          console.error(JSON.stringify({ event: "telephony.media.cleanup_failed", callId, error: safeError(error) }));
        }),
        this.emit({ type: "CALL_HUNG_UP", callId, occurredAt: normalizedTimestamp(event.occurredAt) }),
      ]);
      return;
    }
    if (/^[0-9A-D*#]$/.test(event.digit)) {
      return this.emit({
        type: "DTMF_RECEIVED",
        callId,
        digit: event.digit,
        occurredAt: normalizedTimestamp(event.occurredAt),
      });
    }
  }

  private async emit(event: TelephonyEvent): Promise<void> {
    await Promise.all(this.handlers.map((handler) => handler(event)));
  }
}

const normalizeDestination = (destination: TransferDestination): { kind: "phone" | "extension"; value: string } | null => {
  const digits = destination.value.replace(/\D/g, "");
  if (destination.type === "PHONE_NUMBER") {
    if (digits.length < 7 || digits.length > 15) return null;
    return { kind: "phone", value: destination.value.trim().startsWith("+") ? `+${digits}` : digits };
  }
  if (!/^\d{1,8}$/.test(destination.value.trim())) return null;
  return { kind: "extension", value: destination.value.trim() };
};

const safeError = (value: unknown) => (value instanceof Error ? value.message : "Unexpected media setup error").slice(0, 300);

const normalizedTimestamp = (value: string): string => {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? new Date(0).toISOString() : date.toISOString();
};

const mapAsteriskFailure = (error: unknown): TelephonyError => {
  const failure = typeof error === "object" && error !== null ? error as AsteriskFailure : {};
  if (failure.code === "CHANNEL_NOT_FOUND") return { code: "CALL_NOT_FOUND" };
  if (failure.code === "CONNECTION_UNAVAILABLE") {
    return { code: "PROVIDER_UNAVAILABLE", retryable: failure.retryable ?? true };
  }
  return { code: "OPERATION_FAILED", retryable: failure.retryable ?? false };
};
