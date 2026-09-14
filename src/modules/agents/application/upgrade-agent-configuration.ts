import type {
  AgentAudioConfiguration,
  AgentBehaviorConfiguration,
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
  createDefaultAgentBehavior,
} from "./agent-configuration-defaults.js";

export const AGENT_CONFIGURATION_SCHEMA_VERSION = 3 as const;

export const upgradeAgentConfiguration = (input: unknown): AgentConfiguration => {
  if (!isRecord(input)) throw new Error("agent configuration must be an object");
  if (input.schemaVersion !== undefined && input.schemaVersion !== 1 && input.schemaVersion !== 2 && input.schemaVersion !== 3) {
    throw new Error(`unsupported agent configuration schemaVersion: ${String(input.schemaVersion)}`);
  }
  if (input.schemaVersion === 3) return normalizeV3(input);
  if (input.schemaVersion === 2) return upgradeV2(input);
  return upgradeFlatConfiguration(input);
};

function normalizeV3(input: Record<string, unknown>): AgentConfiguration {
  const identity = record(input.identity);
  const locale = stringOr(identity.locale, "");
  return {
    schemaVersion: AGENT_CONFIGURATION_SCHEMA_VERSION,
    identity: {
      instructions: stringOr(identity.instructions, ""),
      locale,
    },
    enabledTools: enabledTools(input.enabledTools),
    conversation: normalizeConversation(record(input.conversation)),
    audio: normalizeAudio(record(input.audio)),
    behavior: normalizeBehavior(input.behavior, locale),
  };
}

function upgradeV2(input: Record<string, unknown>): AgentConfiguration {
  const locale = stringOr(record(input.identity).locale, "");
  return {
    ...normalizeV3({ ...input, schemaVersion: 3 }),
    behavior: createDefaultAgentBehavior(locale),
  };
}

function upgradeFlatConfiguration(input: Record<string, unknown>): AgentConfiguration {
  const conversation = record(input.conversation);
  const legacyTurnDetection = record(conversation.turnDetection);
  const locale = stringOr(input.locale, "");
  return {
    schemaVersion: AGENT_CONFIGURATION_SCHEMA_VERSION,
    identity: {
      instructions: stringOr(input.instructions, ""),
      locale,
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
    behavior: createDefaultAgentBehavior(locale),
  };
}

function normalizeBehavior(value: unknown, locale: string): AgentBehaviorConfiguration {
  const defaults = createDefaultAgentBehavior(locale);
  const input = record(value);
  const greeting = record(input.greeting);
  const greetingMode = enumOrDefault(
    greeting.mode,
    ["wait_for_caller", "automatic"] as const,
    defaults.greeting.mode,
    "behavior.greeting.mode",
  );
  const responseStyle = record(input.responseStyle);
  const silence = record(input.silence);
  const slotOffering = record(input.slotOffering);
  return {
    greeting: greetingMode === "automatic"
      ? { mode: "automatic", message: stringOr(greeting.message, "") }
      : { mode: "wait_for_caller" },
    responseStyle: {
      brevity: enumOrDefault(
        responseStyle.brevity,
        ["brief", "balanced", "detailed"] as const,
        defaults.responseStyle.brevity,
        "behavior.responseStyle.brevity",
      ),
      tone: enumOrDefault(
        responseStyle.tone,
        ["warm", "professional", "direct"] as const,
        defaults.responseStyle.tone,
        "behavior.responseStyle.tone",
      ),
      pace: enumOrDefault(
        responseStyle.pace,
        ["slow", "balanced", "fast"] as const,
        defaults.responseStyle.pace,
        "behavior.responseStyle.pace",
      ),
    },
    silence: {
      message: stringOr(silence.message, defaults.silence.message),
      maxPrompts: numberOr(silence.maxPrompts, defaults.silence.maxPrompts),
    },
    slotOffering: {
      maximumOptions: numberOr(
        slotOffering.maximumOptions,
        defaults.slotOffering.maximumOptions,
      ),
      strategy: enumOrDefault(
        slotOffering.strategy,
        ["earliest_first", "spread_across_day", "match_requested_time"] as const,
        defaults.slotOffering.strategy,
        "behavior.slotOffering.strategy",
      ),
    },
    dataCollectionOrder: Array.isArray(input.dataCollectionOrder)
      ? input.dataCollectionOrder.filter((field): field is AgentBehaviorConfiguration["dataCollectionOrder"][number] =>
        typeof field === "string" && ["full_name", "phone_number", "service"].includes(field))
      : [...defaults.dataCollectionOrder],
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
