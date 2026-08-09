import { describe, expect, it, vi } from "vitest";
import { success } from "../../src/shared/domain/result.js";
import { VoiceBridgeService, type AudioFrame, type ProviderVoiceSession, type VoiceAIProvider } from "../../src/modules/voice/index.js";

const frame = (data = 1): AudioFrame => ({ data: new Uint8Array([data]), codec: "pcm_s16le", sampleRateHz: 16_000 });

const frames = async function* (): AsyncGenerator<AudioFrame> {
  yield frame(1);
  yield frame(2);
};

const createProvider = () => {
  let outboundHandler: ((audio: AudioFrame) => Promise<void>) | undefined;
  const providerSession: ProviderVoiceSession = {
    sendAudio: vi.fn(async () => undefined),
    onAudio: vi.fn((handler) => { outboundHandler = handler; }),
    close: vi.fn(async () => undefined),
  };
  const provider: VoiceAIProvider = { openSession: vi.fn(async () => success(providerSession)) };
  return { provider, providerSession, emit: async (audio: AudioFrame) => outboundHandler?.(audio) };
};

describe("VoiceBridgeService", () => {
  it("bridges inbound audio to the provider and provider audio to telephony", async () => {
    const fixture = createProvider();
    const written: AudioFrame[] = [];
    const result = await new VoiceBridgeService(fixture.provider).start({
      callId: "call-1", agentSession: { callId: "call-1", tenantId: "tenant-1" }, inboundAudio: frames(),
      outboundAudio: { write: async (audio) => { written.push(audio); } },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    await fixture.emit(frame(3));
    await result.value.completed;
    expect(fixture.providerSession.sendAudio).toHaveBeenCalledTimes(2);
    expect(written).toEqual([frame(3)]);
    expect(fixture.providerSession.close).toHaveBeenCalledTimes(1);
  });

  it("does not open an AI provider session for mismatched call identities", async () => {
    const fixture = createProvider();
    const result = await new VoiceBridgeService(fixture.provider).start({
      callId: "call-1", agentSession: { callId: "call-2", tenantId: "tenant-1" }, inboundAudio: frames(), outboundAudio: { write: async () => undefined },
    });
    expect(result).toEqual({ ok: false, error: { code: "INVALID_AUDIO_STREAM", message: "A voice bridge requires the matching call ID." } });
    expect(fixture.provider.openSession).not.toHaveBeenCalled();
  });

  it("maps a provider outage to a safe, retryable voice error", async () => {
    const provider: VoiceAIProvider = { openSession: async () => ({ ok: false, error: { code: "PROVIDER_UNAVAILABLE", retryable: true } }) };
    await expect(new VoiceBridgeService(provider).start({
      callId: "call-1", agentSession: { callId: "call-1", tenantId: "tenant-1" }, inboundAudio: frames(), outboundAudio: { write: async () => undefined },
    })).resolves.toEqual({ ok: false, error: { code: "AI_PROVIDER_UNAVAILABLE", retryable: true } });
  });

  it("closes idempotently when the caller ends the bridge before the stream completes", async () => {
    const fixture = createProvider();
    const neverEnding = async function* (): AsyncGenerator<AudioFrame> { yield frame(); await new Promise(() => undefined); };
    const result = await new VoiceBridgeService(fixture.provider).start({
      callId: "call-1", agentSession: { callId: "call-1", tenantId: "tenant-1" }, inboundAudio: neverEnding(), outboundAudio: { write: async () => undefined },
    });
    if (!result.ok) throw new Error("Expected bridge to start");
    await result.value.close();
    await result.value.close();
    expect(fixture.providerSession.close).toHaveBeenCalledTimes(1);
  });
});
