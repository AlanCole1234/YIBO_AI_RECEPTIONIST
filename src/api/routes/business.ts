import type { FastifyInstance } from "fastify";
import type { YiboApplication } from "../../bootstrap/index.js";
import { adminPrincipalFor, createAdminGuard } from "../admin-guard.js";
import { toHttpError } from "../http-errors.js";

export async function registerBusinessRoutes(server: FastifyInstance, app: YiboApplication): Promise<void> {
  server.get(
    "/api/admin/business-configuration",
    { preHandler: createAdminGuard(app, "tenant_admin") },
    async (_request, reply) => {
      const result = await app.business.getBusinessConfiguration(app.tenantId);
      if (!result.ok) {
        const mapped = toHttpError(result.error);
        return reply.code(mapped.statusCode).send(mapped.payload);
      }
      return reply.header("etag", `"${result.value.version}"`).send(result.value);
    },
  );

  server.put<{ Body: { configuration?: unknown } }>(
    "/api/admin/business-configuration",
    { preHandler: createAdminGuard(app, "tenant_admin") },
    async (request, reply) => {
      const expectedVersion = parseIfMatch(request.headers["if-match"]);
      if (expectedVersion === null) {
        return reply.code(request.headers["if-match"] === undefined ? 428 : 400).send({
          error: { code: request.headers["if-match"] === undefined ? "IF_MATCH_REQUIRED" : "INVALID_IF_MATCH" },
        });
      }
      if (!request.body?.configuration || typeof request.body.configuration !== "object"
        || Array.isArray(request.body.configuration)) {
        return reply.code(400).send({ error: { code: "INVALID_BUSINESS_CONFIGURATION" } });
      }
      const before = await app.business.getBusinessConfiguration(app.tenantId);
      const result = await app.business.updateBusinessConfiguration(
        app.tenantId,
        request.body.configuration as Parameters<YiboApplication["business"]["updateBusinessConfiguration"]>[1],
        expectedVersion,
      );
      if (!result.ok) {
        if (result.error.code === "CONFIGURATION_VERSION_CONFLICT") {
          return reply.code(409).send({
            error: {
              code: result.error.code,
              currentVersion: result.error.currentVersion,
            },
          });
        }
        const mapped = toHttpError(result.error);
        return reply.code(mapped.statusCode).send(mapped.payload);
      }
      await app.adminAudit.recordMutation({
        principal: adminPrincipalFor(request),
        entityType: "business_configuration",
        entityId: result.value.businessId,
        action: "replace_configuration",
        entityVersion: result.value.version,
        before: before.ok ? before.value.configuration : undefined,
        after: result.value.configuration,
      });
      return reply.header("etag", `"${result.value.version}"`).send(result.value);
    },
  );

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

const parseIfMatch = (header: string | string[] | undefined): number | null => {
  if (Array.isArray(header) || header === undefined) return null;
  const match = /^(?:W\/)?"?(\d+)"?$/.exec(header.trim());
  if (!match) return null;
  const version = Number(match[1]);
  return Number.isSafeInteger(version) && version >= 1 ? version : null;
};

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
