/** How long a hangup keeps blocking a reused call id. */
export const CALL_ENDED_TTL_MS = 6 * 60 * 60 * 1000;

/**
 * Shared record of calls that must not accept another booking side effect.
 * Production installs a database-backed store so every instance agrees.
 */
export interface CallLivenessStore {
  markEnded(callId: string, endedAtMs: number, ttlMs: number): void;
  isEnded(callId: string, nowMs: number): boolean;
  reset(): void;
}

export class MemoryCallLivenessStore implements CallLivenessStore {
  private readonly expiresAt = new Map<string, number>();

  markEnded(callId: string, endedAtMs: number, ttlMs: number): void {
    if (!callId) return;
    const expires = endedAtMs + ttlMs;
    const current = this.expiresAt.get(callId);
    if (current === undefined || expires > current) this.expiresAt.set(callId, expires);
  }

  isEnded(callId: string, nowMs: number): boolean {
    const expires = this.expiresAt.get(callId);
    if (expires === undefined) return false;
    if (expires <= nowMs) {
      this.expiresAt.delete(callId);
      return false;
    }
    return true;
  }

  reset(): void {
    this.expiresAt.clear();
  }
}

const defaultNow = (): number => Date.now();
let nowFn: () => number = defaultNow;
let ttlMs = CALL_ENDED_TTL_MS;
let store: CallLivenessStore = new MemoryCallLivenessStore();

export function configureCallLiveness(options: {
  store: CallLivenessStore;
  now?: () => number;
  ttlMs?: number;
}): void {
  store = options.store;
  nowFn = options.now ?? defaultNow;
  ttlMs = options.ttlMs ?? CALL_ENDED_TTL_MS;
}

/** Test isolation. Puts the process back on a private in-memory list. */
export function restoreDefaultCallLiveness(): void {
  store = new MemoryCallLivenessStore();
  nowFn = defaultNow;
  ttlMs = CALL_ENDED_TTL_MS;
}

/** Record that this call will not accept a new booking side effect. */
export const markCallEnded = (callId: string): void => {
  if (callId) store.markEnded(callId, nowFn(), ttlMs);
};

export const isCallEnded = (callId: string): boolean => (callId ? store.isEnded(callId, nowFn()) : false);

/** Test isolation. Clears the active store without forgetting which store is installed. */
export const resetCallLiveness = (): void => {
  store.reset();
};
