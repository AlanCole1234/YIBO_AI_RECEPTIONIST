import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

describe("Configured hosted Google Calendar callback", () => {
  it.each(["connected", "provider-rejected", "consent-denied", "config-override", "providers-disabled"])("verifies %s with the configured application and isolated SQLite", scenario => {
    // The existing Vitest/Vite version cannot import node:sqlite directly.
    const output = execFileSync(process.execPath, ["--import", "tsx", "tests/fixtures/hosted-google-calendar-callback.ts", scenario],
      { encoding: "utf8", cwd: process.cwd(), timeout: 15_000 });
    expect(JSON.parse(output)).toEqual({ scenario, verified: true });
  });
});
