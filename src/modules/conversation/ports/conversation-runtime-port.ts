import type { AgentDefinition, AgentToolName } from "../../agents/index.js";

export interface AudioFrame {
  data: Uint8Array;
  codec: string;
  sampleRate: number;
  channels: number;
  timestampMs?: number;
}

export interface AssistantPlaybackPosition {
  assistantTurnId: string;
  audioEndMs: number;
}

export interface OpenConversationInput {
  conversationId: string;
  agent: Pick<AgentDefinition, "instructions" | "locale" | "voice" | "tools" | "conversation">;
  /** A private telephony test can disable only interruption handling, not voice input. */
  bargeInEnabled?: boolean;
}

export type ToolResultEnvelope =
  | { toolCallId: string; ok: true; data: unknown }
  | {
      toolCallId: string;
      ok: false;
      error: {
        code: string;
        message: string;
        retryable: boolean;
      };
    };

export type ConversationRuntimeEvent =
  | { type: "audio.delta"; assistantTurnId: string; frame: AudioFrame }
  | { type: "user.speech_started"; occurredAt?: string }
  | { type: "user.speech_stopped"; occurredAt?: string }
  | {
      type: "barge_in.detected";
      serverVadEventId?: string;
      accepted: boolean;
      reason: string;
      turnState: string;
      inboundRms: number;
      inboundPeak: number;
      adaptiveNoiseFloor: number;
      requiredRms: number;
      requiredSpeechMs: number;
      consecutiveSpeechMs: number;
      /** Measurements accumulated for the entire VAD speech interval, not its final silent frame. */
      maxRmsDuringSpeech: number;
      averageRmsDuringSpeech: number;
      maxPeakDuringSpeech: number;
      totalSpeechDurationMs: number;
      consecutiveAboveThresholdMs: number;
      assistantPlaybackMs?: number;
      realtimeResponseActive: boolean;
    }
  | {
      type: "tool.call";
      toolCallId: string;
      name: AgentToolName;
      arguments: unknown;
    }
  | { type: "assistant.transcript"; text: string; final: boolean }
  | { type: "assistant.response_created"; responseId?: string }
  | {
      type: "assistant.response_timing";
      turnNumber: number;
      speechDurationMs?: number;
      /** Server VAD owns the actual speech-end decision; this is its configured silence window. */
      configuredVadSilenceMs?: number;
      speechEndToCommitMs?: number;
      commitToDecisionMs?: number;
      toolDurationMs?: number;
      commitToResponseStartMs?: number;
      /** Provider acknowledgement time; excludes local grace and prior tool waits. */
      responseRequestToStartMs?: number;
      responseStartToFirstAudioMs: number;
      totalSpeechEndToFirstAudioMs: number;
      toolUsed?: boolean;
      bargeInOccurred?: boolean;
      startingState?: string;
      endingState?: string;
    }
  | { type: "assistant.response_done"; status?: string }
  | { type: "assistant.audio_completed"; assistantTurnId?: string }
  | { type: "silence.timeout" }
  | { type: "tool.execution"; phase: "started" | "completed" | "failed"; toolCallId: string; name: AgentToolName }
  | {
      type: "usage";
      inputTokens?: number;
      outputTokens?: number;
      totalTokens?: number;
      inputAudioMs?: number;
      outputAudioMs?: number;
      toolCalls?: number;
    }
  | { type: "error"; code: string; message: string; retryable: boolean }
  | { type: "closed"; reason?: string };

export interface ConversationRuntimePort {
  openSession(input: OpenConversationInput): Promise<ConversationRuntimeSession>;
}

export interface ConversationRuntimeSession {
  /** Starts the one-time assistant greeting after the call's media path is ready. */
  startGreeting?(): Promise<void>;
  sendText(text: string): Promise<void>;
  sendAudio(frame: AudioFrame): Promise<void>;
  sendToolResult(result: ToolResultEnvelope): Promise<void>;
  /** The transport has drained assistant audio; this is distinct from response.done. */
  assistantPlaybackEnded?(): void;
  interrupt(position?: AssistantPlaybackPosition): Promise<void>;
  close(): Promise<void>;
  events(): AsyncIterable<ConversationRuntimeEvent>;
}
