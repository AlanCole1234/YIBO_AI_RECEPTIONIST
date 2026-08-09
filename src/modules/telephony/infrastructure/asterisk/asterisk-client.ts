export type AsteriskEvent =
  | {
      type: "CHANNEL_ENTERED_APPLICATION";
      channelId: string;
      callerNumber: string;
      dialedNumber: string;
      occurredAt: string;
    }
  | { type: "CHANNEL_DESTROYED"; channelId: string; occurredAt: string }
  | { type: "DTMF_RECEIVED"; channelId: string; digit: string; occurredAt: string };

export interface AsteriskClient {
  answer(channelId: string): Promise<void>;
  hangup(channelId: string): Promise<void>;
  transfer(channelId: string, target: { kind: "phone" | "extension"; value: string }): Promise<void>;
  onEvent(handler: (event: AsteriskEvent) => Promise<void>): void;
}

export interface AsteriskFailure {
  code?: string;
  retryable?: boolean;
}
