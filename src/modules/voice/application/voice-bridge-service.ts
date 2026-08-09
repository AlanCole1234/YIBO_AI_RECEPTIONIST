import { failure, success } from "../../../shared/domain/result.js";
import type { VoiceBridge, StartVoiceBridgeCommand, VoiceBridgeSession, VoiceError, AudioFrame } from "./contracts.js";
import type { ProviderVoiceSession, VoiceAIProvider } from "../ports/voice-ai-provider.js";

export class VoiceBridgeService implements VoiceBridge {
  constructor(private readonly provider: VoiceAIProvider) {}

  async start(command: StartVoiceBridgeCommand) {
    if (!command.callId || command.callId !== command.agentSession.callId) {
      return failure<VoiceError>({ code: "INVALID_AUDIO_STREAM", message: "A voice bridge requires the matching call ID." });
    }

    const opened = await this.provider.openSession({ callId: command.callId, agentSession: command.agentSession });
    if (!opened.ok) {
      return failure<VoiceError>({
        code: "AI_PROVIDER_UNAVAILABLE",
        retryable: opened.error.code === "PROVIDER_UNAVAILABLE" ? opened.error.retryable : false,
      });
    }

    return success<VoiceBridgeSession>(this.createSession(opened.value, command));
  }

  private createSession(providerSession: ProviderVoiceSession, command: StartVoiceBridgeCommand): VoiceBridgeSession {
    let closed = false;
    let closePromise: Promise<void> | undefined;
    const close = async (): Promise<void> => {
      if (closePromise) return closePromise;
      closed = true;
      closePromise = providerSession.close();
      return closePromise;
    };

    providerSession.onAudio(async (frame) => {
      if (!closed) await command.outboundAudio.write(frame);
    });

    const completed = (async () => {
      try {
        for await (const frame of command.inboundAudio) {
          if (closed) break;
          if (!isValidFrame(frame)) break;
          // Awaiting each send deliberately applies backpressure to the inbound stream.
          await providerSession.sendAudio(frame);
        }
      } finally {
        await close();
      }
    })();

    return { close, completed };
  }
}

const isValidFrame = (frame: AudioFrame): boolean =>
  frame.data.byteLength > 0 && frame.codec.length > 0 && Number.isFinite(frame.sampleRateHz) && frame.sampleRateHz > 0;
