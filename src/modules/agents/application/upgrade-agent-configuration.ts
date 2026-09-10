import type { ConversationBehavior } from "./contracts.js";
import type { AgentConfiguration } from "../ports/agent-dependencies.js";
import {
  DEFAULT_CONVERSATION_VOICE,
  DEFAULT_MAX_OUTPUT_TOKENS,
  DEFAULT_REALTIME_MODEL,
  DEFAULT_VAD_SILENCE_DURATION_MS,
} from "./agent-configuration-defaults.js";

export const AGENT_CONFIGURATION_SCHEMA_VERSION = 1 as const;

export const upgradeAgentConfiguration = (input: unknown): AgentConfiguration => {
  if (!isRecord(input)) throw new Error("agent configuration must be an object");
  if (input.schemaVersion !== undefined && input.schemaVersion !== AGENT_CONFIGURATION_SCHEMA_VERSION) {
    throw new Error(`unsupported agent configuration schemaVersion: ${String(input.schemaVersion)}`);
  }
  const conversation = isRecord(input.conversation) ? input.conversation : {};
  const hasTurnDetection = isRecord(conversation.turnDetection);
  const turnDetection = hasTurnDetection ? conversation.turnDetection as Record<string, unknown> : {};
  const reasoningEffort = isReasoningEffort(conversation.reasoningEffort)
    ? conversation.reasoningEffort
    : "minimal";
  const enabledTools = Array.isArray(input.enabledTools)
    ? input.enabledTools.filter((tool): tool is string => typeof tool === "string")
    : [];
  return {
    schemaVersion: AGENT_CONFIGURATION_SCHEMA_VERSION,
    instructions: typeof input.instructions === "string" ? input.instructions : "",
    locale: typeof input.locale === "string" ? input.locale : "",
    voice: typeof input.voice === "string" && input.voice.trim()
      ? input.voice
      : DEFAULT_CONVERSATION_VOICE,
    enabledTools: enabledTools as AgentConfiguration["enabledTools"],
    conversation: {
      model: typeof conversation.model === "string" && conversation.model.trim()
        ? conversation.model
        : DEFAULT_REALTIME_MODEL,
      maxOutputTokens: typeof conversation.maxOutputTokens === "number"
        ? conversation.maxOutputTokens
        : DEFAULT_MAX_OUTPUT_TOKENS,
      reasoningEffort,
      turnDetection: {
        ...(typeof turnDetection.threshold === "number" ? { threshold: turnDetection.threshold } : {}),
        ...(typeof turnDetection.prefixPaddingMs === "number" ? { prefixPaddingMs: turnDetection.prefixPaddingMs } : {}),
        ...(typeof turnDetection.silenceDurationMs === "number"
          ? { silenceDurationMs: turnDetection.silenceDurationMs }
          : !hasTurnDetection
            ? { silenceDurationMs: DEFAULT_VAD_SILENCE_DURATION_MS }
            : {}),
      },
    },
  };
};

const isReasoningEffort = (value: unknown): value is ConversationBehavior["reasoningEffort"] =>
  ["minimal", "low", "medium", "high"].includes(String(value));

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);
