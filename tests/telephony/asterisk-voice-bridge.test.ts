import { describe, expect, it, vi } from "vitest";
import { success } from "../../src/shared/domain/result.js";
import { AsteriskVoiceBridge, type AsteriskAudioSession } from "../../src/modules/telephony/index.js";
import type { VoiceBridge } from "../../src/modules/voice/index.js";

const audio = { data: new Uint8Array([1, 2]), codec: "pcm_s16le", sampleRateHz: 8_000 };

describe("AsteriskVoiceBridge", () => {
  it("connects a correlated Asterisk AudioSocket stream to the existing VoiceBridge", async () => {
    const mediaSession: AsteriskAudioSession = {
      streamId: "d5da4d1e-1234-4cde-9000-123456789abc",
      inboundAudio: (async function* () { yield audio; })(),
      outboundAudio: { write: vi.fn(async () => undefined) },
      close: vi.fn(async () => undefined),
    };
    const media = { waitForSession: vi.fn(async () => mediaSession) };
    const voice: VoiceBridge = { start: vi.fn(async () => success({ close: vi.fn(async () => undefined), completed: Promise.resolve() })) };
    const bridge = new AsteriskVoiceBridge({ mediaStreamIdForCall: () => mediaSession.streamId }, media, voice);

    const result = await bridge.start({ callId: "call-1", tenantId: "tenant-1", agentSession: { close: async () => undefined } });
    expect(result.ok).toBe(true);
    expect(media.waitForSession).toHaveBeenCalledWith(mediaSession.streamId, 10_000);
    expect(voice.start).toHaveBeenCalledWith(expect.objectContaining({
      callId: "call-1", agentSession: { callId: "call-1", tenantId: "tenant-1" }, inboundAudio: mediaSession.inboundAudio,
    }));
    if (result.ok) await result.value.close();
    expect(mediaSession.close).toHaveBeenCalledTimes(1);
  });

  it("fails safely when Asterisk did not supply a correlated media stream", async () => {
    const bridge = new AsteriskVoiceBridge({ mediaStreamIdForCall: () => null }, { waitForSession: vi.fn() }, { start: vi.fn() });
    await expect(bridge.start({ callId: "call-1", tenantId: "tenant-1", agentSession: { close: async () => undefined } }))
      .resolves.toEqual({ ok: false, error: { code: "MEDIA_STREAM_NOT_FOUND" } });
  });
});
