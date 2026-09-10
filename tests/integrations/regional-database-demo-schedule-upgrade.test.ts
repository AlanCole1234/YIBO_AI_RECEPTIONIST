import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const run = promisify(execFile);

describe("legacy development demo schedule upgrade", () => {
  it("upgrades only the old 09:00 demo schedule while preserving the clinic's timezone", async () => {
    const directory = await mkdtemp(join(tmpdir(), "yibo-demo-schedule-"));
    const path = join(directory, "yibo-us.sqlite");
    try {
      const profile = await runWorker(path, "legacy");
      expect(profile.timezone).toBe("America/Denver");
      expect(profile.openingHours.every((rule: { startTime: string }) => rule.startTime === "07:00")).toBe(true);
      expect(profile.slotIntervalMinutes).toBe(30);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("does not overwrite a clinic that intentionally changed its schedule", async () => {
    const directory = await mkdtemp(join(tmpdir(), "yibo-custom-schedule-"));
    const path = join(directory, "yibo-us.sqlite");
    try {
      const profile = await runWorker(path, "custom");
      expect(profile.openingHours[0]?.startTime).toBe("10:00");
      expect(profile.slotIntervalMinutes).toBe(45);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

async function runWorker(path: string, mode: "legacy" | "custom"): Promise<any> {
  const result = await run(process.execPath, [
    "--import", "tsx", "tests/fixtures/regional-database-demo-schedule-upgrade-worker.ts", path, mode,
  ], { cwd: process.cwd() });
  return JSON.parse(result.stdout.trim().split("\n").at(-1)!);
}
