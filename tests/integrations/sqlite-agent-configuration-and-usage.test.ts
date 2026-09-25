import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

describe("SQLite agent configuration and usage", () => {
  it("persists tenant configuration and aggregates usage without content", () => {
    const output = execFileSync(process.execPath, [
      "--import", "tsx", "tests/fixtures/sqlite-agent-configuration-and-usage.ts",
    ], { encoding: "utf8", cwd: process.cwd() });
    const result = JSON.parse(output.trim()) as {
      cas: boolean[]; inserted: boolean; duplicate: boolean; isolated: boolean;
      configuration: { schemaVersion: number; audio: { voice: string }; enabledTools: string[] };
      persistedSchemaVersion: number;
      usage: Record<string, number>;
      calls: Array<{ callId: string; state: string; usage: Record<string, number> }>;
    };

    expect(result.cas).toEqual([true, false]);
    expect(result.inserted).toBe(true); expect(result.duplicate).toBe(false); expect(result.isolated).toBe(true);
    expect(result.configuration.audio.voice).toBe("marin");
    expect(result.configuration.schemaVersion).toBe(4);
    expect(result.persistedSchemaVersion).toBe(4);
    expect(result.configuration.enabledTools).toHaveLength(8);
    expect(result.usage).toEqual({
      inputTokens: 100, outputTokens: 25, inputAudioMs: 12_000, outputAudioMs: 4_000, toolCalls: 2,
    });
    expect(result.calls).toEqual([expect.objectContaining({
      callId: "call-1", state: "COMPLETED", usage: result.usage,
    })]);
  });
});
