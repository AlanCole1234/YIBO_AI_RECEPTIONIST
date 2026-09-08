import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const run = promisify(execFile);

describe("regional SQLite startup", () => {
  it("allows API and voice processes to initialize the same regional database", async () => {
    const directory = await mkdtemp(join(tmpdir(), "yibo-regional-db-"));
    const path = join(directory, "yibo-us.sqlite");
    const worker = ["--import", "tsx", "tests/fixtures/regional-database-startup-worker.ts", path];

    try {
      const [api, voice] = await Promise.all([
        run(process.execPath, worker, { cwd: process.cwd() }),
        run(process.execPath, worker, { cwd: process.cwd() }),
      ]);

      expect(api.stdout).toContain("regional database startup complete");
      expect(voice.stdout).toContain("regional database startup complete");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
