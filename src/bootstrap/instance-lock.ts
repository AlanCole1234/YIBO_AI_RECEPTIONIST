import { closeSync, mkdirSync, openSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

/**
 * Hold SQLite's single-writer lock for this process's lifetime. All instances must
 * use the same path on local durable storage. Never unlink it: replacing its
 * inode would allow a second owner while the first still holds the old inode.
 * The OS releases the lock after a crash, including across container restarts.
 */
export function acquireInstanceLock(lockPath: string): () => void {
  mkdirSync(dirname(lockPath), { recursive: true, mode: 0o700 });
  try {
    closeSync(openSync(lockPath, "wx", 0o600));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }

  const database = new DatabaseSync(lockPath);
  try {
    // IMMEDIATE has one writer but permits the losing starter's schema reads;
    // EXCLUSIVE mode can leave both simultaneous starters waiting to upgrade.
    database.exec("PRAGMA busy_timeout = 0; BEGIN IMMEDIATE;");
  } catch (cause) {
    database.close();
    throw new Error(`Could not acquire instance lock ${lockPath}. Run one instance only.`, { cause });
  }

  let released = false;
  return () => {
    if (released) return;
    released = true;
    database.close();
  };
}
