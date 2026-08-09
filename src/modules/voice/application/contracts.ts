import type { Result } from "../../../shared/domain/result.js";

export interface AudioFrame {
  data: Uint8Array;
  codec: string;
  sampleRateHz: number;
  timestampMs?: number;
}

export interface AudioSink {
  write(frame: AudioFrame): Promise<void>;
}

export interface VoiceAgentSession {
  callId: string;
  tenantId: string;
}

export interface VoiceBridge {
  start(command: StartVoiceBridgeCommand): Promise<Result<VoiceBridgeSession, VoiceError>>;
}

export interface StartVoiceBridgeCommand {
  callId: string;
  agentSession: VoiceAgentSession;
  inboundAudio: AsyncIterable<AudioFrame>;
  outboundAudio: AudioSink;
}

export interface VoiceBridgeSession {
  close(): Promise<void>;
  completed: Promise<void>;
}

export type VoiceError =
  | { code: "INVALID_AUDIO_STREAM"; message: string }
  | { code: "AI_PROVIDER_UNAVAILABLE"; retryable: boolean };
