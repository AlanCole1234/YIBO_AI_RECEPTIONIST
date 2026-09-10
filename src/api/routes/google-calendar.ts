import type { FastifyInstance } from "fastify";
import type { YiboApplication } from "../../bootstrap/index.js";
import { createAdminGuard } from "../admin-guard.js";

export async function registerGoogleCalendarRoutes(server: FastifyInstance, app: YiboApplication): Promise<void> {
  server.get("/api/integrations/google/status", { preHandler: createAdminGuard(app, "tenant_admin") }, async () => {
    if (!app.googleOAuth) return { configured: false, connected: false };
    return app.googleOAuth.status(app.tenantId);
  });

  server.get<{ Querystring: { returnTo?: string } }>(
    "/api/integrations/google/connect",
    { preHandler: createAdminGuard(app, "tenant_admin") },
    async (request, reply) => {
    const url = app.googleOAuth?.authorizationUrl(app.tenantId, request.query.returnTo ?? "");
    if (!url) return reply.code(409).send({ error: { code: "GOOGLE_CONFIGURATION_REQUIRED" } });
    return { url };
    },
  );

  server.get<{ Querystring: { code?: string; state?: string; error?: string } }>("/api/integrations/google/callback", async (request, reply) => {
    const complete = app.googleOAuth && request.query.code && request.query.state
      ? await app.googleOAuth.completeAuthorization(request.query.code, request.query.state)
      : null;
    const outcome = complete && !request.query.error ? "connected" : "failed";
    const returnTo = complete?.returnTo ?? (request.query.state ? app.googleOAuth?.returnToForState(request.query.state) : null);
    if (!returnTo) return reply.code(400).send({ error: { code: "GOOGLE_OAUTH_STATE_INVALID" } });
    const destination = new URL(returnTo);
    destination.searchParams.set("calendar", outcome);
    return reply.redirect(destination.toString());
  });
}
