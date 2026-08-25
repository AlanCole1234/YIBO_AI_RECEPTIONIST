export type RuntimeKind = "openai-realtime" | "in-memory";

export interface ApplicationConfiguration {
  runtime: RuntimeKind;
  openAiRealtimeModel: string;
  conversationVoice: string;
  maxOutputTokens: number;
  openAiApiKey?: string;
  vadThreshold?: number;
  vadPrefixPaddingMs?: number;
  vadSilenceDurationMs?: number;
}

export class ConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigurationError";
  }
}

export function loadConfiguration(environment: NodeJS.ProcessEnv = process.env): ApplicationConfiguration {
  const runtime = environment.YIBO_RUNTIME?.trim() || "in-memory";
  if (runtime !== "openai-realtime" && runtime !== "in-memory") {
    throw new ConfigurationError("YIBO_RUNTIME must be openai-realtime or in-memory");
  }

  const openAiRealtimeModel = environment.OPENAI_REALTIME_MODEL?.trim() || "gpt-realtime-2.1";
  const conversationVoice = environment.YIBO_VOICE?.trim() || "marin";
  const maxOutputTokens = optionalIntegerInRange(
    environment.YIBO_MAX_OUTPUT_TOKENS,
    "YIBO_MAX_OUTPUT_TOKENS",
    1,
    4096,
  ) ?? 512;
  const openAiApiKey = environment.OPENAI_API_KEY?.trim();
  const vadThreshold = optionalNumber(environment.YIBO_VAD_THRESHOLD, "YIBO_VAD_THRESHOLD", 0, 1);
  const vadPrefixPaddingMs = optionalInteger(environment.YIBO_VAD_PREFIX_PADDING_MS, "YIBO_VAD_PREFIX_PADDING_MS");
  const vadSilenceDurationMs = optionalInteger(environment.YIBO_VAD_SILENCE_DURATION_MS, "YIBO_VAD_SILENCE_DURATION_MS");
  if (runtime === "openai-realtime" && !openAiApiKey) {
    throw new ConfigurationError("OPENAI_API_KEY is required when YIBO_RUNTIME=openai-realtime");
  }

  return {
    runtime,
    openAiRealtimeModel,
    conversationVoice,
    maxOutputTokens,
    ...(openAiApiKey ? { openAiApiKey } : {}),
    ...(vadThreshold === undefined ? {} : { vadThreshold }),
    ...(vadPrefixPaddingMs === undefined ? {} : { vadPrefixPaddingMs }),
    ...(vadSilenceDurationMs === undefined ? {} : { vadSilenceDurationMs }),
  };
}

function optionalNumber(raw: string | undefined, name: string, minimum: number, maximum: number): number | undefined {
  if (raw === undefined || !raw.trim()) return undefined;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    throw new ConfigurationError(`${name} must be between ${minimum} and ${maximum}`);
  }
  return value;
}

function optionalInteger(raw: string | undefined, name: string): number | undefined {
  const value = optionalNumber(raw, name, 0, Number.MAX_SAFE_INTEGER);
  if (value !== undefined && !Number.isInteger(value)) throw new ConfigurationError(`${name} must be a non-negative integer`);
  return value;
}

function optionalIntegerInRange(
  raw: string | undefined,
  name: string,
  minimum: number,
  maximum: number,
): number | undefined {
  const value = optionalNumber(raw, name, minimum, maximum);
  if (value !== undefined && !Number.isInteger(value)) {
    throw new ConfigurationError(`${name} must be an integer between ${minimum} and ${maximum}`);
  }
  return value;
}
