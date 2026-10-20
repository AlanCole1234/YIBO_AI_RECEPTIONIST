import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { acquireInstanceLock } from "../../src/bootstrap/instance-lock.js";

const scenario = process.argv[2];
if (scenario === "hold") {
  try {
    const release = acquireInstanceLock(process.argv[3]!);
    process.send?.("acquired");
    process.once("SIGTERM", () => { release(); process.exit(0); });
    setInterval(() => {}, 1_000);
  } catch {
    process.send?.("refused", () => process.exit(1));
  }
} else {
  const directory = mkdtempSync(join(tmpdir(), "yibo-instance-lock-"));
  const path = join(directory, "instance.lock");
  const children: ChildProcess[] = [];
  const releases: Array<() => void> = [];
  const start = () => {
    const child = spawn(process.execPath, ["--import", "tsx", import.meta.filename, "hold", path], {
      stdio: ["ignore", "ignore", "pipe", "ipc"],
    });
    children.push(child);
    return { child, result: once(child, "message").then(([message]) => message) };
  };
  try {
    if (scenario === "single-owner" || scenario === "stale-release") {
      const first = acquireInstanceLock(path);
      releases.push(first);
      assert.throws(() => acquireInstanceLock(path));
      first();
      const second = acquireInstanceLock(path);
      releases.push(second);
      if (scenario === "stale-release") first();
      assert.throws(() => acquireInstanceLock(path), "a released owner must not remove a newer owner's lock");
    } else if (scenario === "foreign-lock") {
      const previous = `different-container ${process.pid}\n`;
      writeFileSync(path, previous);
      assert.throws(() => acquireInstanceLock(path), "a foreign hostname does not prove the owner is dead");
      assert.equal(readFileSync(path, "utf8"), previous);
    } else if (scenario === "concurrent-start") {
      const first = start();
      const second = start();
      const results = await Promise.all([first.result, second.result]);
      assert.deepEqual(results.sort(), ["acquired", "refused"]);
    } else if (scenario === "crash-restart") {
      const owner = start();
      assert.equal(await owner.result, "acquired");
      assert.throws(() => acquireInstanceLock(path));
      const exited = once(owner.child, "exit");
      owner.child.kill("SIGKILL");
      await exited;
      releases.push(acquireInstanceLock(path));
    } else {
      throw new Error(`Unknown scenario: ${scenario}`);
    }
    process.stdout.write(`instance lock:${scenario}:ok\n`);
  } finally {
    for (const child of children) {
      if (child.exitCode === null && child.signalCode === null) {
        const exited = once(child, "exit");
        child.kill("SIGTERM");
        await exited;
      }
    }
    for (const release of releases.reverse()) release();
    rmSync(directory, { recursive: true, force: true });
  }
}
