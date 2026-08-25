import type { Result } from "../../../shared/domain/result.js";
import type {
  AudioFrame,
  AudioSink,
  ConversationTransport,
} from "../../conversation/index.js";

export interface VoiceMediaGateway {
  open(callId: string): Promise<Result<ConversationTransport, VoiceMediaError>>;
}

export type VoiceMediaError = { code: "MEDIA_NOT_AVAILABLE"; message: string };

export type { AudioFrame, AudioSink, ConversationTransport };
