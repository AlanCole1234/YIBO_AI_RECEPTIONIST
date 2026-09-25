import type { AgentConfiguration } from "../ports/agent-dependencies.js";
import type {
  AgentAudioConfiguration,
  AgentChannel,
  AgentConversationConfiguration,
  AgentToolDefinition,
  ConversationBehavior,
} from "./contracts.js";
import { AGENT_TOOL_DEFINITIONS } from "./tool-definitions.js";

export type ReasoningEffort = ConversationBehavior["reasoningEffort"];

export interface RealtimeModelCapability {
  id: string;
  label: string;
  badge: string;
  description: string;
  voices: string[];
  pricing: RealtimeModelPricing;
  limits: {
    contextWindowTokens: number;
    modelMaxOutputTokens: number;
    responseOutputTokens: { minimum: number; maximum: number; uiMinimum: number; step: number };
  };
  controls: {
    reasoningEfforts: ReasoningEffort[];
    turnDetectionModes: Array<"server_vad" | "semantic_vad" | "manual">;
    semanticVadEagerness: Array<"auto" | "low" | "medium" | "high">;
    noiseReductionModes: Array<"disabled" | "near_field" | "far_field">;
    serverVad: {
      threshold: { minimum: number; maximum: number };
      prefixPaddingMs: { minimum: number; maximum: number };
      silenceDurationMs: { minimum: number; maximum: number };
    };
    idleTimeoutMs: { minimum: number; maximum: number };
    automaticResponse: boolean;
    responseInterruption: boolean;
    parallelToolCalls: boolean;
    toolChoice: boolean;
    tracing: boolean;
    truncation: boolean;
  };
}

export interface RealtimeModelPricing {
  currency: "USD";
  unitTokens: 1_000_000;
  verifiedAt: string;
  sourceUrl: string;
  text: { input: number; cachedInput: number; output: number };
  audio: { input: number; cachedInput: number; output: number };
}

export interface RealtimeRuntimeOptions {
  conversation: AgentConversationConfiguration;
  audio: AgentAudioConfiguration;
  channel?: AgentChannel;
  toolChoice: "auto" | "required" | "none";
  parallelToolCalls: boolean;
  tools: Array<Pick<AgentToolDefinition, "name" | "presentation">>;
}

const BUILT_IN_REALTIME_VOICES = [
  "marin", "cedar", "alloy", "ash", "ballad", "coral", "echo", "sage", "shimmer", "verse",
];
const REASONING_EFFORTS: ReasoningEffort[] = ["minimal", "low", "medium", "high"];

const common: Pick<RealtimeModelCapability, "voices" | "limits" | "controls"> = {
  voices: BUILT_IN_REALTIME_VOICES,
  limits: {
    contextWindowTokens: 128_000,
    modelMaxOutputTokens: 32_000,
    responseOutputTokens: { minimum: 1, maximum: 4_096, uiMinimum: 64, step: 64 },
  },
  controls: {
    reasoningEfforts: REASONING_EFFORTS,
    turnDetectionModes: ["server_vad", "semantic_vad", "manual"],
    semanticVadEagerness: ["auto", "low", "medium", "high"],
    noiseReductionModes: ["disabled", "near_field", "far_field"],
    serverVad: {
      threshold: { minimum: 0, maximum: 1 },
      prefixPaddingMs: { minimum: 0, maximum: 5_000 },
      silenceDurationMs: { minimum: 0, maximum: 10_000 },
    },
    idleTimeoutMs: { minimum: 1, maximum: 120_000 },
    automaticResponse: true,
    responseInterruption: true,
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
    pricing: {
      currency: "USD", unitTokens: 1_000_000, verifiedAt: "2026-09-21",
      sourceUrl: "https://developers.openai.com/api/docs/models/gpt-realtime-2.1",
      text: { input: 4, cachedInput: 0.4, output: 24 },
      audio: { input: 32, cachedInput: 0.4, output: 64 },
    },
    ...common,
  },
  {
    id: "gpt-realtime-2.1-mini",
    label: "GPT Realtime 2.1 Mini",
    badge: "Menor costo",
    description: "Más rápido y económico; puede perder matices en conversaciones complejas.",
    pricing: {
      currency: "USD", unitTokens: 1_000_000, verifiedAt: "2026-09-21",
      sourceUrl: "https://developers.openai.com/api/docs/models/gpt-realtime-2.1-mini",
      text: { input: 0.6, cachedInput: 0.06, output: 2.4 },
      audio: { input: 10, cachedInput: 0.3, output: 20 },
    },
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
    validateModelOptions(capability, configuration.conversation, configuration.audio);
    if (!capability.controls.toolChoice
      && Object.values(configuration.toolPolicies.channels).some(({ toolChoice }) => toolChoice !== "auto")) {
      throw new Error(`toolPolicies.channels.toolChoice is not supported by ${capability.id}`);
    }
    if (!capability.controls.parallelToolCalls
      && Object.values(configuration.toolPolicies.channels).some(({ parallelToolCalls }) => parallelToolCalls)) {
      throw new Error(`toolPolicies.channels.parallelToolCalls is not supported by ${capability.id}`);
    }
  }

  validateRuntimeOptions(options: RealtimeRuntimeOptions): void {
    const capability = this.get(options.conversation.model);
    if (!capability) throw new Error(`conversation.model is not supported: ${options.conversation.model}`);
    validateModelOptions(capability, options.conversation, options.audio);
    if (!capability.controls.toolChoice && options.toolChoice !== "auto") {
      throw new Error(`toolChoice is not supported by ${capability.id}`);
    }
    if (!capability.controls.parallelToolCalls && options.parallelToolCalls) {
      throw new Error(`parallelToolCalls is not supported by ${capability.id}`);
    }
    if (options.toolChoice === "required" && options.tools.length === 0) {
      throw new Error("toolChoice cannot be required without tools");
    }
    if (options.toolChoice === "none" && options.tools.length > 0) {
      throw new Error("tools must be empty when toolChoice is none");
    }
    if (new Set(options.tools.map(({ name }) => name)).size !== options.tools.length) {
      throw new Error("tools contains duplicate names");
    }
    if (options.tools.some(({ name }) => !AGENT_TOOL_DEFINITIONS.some((definition) => definition.name === name))) {
      throw new Error("tools contains an unknown tool");
    }
    if (options.parallelToolCalls
      && options.tools.some(({ name, presentation }) =>
        (presentation ?? AGENT_TOOL_DEFINITIONS.find((definition) => definition.name === name)?.presentation)?.kind !== "consult")) {
      throw new Error("parallelToolCalls requires read-only tools only");
    }
    if (options.channel === "phone" && options.audio.turnDetection.type === "manual") {
      throw new Error("manual turn detection is not supported by the phone channel");
    }
  }
}

function validateModelOptions(
  capability: RealtimeModelCapability,
  conversation: AgentConversationConfiguration,
  audio: AgentAudioConfiguration,
): void {
  if (!audio.voice || !capability.voices.includes(audio.voice)) {
    throw new Error(`voice is not supported by ${capability.id}`);
  }
  if (!capability.controls.reasoningEfforts.includes(conversation.reasoningEffort)) {
    throw new Error(`conversation.reasoningEffort is not supported by ${capability.id}`);
  }
  const output = capability.limits.responseOutputTokens;
  if (!Number.isInteger(conversation.maxOutputTokens)
    || conversation.maxOutputTokens < output.minimum
    || conversation.maxOutputTokens > output.maximum) {
    throw new Error(
      `conversation.maxOutputTokens must be an integer between ${output.minimum} and ${output.maximum} for ${capability.id}`,
    );
  }
  if (conversation.tracing === "auto" && !capability.controls.tracing) {
    throw new Error(`conversation.tracing is not supported by ${capability.id}`);
  }
  if (conversation.truncation.mode !== "auto" && !capability.controls.truncation) {
    throw new Error(`conversation.truncation is not supported by ${capability.id}`);
  }
  if (!capability.controls.noiseReductionModes.includes(audio.noiseReduction)) {
    throw new Error(`audio.noiseReduction is not supported by ${capability.id}`);
  }
  const turn = audio.turnDetection;
  if (!capability.controls.turnDetectionModes.includes(turn.type)) {
    throw new Error(`audio.turnDetection.type is not supported by ${capability.id}`);
  }
  if (turn.type === "semantic_vad" && !capability.controls.semanticVadEagerness.includes(turn.eagerness)) {
    throw new Error(`audio.turnDetection.eagerness is not supported by ${capability.id}`);
  }
  if (turn.type !== "manual") {
    if (turn.createResponse && !capability.controls.automaticResponse) {
      throw new Error(`audio.turnDetection.createResponse is not supported by ${capability.id}`);
    }
    if (turn.interruptResponse && !capability.controls.responseInterruption) {
      throw new Error(`audio.turnDetection.interruptResponse is not supported by ${capability.id}`);
    }
  }
  if (turn.type === "server_vad") {
    const vad = capability.controls.serverVad;
    validateOptionalRange("threshold", turn.threshold, vad.threshold, false);
    validateOptionalRange("prefixPaddingMs", turn.prefixPaddingMs, vad.prefixPaddingMs, true);
    validateOptionalRange("silenceDurationMs", turn.silenceDurationMs, vad.silenceDurationMs, true);
    validateOptionalRange("idleTimeoutMs", turn.idleTimeoutMs ?? undefined, capability.controls.idleTimeoutMs, true);
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
