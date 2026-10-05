import type { DatabaseSync } from "node:sqlite";
import type { CallLivenessStore } from "../../modules/calls/application/call-liveness.js";

/** Hangup marks in the regional database, visible to every process that opens it. */
export class SqliteCallLivenessStore implements CallLivenessStore {
  constructor(private readonly database: DatabaseSync) {}

  markEnded(callId: string, endedAtMs: number, ttlMs: number): void {
    if (!callId) return;
    const expiresAtMs = endedAtMs + ttlMs;
    this.database.prepare("DELETE FROM ended_calls WHERE expires_at_ms <= ?").run(endedAtMs);
    this.database.prepare(`
      INSERT INTO ended_calls(call_id, ended_at_ms, expires_at_ms) VALUES (?, ?, ?)
      ON CONFLICT(call_id) DO UPDATE SET
        ended_at_ms = excluded.ended_at_ms,
        expires_at_ms = excluded.expires_at_ms
      WHERE excluded.expires_at_ms > ended_calls.expires_at_ms
    `).run(callId, endedAtMs, expiresAtMs);
  }

  isEnded(callId: string, nowMs: number): boolean {
    this.database.prepare("DELETE FROM ended_calls WHERE expires_at_ms <= ?").run(nowMs);
    return Boolean(this.database.prepare("SELECT 1 AS found FROM ended_calls WHERE call_id = ?").get(callId));
  }

  reset(): void {
    this.database.prepare("DELETE FROM ended_calls").run();
  }
}
