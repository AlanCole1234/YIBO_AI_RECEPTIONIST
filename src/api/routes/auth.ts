import type { FastifyInstance, FastifyRequest } from "fastify";
import type { YiboApplication } from "../../bootstrap/index.js";

const COOKIE_NAME = "yibo_admin_session";
const SESSION_DURATION_MS = 8 * 60 * 60 * 1000;

export async function registerAuthRoutes(server: FastifyInstance, app: YiboApplication): Promise<void> {
  server.post<{ Body: { email?: unknown; password?: unknown } }>("/api/auth/login", async (request, reply) => {
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
    reply.header("set-cookie", sessionCookie(token, request, SESSION_DURATION_MS / 1000));
    return { principal: publicPrincipal(identity) };
  });

  server.get("/api/auth/me", async (request, reply) => {
    const token = sessionToken(request);
    if (!token) return reply.code(401).send({ error: { code: "AUTHENTICATION_REQUIRED" } });
    const verified = await app.adminAuth.sessions.verify(token, new Date());
    if (!verified.ok || verified.principal.tenantId !== app.tenantId) {
      return reply.code(401).send({ error: { code: verified.ok ? "INVALID_SESSION" : verified.code } });
    }
    return { principal: publicPrincipal(verified.principal) };
  });

  server.post("/api/auth/logout", async (request, reply) => {
    const token = sessionToken(request);
    if (token) await app.adminAuth.sessions.revoke(token);
    reply.header("set-cookie", sessionCookie("", request, 0));
    return { loggedOut: true };
  });
}

export const sessionToken = (request: FastifyRequest): string | undefined => {
  const cookie = request.headers.cookie;
  if (!cookie) return undefined;
  for (const part of cookie.split(";")) {
    const [name, ...value] = part.trim().split("=");
    if (name === COOKIE_NAME) return decodeURIComponent(value.join("="));
  }
  return undefined;
};

const sessionCookie = (value: string, request: FastifyRequest, maxAge: number): string => {
  const secure = request.protocol === "https" || process.env.NODE_ENV === "production";
  return `${COOKIE_NAME}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? "; Secure" : ""}`;
};

const publicPrincipal = (identity: { subject: string; tenantId: string; roles: string[] }) => ({
  subject: identity.subject,
  tenantId: identity.tenantId,
  roles: [...identity.roles],
});
