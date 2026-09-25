import type {
  AgentConfiguration,
  RealtimeModelCapability,
  TurnDetectionMode,
} from "./api.js";

export function phoneTurnDetectionModes(capability?: RealtimeModelCapability): TurnDetectionMode[] {
  return (capability?.controls.turnDetectionModes ?? []).filter((mode) => mode !== "manual");
}

export function validateAgentCapabilityFields(
  value?: AgentConfiguration,
  capability?: RealtimeModelCapability,
): Record<string, string> {
  if (!value) return {};
  const errors: Record<string, string> = {};
  if (!capability) return { model: "This model is not available." };
  if (!capability.voices.includes(value.audio.voice)) errors.voice = "This voice is not supported by the selected model.";
  if (!capability.controls.reasoningEfforts.includes(value.conversation.reasoningEffort)) errors.reasoning = "This reasoning level is not supported.";
  const output = capability.limits.responseOutputTokens;
  if (!Number.isInteger(value.conversation.maxOutputTokens)
    || value.conversation.maxOutputTokens < output.minimum
    || value.conversation.maxOutputTokens > output.maximum) {
    errors.maxOutputTokens = `Choose between ${output.minimum} and ${output.maximum} tokens.`;
  }
  const turn = value.audio.turnDetection;
  if (!phoneTurnDetectionModes(capability).includes(turn.type)) {
    errors.turnDetection = "This turn mode is unavailable for phone calls.";
  }
  if (turn.type === "server_vad") {
    const checks = [
      ["threshold", turn.threshold, capability.controls.serverVad.threshold],
      ["prefixPaddingMs", turn.prefixPaddingMs, capability.controls.serverVad.prefixPaddingMs],
      ["silenceDurationMs", turn.silenceDurationMs, capability.controls.serverVad.silenceDurationMs],
    ] as const;
    for (const [field, candidate, range] of checks) {
      if (candidate !== undefined && (candidate < range.minimum || candidate > range.maximum)) {
        errors[field] = `Choose between ${range.minimum} and ${range.maximum}.`;
      }
    }
  }
  return errors;
}
