import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

describe("SQLite snapshot", () => {
  it("copies a migrated database and checks integrity", () => {
    const output = execFileSync(process.execPath, ["--import", "tsx", "tests/fixtures/sqlite-snapshot.ts"], {
      encoding: "utf8",
      cwd: process.cwd(),
    });
    expect(output).toContain("snapshot integrity:ok");
  });

  it.each(["missing-source", "existing-destination", "private-copy"])("protects backup input/output: %s", (scenario) => {
    const output = execFileSync(process.execPath, ["--import", "tsx", "tests/fixtures/sqlite-snapshot.ts", scenario], {
      encoding: "utf8",
      cwd: process.cwd(),
    });
    expect(output).toContain(`snapshot ${scenario}:ok`);
  });
});
