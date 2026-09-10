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
    return legacyBusinessFacade(result.value);
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
      before: before.ok ? { timezone: defaultLocation(before.value).timezone } : undefined,
      after: { timezone: defaultLocation(result.value).timezone },
    });
    return legacyBusinessFacade(result.value);
    },
  );
}

type CurrentBusinessProfile = Extract<
  Awaited<ReturnType<YiboApplication["business"]["getBusinessProfile"]>>,
  { ok: true }
>["value"];

const defaultLocation = (profile: CurrentBusinessProfile) =>
  profile.locations.find(({ id }) => id === "default") ?? profile.locations[0]!;

const legacyBusinessFacade = (profile: CurrentBusinessProfile) => {
  const location = defaultLocation(profile);
  return {
    region: profile.region,
    name: profile.name,
    timezone: location.timezone,
    locale: location.locale,
    services: profile.services.map((service) => ({
      ...service,
      eligibleEmployeeIds: location.professionals
        .filter((professional) => professional.serviceIds.includes(service.id))
        .map(({ professionalId }) => professionalId),
    })),
    employees: profile.professionals,
    openingHours: location.openingHours,
  };
};
