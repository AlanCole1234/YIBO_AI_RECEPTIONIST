import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { createApiServer } from "../../src/api/index.js";
import { buildApplication } from "../../src/bootstrap/index.js";

let server: FastifyInstance | undefined;
afterEach(async () => { await server?.close(); server = undefined; });

describe("admin authentication API", () => {
  it("logs in with an HttpOnly session, returns the principal and revokes it", async () => {
    const app = buildApplication({ adminSessionSecret: "a-development-test-secret-that-is-long-enough" });
    await app.adminAuth.credentials.create({
      tenantId: app.tenantId,
      email: "admin@yibo.example",
      password: "a-secure-password",
      roles: ["tenant_admin"],
    });
    server = await createApiServer(app);

    const login = await server.inject({
      method: "POST", url: "/api/auth/login",
      payload: { email: "admin@yibo.example", password: "a-secure-password" },
    });
    expect(login.statusCode).toBe(200);
    expect(login.json()).toMatchObject({ principal: { tenantId: app.tenantId, roles: ["tenant_admin"] } });
    const cookie = login.headers["set-cookie"];
    expect(cookie).toContain("yibo_admin_session=");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");

    const me = await server.inject({ method: "GET", url: "/api/auth/me", headers: { cookie } });
    expect(me.statusCode).toBe(200);
    expect(me.json()).toMatchObject({ principal: { tenantId: app.tenantId } });

    const logout = await server.inject({ method: "POST", url: "/api/auth/logout", headers: { cookie } });
    expect(logout.statusCode).toBe(200);
    const rejected = await server.inject({ method: "GET", url: "/api/auth/me", headers: { cookie } });
    expect(rejected.statusCode).toBe(401);
  });

  it("returns the same safe error for unknown users and wrong passwords", async () => {
    const app = buildApplication();
    server = await createApiServer(app);
    for (const email of ["missing@yibo.example", "admin@yibo.example"]) {
      const response = await server.inject({
        method: "POST", url: "/api/auth/login", payload: { email, password: "wrong-password-value" },
      });
      expect(response.statusCode).toBe(401);
      expect(response.json()).toEqual({ error: { code: "INVALID_CREDENTIALS" } });
    }
  });
});
