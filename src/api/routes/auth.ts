import type { FastifyInstance } from "fastify";
import type { YiboApplication } from "../../bootstrap/index.js";
import { createAdminGuard, isAllowedLoginOrigin } from "../admin-guard.js";
import { adminSessionCookie, adminSessionToken } from "../admin-session-cookie.js";

const SESSION_DURATION_MS = 8 * 60 * 60 * 1000;

export async function registerAuthRoutes(server: FastifyInstance, app: YiboApplication): Promise<void> {
  server.post<{ Body: { email?: unknown; password?: unknown } }>("/api/auth/login", async (request, reply) => {
    if (!isAllowedLoginOrigin(request, app)) {
      return reply.code(403).send({ error: { code: "ORIGIN_NOT_ALLOWED" } });
    }
    if (typeof request.body?.email !== "string" || typeof request.body?.password !== "string") {
      return reply.code(400).send({ error: { code: "INVALID_CREDENTIALS" } });
    }
    let identity;
    try {
      identity = await app.adminAuth.credentials.authenticate({
        tenantId: app.tenantId,
        email: request.body.email,
        password: request.body.password,
      });
    } catch {
      identity = null;
    }
    if (!identity) return reply.code(401).send({ error: { code: "INVALID_CREDENTIALS" } });
    const now = new Date();
    const token = await app.adminAuth.sessions.issue({
      subject: identity.subject,
      tenantId: identity.tenantId,
      roles: identity.roles,
      now,
      expiresAt: new Date(now.valueOf() + SESSION_DURATION_MS),
    });
    reply.header("set-cookie", adminSessionCookie(token, request, SESSION_DURATION_MS / 1000));
    return { principal: publicPrincipal(identity) };
  });

  server.get("/api/auth/me", async (request, reply) => {
    const token = adminSessionToken(request);
    if (!token) return reply.code(401).send({ error: { code: "AUTHENTICATION_REQUIRED" } });
    const verified = await app.adminAuth.sessions.verify(token, new Date());
    if (!verified.ok || verified.principal.tenantId !== app.tenantId) {
      return reply.code(401).send({ error: { code: verified.ok ? "INVALID_SESSION" : verified.code } });
    }
    return { principal: publicPrincipal(verified.principal) };
  });

  server.post("/api/auth/logout", { preHandler: createAdminGuard(app, "operator") }, async (request, reply) => {
    const token = adminSessionToken(request);
    if (token) await app.adminAuth.sessions.revoke(token);
    reply.header("set-cookie", adminSessionCookie("", request, 0));
    return { loggedOut: true };
  });
}

const publicPrincipal = (identity: { subject: string; tenantId: string; roles: string[] }) => ({
  subject: identity.subject,
  tenantId: identity.tenantId,
  roles: [...identity.roles],
});
