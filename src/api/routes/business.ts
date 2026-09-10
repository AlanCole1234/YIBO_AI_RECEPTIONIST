import type { FastifyInstance } from "fastify";
import type { YiboApplication } from "../../bootstrap/index.js";
import { adminPrincipalFor, createAdminGuard } from "../admin-guard.js";
import { toHttpError } from "../http-errors.js";

export async function registerBusinessRoutes(server: FastifyInstance, app: YiboApplication): Promise<void> {
  server.get("/api/business", { preHandler: createAdminGuard(app, "operator") }, async (_request, reply) => {
    const result = await app.business.getBusinessProfile(app.tenantId);
    if (!result.ok) {
      const mapped = toHttpError(result.error);
      return reply.code(mapped.statusCode).send(mapped.payload);
    }
    const { region, name, timezone, locale, services, employees, openingHours } = result.value;
    return { region, name, timezone, locale, services, employees, openingHours };
  });

  server.put<{ Body: { timezone?: unknown } }>(
    "/api/business/timezone",
    { preHandler: createAdminGuard(app, "tenant_admin") },
    async (request, reply) => {
    if (typeof request.body?.timezone !== "string") {
      return reply.code(400).send({ error: { code: "INVALID_TIMEZONE" } });
    }
    const before = await app.business.getBusinessProfile(app.tenantId);
    const result = await app.business.updateBusinessTimezone(app.tenantId, request.body.timezone);
    if (!result.ok) {
      const mapped = toHttpError(result.error);
      return reply.code(mapped.statusCode).send(mapped.payload);
    }
    await app.adminAudit.recordMutation({
      principal: adminPrincipalFor(request),
      entityType: "business_configuration",
      entityId: result.value.businessId,
      action: "update_timezone",
      entityVersion: "legacy",
      before: before.ok ? { timezone: before.value.timezone } : undefined,
      after: { timezone: result.value.timezone },
    });
    const { region, name, timezone, locale, services, employees, openingHours } = result.value;
    return { region, name, timezone, locale, services, employees, openingHours };
    },
  );
}
