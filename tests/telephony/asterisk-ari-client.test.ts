import { describe, expect, it, vi } from "vitest";
import { AsteriskAriClient, type AriWebSocket } from "../../src/modules/telephony/index.js";

class FakeSocket implements AriWebSocket {
  private readonly listeners = new Map<string, Array<(event: { data?: unknown }) => void>>();
  readonly close = vi.fn();

  addEventListener(type: "open" | "message" | "error" | "close", listener: (event: { data?: unknown }) => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  emit(type: "message" | "close", data?: unknown): void {
    for (const listener of this.listeners.get(type) ?? []) listener({ data });
  }
}

const config = { baseUrl: "https://asterisk.example.test:8089", username: "yibo", password: "secret", application: "yibo-receptionist" };

describe("AsteriskAriClient", () => {
  it("uses ARI REST for call control and maps websocket events at the provider boundary", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response(null, { status: 204 }));
    const socket = new FakeSocket();
    const socketFactory = vi.fn<(url: string) => AriWebSocket>(() => socket);
    const client = new AsteriskAriClient(config, fetcher, socketFactory);
    const events: unknown[] = [];
    client.onEvent(async (event) => { events.push(event); });

    await client.connect();
    expect(socketFactory).toHaveBeenCalledWith(expect.stringMatching(/^wss:\/\/asterisk\.example\.test:8089\/ari\/events\?/));
    expect(socketFactory.mock.calls[0]?.[0]).toContain("app=yibo-receptionist");

    socket.emit("message", JSON.stringify({
      type: "StasisStart", timestamp: "2026-08-24T16:00:00.000Z", args: ["+15125550100", "d5da4d1e-1234-4cde-9000-123456789abc"],
      channel: { id: "channel-1", caller: { number: "+15125550123" }, dialplan: { exten: "+15125550100" } },
    }));
    await vi.waitFor(() => expect(events).toEqual([expect.objectContaining({
      type: "CHANNEL_ENTERED_APPLICATION", channelId: "channel-1", dialedNumber: "+15125550100", mediaStreamId: "d5da4d1e-1234-4cde-9000-123456789abc",
    })]));

    await client.answer("channel-1");
    await client.hangup("channel-1");
    await client.transfer("channel-1", { kind: "phone", value: "+15125550199" });
    expect(fetcher.mock.calls.map(([url, init]) => [String(url), init?.method])).toEqual([
      ["https://asterisk.example.test:8089/ari/channels/channel-1/answer", "POST"],
      ["https://asterisk.example.test:8089/ari/channels/channel-1", "DELETE"],
      ["https://asterisk.example.test:8089/ari/channels/channel-1/redirect?endpoint=PJSIP%2F%2B15125550199", "POST"],
    ]);
  });

  it("maps ARI transport failures to the existing Asterisk failure contract", async () => {
    const client = new AsteriskAriClient(config, async () => new Response(null, { status: 404 }));
    await expect(client.hangup("missing")).rejects.toEqual({ code: "CHANNEL_NOT_FOUND" });
  });

  it("creates a bidirectional AudioSocket external-media bridge for a live call", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response(null, { status: 204 }));
    const client = new AsteriskAriClient(config, fetcher, () => new FakeSocket());

    const streamId = await client.attachAudioSocketMedia("channel-1", { host: "media.yibo.internal", port: 9019 });

    expect(streamId).toMatch(/^[0-9a-f-]{36}$/);
    const urls = fetcher.mock.calls.map(([url]) => new URL(String(url)));
    expect(urls.map((url) => url.pathname)).toEqual([
      "/ari/bridges",
      `/ari/bridges/yibo-${streamId}/addChannel`,
      "/ari/channels/externalMedia",
      `/ari/bridges/yibo-${streamId}/addChannel`,
    ]);
    expect(Object.fromEntries(urls[2]!.searchParams)).toMatchObject({
      app: config.application, channelId: streamId, external_host: "media.yibo.internal:9019",
      transport: "tcp", encapsulation: "audiosocket", format: "slin16",
    });
  });
});
