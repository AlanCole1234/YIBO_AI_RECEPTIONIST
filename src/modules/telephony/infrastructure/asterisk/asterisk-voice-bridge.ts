import { failure, success } from "../../../../shared/domain/result.js";
import type { CallVoiceBridge } from "../../../calls/index.js";
import type { VoiceBridge } from "../../../voice/index.js";
import type { AsteriskAudioSession } from "./asterisk-audio-socket-server.js";

export interface AsteriskMediaSessionProvider {
  waitForSession(streamId: string, timeoutMs?: number): Promise<AsteriskAudioSession>;
}

export interface AsteriskCallMediaLookup {
  mediaStreamIdForCall(callId: string): string | null;
}

/**
 * Adapts a live Asterisk AudioSocket session to the existing VoiceBridge.
 * Calls depends only on CallVoiceBridge; Voice receives only AudioFrame data.
 */
export class AsteriskVoiceBridge implements CallVoiceBridge {
  constructor(
    private readonly mediaLookup: AsteriskCallMediaLookup,
    private readonly media: AsteriskMediaSessionProvider,
    private readonly voice: VoiceBridge,
    private readonly mediaConnectTimeoutMs = 10_000,
  ) {}

  async start(input: { callId: string; tenantId: string; agentSession: { close(): Promise<void> } }) {
    const streamId = this.mediaLookup.mediaStreamIdForCall(input.callId);
    if (!streamId) return failure({ code: "MEDIA_STREAM_NOT_FOUND" });

    let session: AsteriskAudioSession;
    try {
      session = await this.media.waitForSession(streamId, this.mediaConnectTimeoutMs);
    } catch {
      return failure({ code: "MEDIA_STREAM_UNAVAILABLE", retryable: true });
    }
    const bridge = await this.voice.start({
      callId: input.callId,
      agentSession: { callId: input.callId, tenantId: input.tenantId },
      inboundAudio: session.inboundAudio,
      outboundAudio: session.outboundAudio,
    });
    if (!bridge.ok) {
      await session.close();
      return failure(bridge.error);
    }
    return success({
      close: async () => {
        await bridge.value.close();
        await session.close();
      },
    });
  }
}
