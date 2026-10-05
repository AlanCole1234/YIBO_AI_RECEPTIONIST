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

/** ARI media controls remain optional so existing in-memory and unit-test clients stay valid. */
export interface AsteriskMediaClient extends AsteriskClient {
  createMixingBridge(): Promise<{ bridgeId: string }>;
  addChannelsToBridge(bridgeId: string, channelIds: string[]): Promise<void>;
  destroyBridge(bridgeId: string): Promise<void>;
  createExternalMedia(input: {
    host: string;
    port: number;
    format: "ulaw";
    direction: "both";
  }): Promise<{ channelId: string }>;
}

/** A live ARI client can optionally expose its lifecycle without leaking credentials. */
export interface ConnectableAsteriskClient extends AsteriskClient {
  connect(): Promise<void>;
  close(): void;
}

export interface AsteriskFailure {
  code?: string;
  retryable?: boolean;
}
