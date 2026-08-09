import type { Result } from "../../../shared/domain/result.js";
import type { AudioFrame, VoiceAgentSession } from "../application/contracts.js";

export interface VoiceAIProvider {
  openSession(config: OpenVoiceProviderSessionConfig): Promise<Result<ProviderVoiceSession, AIProviderError>>;
}

export interface OpenVoiceProviderSessionConfig {
  callId: string;
  agentSession: VoiceAgentSession;
}

export interface ProviderVoiceSession {
  sendAudio(frame: AudioFrame): Promise<void>;
  onAudio(handler: (frame: AudioFrame) => Promise<void>): void;
  close(): Promise<void>;
}

export type AIProviderError =
  | { code: "AUTHORIZATION_REQUIRED" }
  | { code: "RATE_LIMITED"; retryAfterMs?: number }
  | { code: "PROVIDER_UNAVAILABLE"; retryable: boolean }
  | { code: "VALIDATION_ERROR"; message: string };
