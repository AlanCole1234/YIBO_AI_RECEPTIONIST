import type { AsteriskClient, AsteriskEvent } from "./asterisk-client.js";
import { randomUUID } from "node:crypto";

export interface AsteriskAriClientConfig {
  /** e.g. http://asterisk.internal:8088 */
  baseUrl: string;
  username: string;
  password: string;
  application: string;
}

export interface AriWebSocket {
  addEventListener(type: "open" | "message" | "error" | "close", listener: (event: { data?: unknown }) => void): void;
  close(): void;
}

export type AriWebSocketFactory = (url: string) => AriWebSocket;

export interface AsteriskAudioSocketConfig {
  host: string;
  port: number;
  format?: "slin16" | "slin";
}

/**
 * Concrete Asterisk REST Interface client. It maps only ARI transport shapes
 * to the AsteriskClient port; the rest of YIBO never sees ARI payloads.
 */
export class AsteriskAriClient implements AsteriskClient {
  private readonly handlers: Array<(event: AsteriskEvent) => Promise<void>> = [];
  private socket?: AriWebSocket;

  constructor(
    private readonly config: AsteriskAriClientConfig,
    private readonly fetcher: typeof fetch = fetch,
    private readonly websocketFactory: AriWebSocketFactory = (url) => new WebSocket(url),
  ) {}

  async connect(): Promise<void> {
    if (this.socket) return;
    const url = new URL("/ari/events", websocketBaseUrl(this.config.baseUrl));
    url.searchParams.set("app", this.config.application);
    url.searchParams.set("api_key", `${this.config.username}:${this.config.password}`);
    const socket = this.websocketFactory(url.toString());
    socket.addEventListener("message", (message) => { void this.handleMessage(message.data); });
    socket.addEventListener("close", () => { if (this.socket === socket) this.socket = undefined; });
    this.socket = socket;
  }

  disconnect(): void {
    this.socket?.close();
    this.socket = undefined;
  }

  onEvent(handler: (event: AsteriskEvent) => Promise<void>): void {
    this.handlers.push(handler);
  }

  async answer(channelId: string): Promise<void> {
    await this.request(`/ari/channels/${encodeURIComponent(channelId)}/answer`, { method: "POST" });
  }

  async hangup(channelId: string): Promise<void> {
    await this.request(`/ari/channels/${encodeURIComponent(channelId)}`, { method: "DELETE" });
  }

  async transfer(channelId: string, target: { kind: "phone" | "extension"; value: string }): Promise<void> {
    const endpoint = `PJSIP/${target.value}`;
    await this.request(`/ari/channels/${encodeURIComponent(channelId)}/redirect`, {
      method: "POST",
      query: { endpoint },
    });
  }

  /**
   * Creates a mixing bridge containing the caller and a bidirectional ARI
   * external-media channel. The supplied UUID is used as the AudioSocket
   * correlation ID between Asterisk and AsteriskAudioSocketServer.
   */
  async attachAudioSocketMedia(channelId: string, media: AsteriskAudioSocketConfig): Promise<string> {
    const streamId = randomUUID();
    const bridgeId = `yibo-${streamId}`;
    await this.request("/ari/bridges", { method: "POST", query: { type: "mixing", bridgeId } });
    await this.request(`/ari/bridges/${encodeURIComponent(bridgeId)}/addChannel`, { method: "POST", query: { channel: channelId } });
    await this.request("/ari/channels/externalMedia", {
      method: "POST",
      query: {
        app: this.config.application,
        channelId: streamId,
        external_host: `${media.host}:${media.port}`,
        encapsulation: "audiosocket",
        transport: "tcp",
        format: media.format ?? "slin16",
        direction: "both",
      },
    });
    await this.request(`/ari/bridges/${encodeURIComponent(bridgeId)}/addChannel`, { method: "POST", query: { channel: streamId } });
    return streamId;
  }

  private async request(path: string, input: { method: "POST" | "DELETE"; query?: Record<string, string> }): Promise<void> {
    const url = new URL(path, this.config.baseUrl);
    for (const [key, value] of Object.entries(input.query ?? {})) url.searchParams.set(key, value);
    let response: Response;
    try {
      response = await this.fetcher(url, {
        method: input.method,
        headers: { authorization: `Basic ${Buffer.from(`${this.config.username}:${this.config.password}`).toString("base64")}` },
      });
    } catch {
      throw { code: "CONNECTION_UNAVAILABLE", retryable: true };
    }
    if (response.ok) return;
    if (response.status === 404) throw { code: "CHANNEL_NOT_FOUND" };
    if (response.status >= 500) throw { code: "CONNECTION_UNAVAILABLE", retryable: true };
    throw { code: "ARI_OPERATION_FAILED", retryable: response.status === 429 };
  }

  private async handleMessage(data: unknown): Promise<void> {
    const parsed = parseAriEvent(data);
    if (!parsed) return;
    await Promise.all(this.handlers.map((handler) => handler(parsed)));
  }
}

const websocketBaseUrl = (baseUrl: string): string => {
  const url = new URL(baseUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
};

const parseAriEvent = (data: unknown): AsteriskEvent | null => {
  if (typeof data !== "string") return null;
  let event: unknown;
  try { event = JSON.parse(data); } catch { return null; }
  if (!isRecord(event) || typeof event.type !== "string" || typeof event.timestamp !== "string") return null;
  if (event.type === "StasisStart" && isRecord(event.channel) && typeof event.channel.id === "string") {
    const caller = isRecord(event.channel.caller) && typeof event.channel.caller.number === "string" ? event.channel.caller.number : "";
    const args = Array.isArray(event.args) ? event.args.filter((value): value is string => typeof value === "string") : [];
    // The dialplan can supply the tenant's E.164 DID as the first Stasis arg.
    // Fall back to the dialed extension for installations that route directly.
    const dialed = args.find(isE164) ?? (isRecord(event.channel.dialplan) && typeof event.channel.dialplan.exten === "string" ? event.channel.dialplan.exten : "");
    const mediaStreamId = args.find(isUuid);
    return { type: "CHANNEL_ENTERED_APPLICATION", channelId: event.channel.id, callerNumber: caller, dialedNumber: dialed, occurredAt: event.timestamp, ...(mediaStreamId ? { mediaStreamId } : {}) };
  }
  if ((event.type === "ChannelDestroyed" || event.type === "StasisEnd") && isRecord(event.channel) && typeof event.channel.id === "string") {
    return { type: "CHANNEL_DESTROYED", channelId: event.channel.id, occurredAt: event.timestamp };
  }
  if (event.type === "ChannelDtmfReceived" && isRecord(event.channel) && typeof event.channel.id === "string" && typeof event.digit === "string") {
    return { type: "DTMF_RECEIVED", channelId: event.channel.id, digit: event.digit, occurredAt: event.timestamp };
  }
  return null;
};

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;
const isE164 = (value: string): boolean => /^\+[1-9]\d{6,14}$/.test(value);
const isUuid = (value: string): boolean => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
