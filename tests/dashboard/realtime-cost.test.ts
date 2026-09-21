import { describe, expect, it } from "vitest";
import {
  addRealtimeUsage,
  emptyRealtimeSessionUsage,
  estimateRealtimeCost,
} from "../../dashboard/src/services/realtime-cost.js";

describe("Realtime cost estimate", () => {
  it("accumulates provider usage and applies text, audio and cache rates", () => {
    const usage = addRealtimeUsage(emptyRealtimeSessionUsage(), {
      inputTokens: 1_100,
      outputTokens: 250,
      inputTextTokens: 1_000,
      outputTextTokens: 200,
      inputAudioTokens: 100,
      outputAudioTokens: 50,
      cachedInputTokens: 420,
      cachedInputTextTokens: 400,
      cachedInputAudioTokens: 20,
      toolCalls: 2,
    });
    const cost = estimateRealtimeCost(usage, {
      currency: "USD", unitTokens: 1_000_000, verifiedAt: "2026-09-21", sourceUrl: "https://example.test",
      text: { input: 4, cachedInput: 0.4, output: 24 },
      audio: { input: 32, cachedInput: 0.4, output: 64 },
    });

    expect(cost).toBeCloseTo(0.013128, 8);
    expect(usage.toolCalls).toBe(2);
  });
});
