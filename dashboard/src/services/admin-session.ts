import { reactive } from "vue";
import {
  api,
  ApiError,
  onAuthenticationFailure,
  type AdminPrincipal,
  type AdminRole,
} from "./api.js";

export type AdminSessionPhase = "loading" | "anonymous" | "authenticated";

export interface AdminSessionState {
  phase: AdminSessionPhase;
  principal?: AdminPrincipal;
  error: string;
  busy: boolean;
}

export interface AdminSessionClient {
  login(credentials: { email: string; password: string }): Promise<{ principal: AdminPrincipal }>;
  logout(): Promise<{ loggedOut: true }>;
  me(): Promise<{ principal: AdminPrincipal }>;
}

export interface AdminSessionTimers {
  set(handler: () => void, delayMs: number): unknown;
  clear(handle: unknown): void;
  now(): number;
}

const browserTimers: AdminSessionTimers = {
  set: (handler, delayMs) => window.setTimeout(handler, delayMs),
  clear: (handle) => window.clearTimeout(handle as number),
  now: () => Date.now(),
};

export function createAdminSession(
  client: AdminSessionClient = api,
  timers: AdminSessionTimers = browserTimers,
  subscribeToAuthenticationFailure: (handler: () => void) => () => void = onAuthenticationFailure,
) {
  const state = reactive<AdminSessionState>({ phase: "loading", error: "", busy: false });
  let expirationTimer: unknown;

  const clearExpiration = (): void => {
    if (expirationTimer !== undefined) timers.clear(expirationTimer);
    expirationTimer = undefined;
  };
  const becomeAnonymous = (error = ""): void => {
    clearExpiration();
    state.phase = "anonymous";
    state.principal = undefined;
    state.error = error;
  };
  const accept = (principal: AdminPrincipal): void => {
    clearExpiration();
    const remaining = new Date(principal.expiresAt).valueOf() - timers.now();
    if (!Number.isFinite(remaining) || remaining <= 0) {
      becomeAnonymous("SESSION_EXPIRED");
      return;
    }
    state.phase = "authenticated";
    state.principal = principal;
    state.error = "";
    expirationTimer = timers.set(() => becomeAnonymous("SESSION_EXPIRED"), remaining);
  };
  const unsubscribe = subscribeToAuthenticationFailure(() => becomeAnonymous("SESSION_EXPIRED"));

  return {
    state,
    async restore(): Promise<void> {
      state.phase = "loading";
      try {
        accept((await client.me()).principal);
      } catch (error) {
        becomeAnonymous(error instanceof ApiError && error.status === 401 ? "" : "SESSION_CHECK_FAILED");
      }
    },
    async login(credentials: { email: string; password: string }): Promise<boolean> {
      state.busy = true;
      state.error = "";
      try {
        accept((await client.login(credentials)).principal);
        return state.phase === "authenticated";
      } catch (error) {
        becomeAnonymous(error instanceof ApiError ? error.code : "LOGIN_FAILED");
        return false;
      } finally {
        state.busy = false;
      }
    },
    async logout(): Promise<void> {
      state.busy = true;
      try {
        await client.logout();
      } catch {
        // Local access ends even if the already-expired server session cannot be revoked.
      } finally {
        state.busy = false;
        becomeAnonymous();
      }
    },
    can(required: AdminRole): boolean {
      const roles = state.principal?.roles ?? [];
      if (roles.some((role) => role === "owner" || role === "tenant_admin")) return true;
      if (required === "tenant_admin") return roles.includes("office_manager");
      if (required === "operator") return roles.some((role) => ["office_manager", "secretary", "operator", "read_only"].includes(role));
      return roles.includes(required);
    },
    dispose(): void {
      clearExpiration();
      unsubscribe();
    },
  };
}
