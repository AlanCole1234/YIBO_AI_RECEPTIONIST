import type { FastifyInstance } from "fastify";
import type { YiboApplication } from "../../app/index.js";

export async function registerGoogleCalendarRoutes(server: FastifyInstance, app: YiboApplication): Promise<void> {
  server.get("/api/integrations/google/status", async () => {
    if (!app.googleOAuth) return { configured: false, connected: false };
    return app.googleOAuth.status(app.tenantId);
  });

  server.get("/api/integrations/google/connect", async (_request, reply) => {
    const url = app.googleOAuth?.authorizationUrl(app.tenantId);
    if (!url) return reply.code(409).send({ error: { code: "GOOGLE_CONFIGURATION_REQUIRED" } });
    return { url };
  });

  server.get<{ Querystring: { code?: string; state?: string; error?: string } }>("/api/integrations/google/callback", async (request, reply) => {
    const complete = app.googleOAuth && request.query.code && request.query.state
      ? await app.googleOAuth.completeAuthorization(request.query.code, request.query.state)
      : null;
    const outcome = complete && !request.query.error ? "connected" : "failed";
    return reply.type("text/html").send(`<!doctype html><title>YIBO Calendar</title><script>location.replace('http://127.0.0.1:5173/?calendar=${outcome}')</script><p>Google Calendar ${outcome}. You can close this window.</p>`);
  });
}
