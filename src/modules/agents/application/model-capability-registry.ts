import type { AgentConfiguration } from "../ports/agent-dependencies.js";
import type { ConversationBehavior } from "./contracts.js";

export type ReasoningEffort = ConversationBehavior["reasoningEffort"];

export interface RealtimeModelCapability {
  id: string;
  label: string;
  badge: string;
  description: string;
  voices: string[];
  limits: {
    contextWindowTokens: number;
    modelMaxOutputTokens: number;
    responseOutputTokens: { minimum: number; maximum: number; uiMinimum: number; step: number };
  };
  controls: {
    reasoningEfforts: ReasoningEffort[];
    serverVad: {
      threshold: { minimum: number; maximum: number };
      prefixPaddingMs: { minimum: number; maximum: number };
      silenceDurationMs: { minimum: number; maximum: number };
    };
    parallelToolCalls: boolean;
    toolChoice: boolean;
    tracing: boolean;
    truncation: boolean;
  };
}

const BUILT_IN_REALTIME_VOICES = [
  "marin", "cedar", "alloy", "ash", "ballad", "coral", "echo", "sage", "shimmer", "verse",
];
const REASONING_EFFORTS: ReasoningEffort[] = ["minimal", "low", "medium", "high"];

const common = {
  voices: BUILT_IN_REALTIME_VOICES,
  limits: {
    contextWindowTokens: 128_000,
    modelMaxOutputTokens: 32_000,
    responseOutputTokens: { minimum: 1, maximum: 4_096, uiMinimum: 64, step: 64 },
  },
  controls: {
    reasoningEfforts: REASONING_EFFORTS,
    serverVad: {
      threshold: { minimum: 0, maximum: 1 },
      prefixPaddingMs: { minimum: 0, maximum: 5_000 },
      silenceDurationMs: { minimum: 0, maximum: 10_000 },
    },
    parallelToolCalls: true,
    toolChoice: true,
    tracing: true,
    truncation: true,
  },
};

const MODEL_CAPABILITIES: RealtimeModelCapability[] = [
  {
    id: "gpt-realtime-2.1",
    label: "GPT Realtime 2.1",
    badge: "Recomendado",
    description: "Mayor calidad para conversaciones, interrupciones y uso de herramientas.",
    ...common,
  },
  {
    id: "gpt-realtime-2.1-mini",
    label: "GPT Realtime 2.1 Mini",
    badge: "Menor costo",
    description: "Más rápido y económico; puede perder matices en conversaciones complejas.",
    ...common,
  },
];

export class RealtimeModelCapabilityRegistry {
  list(): RealtimeModelCapability[] {
    return structuredClone(MODEL_CAPABILITIES);
  }

  get(model: string): RealtimeModelCapability | null {
    const capability = MODEL_CAPABILITIES.find(({ id }) => id === model);
    return capability ? structuredClone(capability) : null;
  }

  validate(configuration: AgentConfiguration): void {
    const capability = this.get(configuration.conversation.model);
    if (!capability) throw new Error(`conversation.model is not supported: ${configuration.conversation.model}`);
    if (!configuration.voice || !capability.voices.includes(configuration.voice)) {
      throw new Error(`voice is not supported by ${capability.id}`);
    }
    if (!capability.controls.reasoningEfforts.includes(configuration.conversation.reasoningEffort)) {
      throw new Error(`conversation.reasoningEffort is not supported by ${capability.id}`);
    }
    const output = capability.limits.responseOutputTokens;
    if (!Number.isInteger(configuration.conversation.maxOutputTokens)
      || configuration.conversation.maxOutputTokens < output.minimum
      || configuration.conversation.maxOutputTokens > output.maximum) {
      throw new Error(
        `conversation.maxOutputTokens must be an integer between ${output.minimum} and ${output.maximum} for ${capability.id}`,
      );
    }
    const vad = capability.controls.serverVad;
    validateOptionalRange("threshold", configuration.conversation.turnDetection.threshold, vad.threshold, false);
    validateOptionalRange("prefixPaddingMs", configuration.conversation.turnDetection.prefixPaddingMs, vad.prefixPaddingMs, true);
    validateOptionalRange("silenceDurationMs", configuration.conversation.turnDetection.silenceDurationMs, vad.silenceDurationMs, true);
  }
}

function validateOptionalRange(
  name: string,
  value: number | undefined,
  range: { minimum: number; maximum: number },
  integer: boolean,
): void {
  if (value === undefined) return;
  if (!Number.isFinite(value) || (integer && !Number.isInteger(value)) || value < range.minimum || value > range.maximum) {
    throw new Error(`turnDetection.${name} must be between ${range.minimum} and ${range.maximum}`);
  }
}
