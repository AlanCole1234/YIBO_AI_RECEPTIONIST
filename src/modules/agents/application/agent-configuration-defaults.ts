import type { AgentConfiguration } from "../ports/agent-dependencies.js";
import type {
  AgentTurnDetectionConfiguration,
  ConversationBehavior,
} from "./contracts.js";
import { AGENT_TOOL_DEFINITIONS } from "./tool-definitions.js";

export const AGENT_CONFIGURATION_DEFAULTS_VERSION = 2;
export const DEFAULT_REALTIME_MODEL = "gpt-realtime-2.1";
export const DEFAULT_CONVERSATION_VOICE = "marin";
export const DEFAULT_MAX_OUTPUT_TOKENS = 512;
export const DEFAULT_VAD_SILENCE_DURATION_MS = 800;
export const DEFAULT_IDLE_TIMEOUT_MS = 6_000;
export const DEFAULT_NOISE_REDUCTION = "near_field" as const;

export interface DefaultAgentConfigurationInput {
  locale: string;
  businessName: string;
  model?: string;
  voice?: string;
  maxOutputTokens?: number;
  reasoningEffort?: ConversationBehavior["reasoningEffort"];
  turnDetection?: Partial<Extract<AgentTurnDetectionConfiguration, { type: "server_vad" }>>
    | AgentTurnDetectionConfiguration;
}

export function createDefaultAgentConfiguration(
  input: DefaultAgentConfigurationInput,
): AgentConfiguration {
  return {
    schemaVersion: 2,
    identity: {
      instructions: [
        "Speak warmly and naturally, using complete sentences and a conversational rhythm.",
        "Be concise, but never cut off a sentence or end abruptly.",
        "For a new booking, ask only: 'What day would you like to come in?' Wait for the answer before asking anything else. Resolve supported day phrases with check_availability, offer only the earliest available time first, and keep each reply to one or two short sentences. After the caller accepts an available time, collect the required contact details one question at a time, then create the appointment and confirm it only when the booking succeeds.",
      ].join(" "),
      locale: input.locale,
    },
    enabledTools: AGENT_TOOL_DEFINITIONS
      .filter(({ name }) => name !== "enable_developer_test_mode" && name !== "delete_test_appointments")
      .map(({ name }) => name),
    conversation: {
      model: input.model?.trim() || DEFAULT_REALTIME_MODEL,
      maxOutputTokens: input.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
      reasoningEffort: input.reasoningEffort ?? "minimal",
      tracing: "disabled",
      truncation: { mode: "auto" },
    },
    audio: {
      voice: input.voice?.trim() || DEFAULT_CONVERSATION_VOICE,
      noiseReduction: DEFAULT_NOISE_REDUCTION,
      turnDetection: resolveTurnDetection(input.turnDetection),
    },
  };
}

function resolveTurnDetection(
  input: DefaultAgentConfigurationInput["turnDetection"],
): AgentTurnDetectionConfiguration {
  if (input?.type === "semantic_vad" || input?.type === "manual") return structuredClone(input) as AgentTurnDetectionConfiguration;
  return {
    type: "server_vad",
    createResponse: input?.createResponse ?? true,
    interruptResponse: input?.interruptResponse ?? true,
    idleTimeoutMs: input?.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS,
    ...(input?.threshold === undefined ? {} : { threshold: input.threshold }),
    ...(input?.prefixPaddingMs === undefined ? {} : { prefixPaddingMs: input.prefixPaddingMs }),
    silenceDurationMs: input?.silenceDurationMs ?? DEFAULT_VAD_SILENCE_DURATION_MS,
  };
}
