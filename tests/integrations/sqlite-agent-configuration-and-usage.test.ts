import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

describe("SQLite agent configuration and usage", () => {
  it("persists tenant configuration and aggregates usage without content", () => {
    const output = execFileSync(process.execPath, [
      "--import", "tsx", "tests/fixtures/sqlite-agent-configuration-and-usage.ts",
    ], { encoding: "utf8", cwd: process.cwd() });
    const result = JSON.parse(output.trim()) as {
      configuration: { voice: string; enabledTools: string[] };
      usage: Record<string, number>;
      calls: Array<{ callId: string; state: string; usage: Record<string, number> }>;
    };

    expect(result.configuration.voice).toBe("marin");
    expect(result.configuration.enabledTools).toHaveLength(4);
    expect(result.usage).toEqual({
      inputTokens: 100, outputTokens: 25, inputAudioMs: 12_000, outputAudioMs: 4_000, toolCalls: 2,
    });
    expect(result.calls).toEqual([expect.objectContaining({
      callId: "call-1", state: "COMPLETED", usage: result.usage,
    })]);
  });
});
