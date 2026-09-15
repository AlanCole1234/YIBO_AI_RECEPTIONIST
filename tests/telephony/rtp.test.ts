import { describe, expect, it } from "vitest";
import { createRtpPacket, parseRtpPacket, RTP_ULAW_PAYLOAD_TYPE } from "../../src/modules/telephony/infrastructure/asterisk/rtp.js";

describe("Asterisk External Media RTP packets", () => {
  it("round-trips a static µ-law RTP packet with sequence, timestamp, and SSRC", () => {
    const packet = createRtpPacket({
      payload: new Uint8Array([0xff, 0x7f, 0x00]),
      sequenceNumber: 91,
      timestamp: 8_000,
      ssrc: 1234,
      marker: true,
    });
    const parsed = parseRtpPacket(packet);
    expect(parsed).toEqual({
      payloadType: RTP_ULAW_PAYLOAD_TYPE,
      sequenceNumber: 91,
      timestamp: 8_000,
      ssrc: 1234,
      marker: true,
      payload: new Uint8Array([0xff, 0x7f, 0x00]),
    });
  });

  it("rejects malformed RTP rather than treating it as caller audio", () => {
    expect(parseRtpPacket(new Uint8Array([0, 1, 2]))).toBeNull();
  });
});
