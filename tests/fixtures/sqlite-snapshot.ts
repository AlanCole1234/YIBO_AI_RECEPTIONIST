import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrateDatabase, openRegionalDatabase } from "../../src/infrastructure/database/regional-database.js";
import { snapshotDatabase } from "../../src/infrastructure/database/snapshot-database.js";

const dir = mkdtempSync(join(tmpdir(), "yibo-snap-"));
const originalUmask = process.umask();
try {
  const source = join(dir, "source.sqlite");
  const destination = join(dir, "copy.sqlite");
  const scenario = process.argv[2];
  if (scenario === "private-copy") process.umask(0);
  if (scenario === "missing-source") {
    assert.throws(() => snapshotDatabase(source, destination));
    assert.equal(existsSync(source), false, "a typo must not create an empty source database");
    assert.equal(existsSync(destination), false);
    process.stdout.write(`snapshot ${scenario}:ok\n`);
  } else {
    const database = openRegionalDatabase("US", source);
    migrateDatabase(database);
    database.close();
    if (scenario === "existing-destination") {
      writeFileSync(destination, "");
      assert.throws(() => snapshotDatabase(source, destination));
      assert.equal(statSync(destination).size, 0, "an existing empty destination must remain untouched");
      process.stdout.write(`snapshot ${scenario}:ok\n`);
    } else {
      const snapshot = snapshotDatabase(source, destination);
      if (scenario === "private-copy") {
        assert.equal(statSync(destination).mode & 0o777, 0o600, "backup must not expose customer data or stored tokens to other users");
        process.stdout.write(`snapshot ${scenario}:ok\n`);
      }
      if (snapshot.integrityCheck !== "ok" || snapshot.foreignKeyViolations !== 0) {
        throw new Error("snapshot checks failed");
      }
      if (!/^[a-f0-9]{64}$/.test(snapshot.sha256)) throw new Error("missing checksum");
      const copy = openRegionalDatabase("US", destination);
      const row = copy.prepare("SELECT COUNT(*) AS n FROM schema_migrations").get() as { n: number };
      copy.close();
      if (row.n < 1) throw new Error("snapshot missed migrations");
      process.stdout.write("snapshot integrity:ok\n");
    }
  }
} finally {
  process.umask(originalUmask);
  rmSync(dir, { recursive: true, force: true });
}
