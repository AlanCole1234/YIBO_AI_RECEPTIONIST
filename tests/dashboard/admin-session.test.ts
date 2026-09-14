import { describe, expect, it, vi } from "vitest";
import { createAdminSession, type AdminSessionClient } from "../../dashboard/src/services/admin-session.js";
import { ApiError, type AdminPrincipal } from "../../dashboard/src/services/api.js";

const now = Date.parse("2026-09-14T12:00:00.000Z");

const principal = (roles: AdminPrincipal["roles"] = ["operator"]): AdminPrincipal => ({
  subject: "operator@yibo.example",
  tenantId: "tenant-yibo-demo",
  roles,
  issuedAt: new Date(now).toISOString(),
  expiresAt: new Date(now + 60_000).toISOString(),
});

function fixture(me = vi.fn(async () => ({ principal: principal() }))) {
  let expiration: (() => void) | undefined;
  let authenticationFailure: (() => void) | undefined;
  const client: AdminSessionClient = {
    me,
    login: vi.fn(async () => ({ principal: principal(["tenant_admin"]) })),
    logout: vi.fn(async () => ({ loggedOut: true as const })),
  };
  const session = createAdminSession(client, {
    now: () => now,
    set: (handler) => { expiration = handler; return "timer"; },
    clear: () => { expiration = undefined; },
  }, (handler) => {
    authenticationFailure = handler;
    return () => { authenticationFailure = undefined; };
  });
  return { session, client, expire: () => expiration?.(), rejectAuthentication: () => authenticationFailure?.() };
}

describe("dashboard admin session", () => {
  it("restores the HttpOnly-cookie session and enforces role-aware views", async () => {
    const { session } = fixture();

    await session.restore();

    expect(session.state).toMatchObject({ phase: "authenticated", principal: { roles: ["operator"] } });
    expect(session.can("operator")).toBe(true);
    expect(session.can("tenant_admin")).toBe(false);
    session.dispose();
  });

  it("expires locally at the server deadline and reacts to later 401 responses", async () => {
    const first = fixture();
    await first.session.restore();
    first.expire();
    expect(first.session.state).toMatchObject({ phase: "anonymous", error: "SESSION_EXPIRED" });

    const second = fixture();
    await second.session.restore();
    second.rejectAuthentication();
    expect(second.session.state).toMatchObject({ phase: "anonymous", error: "SESSION_EXPIRED" });
  });

  it("keeps invalid credentials out and clears local state even if logout fails", async () => {
    const { session, client } = fixture();
    vi.mocked(client.login).mockRejectedValueOnce(new ApiError("INVALID_CREDENTIALS", 401));
    expect(await session.login({ email: "wrong@example.com", password: "wrong-password" })).toBe(false);
    expect(session.state).toMatchObject({ phase: "anonymous", error: "INVALID_CREDENTIALS", busy: false });

    vi.mocked(client.me).mockResolvedValueOnce({ principal: principal() });
    await session.restore();
    vi.mocked(client.logout).mockRejectedValueOnce(new Error("network down"));
    await session.logout();
    expect(session.state).toMatchObject({ phase: "anonymous", error: "", busy: false });
  });
});
