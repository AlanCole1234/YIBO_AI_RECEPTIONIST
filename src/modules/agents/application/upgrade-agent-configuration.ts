import type {
  AgentAudioConfiguration,
  AgentConversationConfiguration,
  AgentTurnDetectionConfiguration,
} from "./contracts.js";
import type { AgentConfiguration } from "../ports/agent-dependencies.js";
import {
  DEFAULT_CONVERSATION_VOICE,
  DEFAULT_IDLE_TIMEOUT_MS,
  DEFAULT_MAX_OUTPUT_TOKENS,
  DEFAULT_NOISE_REDUCTION,
  DEFAULT_REALTIME_MODEL,
  DEFAULT_VAD_SILENCE_DURATION_MS,
} from "./agent-configuration-defaults.js";

export const AGENT_CONFIGURATION_SCHEMA_VERSION = 2 as const;

export const upgradeAgentConfiguration = (input: unknown): AgentConfiguration => {
  if (!isRecord(input)) throw new Error("agent configuration must be an object");
  if (input.schemaVersion !== undefined && input.schemaVersion !== 1 && input.schemaVersion !== 2) {
    throw new Error(`unsupported agent configuration schemaVersion: ${String(input.schemaVersion)}`);
  }
  return input.schemaVersion === 2 ? normalizeV2(input) : upgradeFlatConfiguration(input);
};

function normalizeV2(input: Record<string, unknown>): AgentConfiguration {
  const identity = record(input.identity);
  return {
    schemaVersion: AGENT_CONFIGURATION_SCHEMA_VERSION,
    identity: {
      instructions: stringOr(identity.instructions, ""),
      locale: stringOr(identity.locale, ""),
    },
    enabledTools: enabledTools(input.enabledTools),
    conversation: normalizeConversation(record(input.conversation)),
    audio: normalizeAudio(record(input.audio)),
  };
}

function upgradeFlatConfiguration(input: Record<string, unknown>): AgentConfiguration {
  const conversation = record(input.conversation);
  const legacyTurnDetection = record(conversation.turnDetection);
  return {
    schemaVersion: AGENT_CONFIGURATION_SCHEMA_VERSION,
    identity: {
      instructions: stringOr(input.instructions, ""),
      locale: stringOr(input.locale, ""),
    },
    enabledTools: enabledTools(input.enabledTools),
    conversation: {
      model: stringOr(conversation.model, DEFAULT_REALTIME_MODEL),
      maxOutputTokens: numberOr(conversation.maxOutputTokens, DEFAULT_MAX_OUTPUT_TOKENS),
      reasoningEffort: enumOrDefault(
        conversation.reasoningEffort,
        ["minimal", "low", "medium", "high"] as const,
        "minimal",
        "conversation.reasoningEffort",
      ),
      tracing: "disabled",
      truncation: { mode: "auto" },
    },
    audio: {
      voice: stringOr(input.voice, DEFAULT_CONVERSATION_VOICE),
      noiseReduction: DEFAULT_NOISE_REDUCTION,
      turnDetection: {
        type: "server_vad",
        createResponse: true,
        interruptResponse: true,
        idleTimeoutMs: DEFAULT_IDLE_TIMEOUT_MS,
        ...numberProperty(legacyTurnDetection, "threshold"),
        ...numberProperty(legacyTurnDetection, "prefixPaddingMs"),
        ...(typeof legacyTurnDetection.silenceDurationMs === "number"
          ? { silenceDurationMs: legacyTurnDetection.silenceDurationMs }
          : { silenceDurationMs: DEFAULT_VAD_SILENCE_DURATION_MS }),
      },
    },
  };
}

function normalizeConversation(input: Record<string, unknown>): AgentConversationConfiguration {
  return {
    model: stringOr(input.model, DEFAULT_REALTIME_MODEL),
    maxOutputTokens: numberOr(input.maxOutputTokens, DEFAULT_MAX_OUTPUT_TOKENS),
    reasoningEffort: enumOrDefault(
      input.reasoningEffort,
      ["minimal", "low", "medium", "high"] as const,
      "minimal",
      "conversation.reasoningEffort",
    ),
    tracing: enumOrDefault(input.tracing, ["disabled", "auto"] as const, "disabled", "conversation.tracing"),
    truncation: normalizeTruncation(input.truncation),
  };
}

function normalizeAudio(input: Record<string, unknown>): AgentAudioConfiguration {
  return {
    voice: stringOr(input.voice, DEFAULT_CONVERSATION_VOICE),
    noiseReduction: enumOrDefault(
      input.noiseReduction,
      ["disabled", "near_field", "far_field"] as const,
      DEFAULT_NOISE_REDUCTION,
      "audio.noiseReduction",
    ),
    turnDetection: normalizeTurnDetection(input.turnDetection),
  };
}

function normalizeTurnDetection(value: unknown): AgentTurnDetectionConfiguration {
  const input = record(value);
  const type = enumOrDefault(
    input.type,
    ["server_vad", "semantic_vad", "manual"] as const,
    "server_vad",
    "audio.turnDetection.type",
  );
  if (type === "manual") return { type };
  const createResponse = booleanOr(input.createResponse, true, "audio.turnDetection.createResponse");
  const interruptResponse = booleanOr(input.interruptResponse, true, "audio.turnDetection.interruptResponse");
  if (type === "semantic_vad") {
    return {
      type,
      eagerness: enumOrDefault(
        input.eagerness,
        ["auto", "low", "medium", "high"] as const,
        "auto",
        "audio.turnDetection.eagerness",
      ),
      createResponse,
      interruptResponse,
    };
  }
  return {
    type,
    createResponse,
    interruptResponse,
    idleTimeoutMs: input.idleTimeoutMs === null ? null : numberOr(input.idleTimeoutMs, DEFAULT_IDLE_TIMEOUT_MS),
    ...numberProperty(input, "threshold"),
    ...numberProperty(input, "prefixPaddingMs"),
    ...(typeof input.silenceDurationMs === "number"
      ? { silenceDurationMs: input.silenceDurationMs }
      : { silenceDurationMs: DEFAULT_VAD_SILENCE_DURATION_MS }),
  };
}

function normalizeTruncation(value: unknown): AgentConversationConfiguration["truncation"] {
  const input = record(value);
  const mode = enumOrDefault(
    input.mode,
    ["auto", "disabled", "retention_ratio"] as const,
    "auto",
    "conversation.truncation.mode",
  );
  if (mode !== "retention_ratio") return { mode };
  return {
    mode,
    retentionRatio: numberOr(input.retentionRatio, 0.8),
    ...(typeof input.postInstructionsTokens === "number"
      ? { postInstructionsTokens: input.postInstructionsTokens }
      : {}),
  };
}

function enabledTools(value: unknown): AgentConfiguration["enabledTools"] {
  const tools = Array.isArray(value) ? value.filter((tool): tool is string => typeof tool === "string") : [];
  return tools as AgentConfiguration["enabledTools"];
}

function enumOrDefault<const T extends readonly string[]>(
  value: unknown,
  allowed: T,
  fallback: T[number],
  field: string,
): T[number] {
  if (value === undefined) return fallback;
  if (typeof value === "string" && allowed.includes(value)) return value as T[number];
  throw new Error(`${field} is not supported`);
}

function booleanOr(value: unknown, fallback: boolean, field: string): boolean {
  if (value === undefined) return fallback;
  if (typeof value === "boolean") return value;
  throw new Error(`${field} must be a boolean`);
}

const record = (value: unknown): Record<string, unknown> => isRecord(value) ? value : {};
const stringOr = (value: unknown, fallback: string): string => typeof value === "string" ? value : fallback;
const numberOr = (value: unknown, fallback: number): number => typeof value === "number" ? value : fallback;
const numberProperty = (value: Record<string, unknown>, key: string): Record<string, number> =>
  typeof value[key] === "number" ? { [key]: value[key] } as Record<string, number> : {};
const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);
