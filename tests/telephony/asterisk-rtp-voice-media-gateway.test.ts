import { describe, expect, it, vi } from "vitest";
import dgram from "node:dgram";
import { AsteriskRtpVoiceMediaGateway } from "../../src/modules/telephony/index.js";
import type { AsteriskEvent, AsteriskMediaClient } from "../../src/modules/telephony/index.js";
import { createRtpPacket, parseRtpPacket } from "../../src/modules/telephony/infrastructure/asterisk/rtp.js";

class FakeAriMediaClient implements AsteriskMediaClient {
  readonly createMixingBridge = vi.fn(async () => ({ bridgeId: "bridge-1" }));
  readonly addChannelsToBridge = vi.fn(async () => {});
  readonly destroyBridge = vi.fn(async () => {});
  readonly createExternalMedia = vi.fn(async () => ({ channelId: "external-1" }));
  readonly answer = vi.fn(async () => {});
  readonly hangup = vi.fn(async () => {});
  readonly transfer = vi.fn(async () => {});
  onEvent(_handler: (event: AsteriskEvent) => Promise<void>): void {}
}

describe("AsteriskRtpVoiceMediaGateway", () => {
  it("reports playback-idle after the completed provider's partial final packet is actually sent", async () => {
    const client = new FakeAriMediaClient();
    const gateway = new AsteriskRtpVoiceMediaGateway(client, { host: "127.0.0.1", portStart: 40_004, portEnd: 40_010, logger: () => {} });
    const peer = dgram.createSocket("udp4");
    const packets: Uint8Array[] = [];
    const idle = vi.fn();
    peer.on("message", data => { const packet = parseRtpPacket(data); if (packet) packets.push(packet.payload); });
    try {
      await new Promise<void>(resolve => peer.bind(0, "127.0.0.1", resolve));
      await gateway.prepare("partial", "caller");
      const opened = await gateway.open("partial");
      if (!opened.ok) throw new Error("Synthetic media setup failed");
      const transport = opened.value;
      transport.outboundAudio.onPlaybackIdle!(idle);
      const received = transport.inboundAudio[Symbol.asyncIterator]().next();
      const port = (client.createExternalMedia.mock.calls[0] as unknown as [{ port: number }])[0].port;
      const inbound = createRtpPacket({ payload: new Uint8Array(160).fill(0xff), sequenceNumber: 1, timestamp: 0, ssrc: 1, marker: false });
      await new Promise<void>((resolve, reject) => peer.send(inbound, port, "127.0.0.1", error => error ? reject(error) : resolve()));
      await received;
      await transport.outboundAudio.write({ data: new Uint8Array(5280), codec: "pcm_s16le", sampleRate: 24_000, channels: 1 }, "prompt");
      transport.outboundAudio.complete!("prompt");
      await vi.waitFor(() => expect(idle).toHaveBeenCalledTimes(1));
      await vi.waitFor(() => expect(packets).toHaveLength(6));
      expect(transport.outboundAudio.getBargeInDiagnostics!().outboundQueueDepth).toBe(0);
      expect(transport.outboundAudio.getBargeInDiagnostics!().outboundRtpPlaying).toBe(false);
      transport.outboundAudio.complete!("prompt");
      expect(idle).toHaveBeenCalledTimes(1);
    } finally {
      peer.close();
      await gateway.cleanup("partial");
    }
    expect(client.hangup).toHaveBeenCalledWith("external-1");
    expect(client.destroyBridge).toHaveBeenCalledWith("bridge-1");
  });

  it("creates one mixing bridge and an External Media channel, then tears both down", async () => {
    const client = new FakeAriMediaClient();
    const gateway = new AsteriskRtpVoiceMediaGateway(client, { host: "127.0.0.1", portStart: 40_000, portEnd: 40_020, logger: () => {} });

    await gateway.prepare("call-1", "caller-1");
    const transport = await gateway.open("call-1");

    expect(transport.ok).toBe(true);
    expect(client.addChannelsToBridge).toHaveBeenNthCalledWith(1, "bridge-1", ["caller-1"]);
    expect(client.createExternalMedia).toHaveBeenCalledWith({ host: "127.0.0.1", port: 40_000, format: "ulaw", direction: "both" });
    expect(client.addChannelsToBridge).toHaveBeenNthCalledWith(2, "bridge-1", ["external-1"]);

    await gateway.cleanup("call-1");
    expect(client.hangup).toHaveBeenCalledWith("external-1");
    expect(client.destroyBridge).toHaveBeenCalledWith("bridge-1");
  });

  it("releases the RTP port after cleanup so a later call can reuse it", async () => {
    const client = new FakeAriMediaClient();
    const gateway = new AsteriskRtpVoiceMediaGateway(client, { host: "127.0.0.1", portStart: 40_001, portEnd: 40_001, logger: () => {} });

    await gateway.prepare("call-1", "caller-1");
    await gateway.cleanup("call-1");
    await gateway.prepare("call-2", "caller-2");
    await gateway.cleanup("call-2");

    expect(client.createExternalMedia).toHaveBeenNthCalledWith(1, { host: "127.0.0.1", port: 40_001, format: "ulaw", direction: "both" });
    expect(client.createExternalMedia).toHaveBeenNthCalledWith(2, { host: "127.0.0.1", port: 40_001, format: "ulaw", direction: "both" });
  });

  it("disables barge-in only for the explicitly configured private test dialed number", async () => {
    const client = new FakeAriMediaClient();
    const gateway = new AsteriskRtpVoiceMediaGateway(client, {
      host: "127.0.0.1",
      portStart: 40_002,
      portEnd: 40_003,
      disableBargeInForTestDialedNumber: "+529991000000",
      logger: () => {},
    });

    await gateway.prepare("test-call", "caller-1", "+529991000000");
    await gateway.prepare("normal-call", "caller-2", "+19155550123");
    const testTransport = await gateway.open("test-call");
    const normalTransport = await gateway.open("normal-call");

    expect(testTransport.ok && testTransport.value.bargeInEnabled).toBe(false);
    expect(normalTransport.ok && normalTransport.value.bargeInEnabled).toBeUndefined();

    await gateway.cleanup("test-call");
    await gateway.cleanup("normal-call");
  });
});
