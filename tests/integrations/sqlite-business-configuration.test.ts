import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

describe("SQLite business configuration", () => {
  it("atomically increments the version and rejects stale writers", () => {
    const output = execFileSync(process.execPath, [
      "--import", "tsx", "tests/fixtures/sqlite-business-configuration.ts",
    ], { encoding: "utf8", cwd: process.cwd() });
    expect(JSON.parse(output.trim())).toMatchObject({
      initialVersion: 1,
      saved: { saved: true, version: 2 },
      stale: { saved: false, currentVersion: 2 },
      final: { version: 2, profile: { name: "SQLite updated" } },
      professionalUsage: { anyLocation: true, defaultLocation: true, otherLocation: false },
    });
  });
});
