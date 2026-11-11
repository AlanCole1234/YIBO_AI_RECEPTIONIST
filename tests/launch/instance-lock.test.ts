import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

describe("single-instance lock", () => {
  it.each(["single-owner", "stale-release", "foreign-lock", "concurrent-start", "crash-restart"])(
    "preserves exclusive process ownership: %s", (scenario) => {
      const output = execFileSync(process.execPath, [
        "--import", "tsx", "tests/fixtures/instance-lock-process.ts", scenario,
      ], { encoding: "utf8", timeout: 15_000 });
      expect(output).toContain(`instance lock:${scenario}:ok`);
    },
  );
});
