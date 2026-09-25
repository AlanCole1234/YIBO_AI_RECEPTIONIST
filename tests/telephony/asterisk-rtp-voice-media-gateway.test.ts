import { createSocket } from "node:dgram";
import { createRtpPacket } from "../../src/modules/telephony/infrastructure/asterisk/rtp.js";
import { describe, expect, it, vi } from "vitest";
import { AsteriskRtpVoiceMediaGateway } from "../../src/modules/telephony/index.js";
import type { AsteriskEvent, AsteriskMediaClient } from "../../src/modules/telephony/index.js";

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
  it("observes actual first RTP once per turn and isolates listener failures", async () => {
    const client = new FakeAriMediaClient();
    const logger = vi.fn();
    const gateway = new AsteriskRtpVoiceMediaGateway(client, { host: "127.0.0.1", portStart: 40110, portEnd: 40110, logger });
    const peer = createSocket("udp4");
    await new Promise<void>(resolve => peer.bind(0, "127.0.0.1", resolve));
    try {
      await gateway.prepare("observed", "caller");
      const result = await gateway.open("observed"); if (!result.ok) throw new Error("open failed");
      const listener = vi.fn(() => { throw new Error("observer failed"); });
      const remove = result.value.outboundAudio.onFirstAudioSent!(listener);
      const packet = createRtpPacket({ payload: new Uint8Array(160).fill(255), sequenceNumber: 1, timestamp: 1, ssrc: 1, marker: false });
      peer.send(packet, 40110, "127.0.0.1");
      await vi.waitFor(() => expect(logger.mock.calls.some(([event]) => event === "telephony.media.rtp_received")).toBe(true));
      const received = vi.fn(); peer.on("message", received);
      await result.value.outboundAudio.write({ codec: "pcm_s16le", sampleRate: 24000, channels: 1, data: new Uint8Array(1920) }, "turn-one");
      await vi.waitFor(() => expect(received.mock.calls.length).toBeGreaterThanOrEqual(2));
      expect(listener).toHaveBeenCalledTimes(1); expect(listener).toHaveBeenCalledWith("turn-one");
      remove();
      await result.value.outboundAudio.write({ codec: "pcm_s16le", sampleRate: 24000, channels: 1, data: new Uint8Array(960) }, "turn-two");
      await vi.waitFor(() => expect(received.mock.calls.length).toBeGreaterThanOrEqual(3));
      expect(listener).toHaveBeenCalledTimes(1);
    } finally { await gateway.cleanup("observed"); peer.close(); }
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

  it("releases a greeting waiting for the RTP peer when the call closes", async () => {
    const client=new FakeAriMediaClient();
    const gateway=new AsteriskRtpVoiceMediaGateway(client,{host:"127.0.0.1",portStart:40100,portEnd:40100,logger:()=>{}});
    await gateway.prepare("waiting","caller");
    const opened=await gateway.open("waiting"); if(!opened.ok) throw new Error("open failed");
    const writing=opened.value.outboundAudio.write({codec:"pcm_s16le",sampleRate:24000,channels:1,data:new Uint8Array(960)},"greeting");
    let finished=false;void writing.then(()=>{finished=true;});
    await new Promise(resolve=>setImmediate(resolve));expect(finished).toBe(false);
    await gateway.cleanup("waiting");await writing;expect(finished).toBe(true);
    await gateway.prepare("next","caller-next");await gateway.cleanup("next");
  });

});
