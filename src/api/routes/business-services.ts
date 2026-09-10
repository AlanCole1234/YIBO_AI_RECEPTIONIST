import type { FastifyInstance, FastifyReply } from "fastify";
import type { YiboApplication } from "../../bootstrap/index.js";
import type { BusinessCatalogError, TenantServiceDefinition } from "../../modules/business/index.js";
import { adminPrincipalFor, createAdminGuard } from "../admin-guard.js";
import { parseIfMatch } from "../optimistic-version.js";

export async function registerBusinessServiceRoutes(server: FastifyInstance, app: YiboApplication): Promise<void> {
  server.get(
    "/api/admin/services",
    { preHandler: createAdminGuard(app, "tenant_admin") },
    async (_request, reply) => {
      const result = await app.businessCatalog.listServices(app.tenantId);
      return result.ok
        ? reply.header("etag", `"${result.value.version}"`).send(result.value)
        : sendCatalogError(reply, result.error);
    },
  );

  server.post<{ Body: unknown }>(
    "/api/admin/services",
    { preHandler: createAdminGuard(app, "tenant_admin") },
    async (request, reply) => {
      const version = requireVersion(request.headers["if-match"], reply);
      if (version === null) return;
      const service = parseService(request.body, true);
      if (!service) return reply.code(400).send({ error: { code: "INVALID_SERVICE" } });
      const result = await app.businessCatalog.createService(app.tenantId, service, version);
      if (!result.ok) return sendCatalogError(reply, result.error);
      await app.adminAudit.recordMutation({
        principal: adminPrincipalFor(request), entityType: "service", entityId: service.id,
        action: "create", entityVersion: result.value.version, after: service,
      });
      return reply.code(201).header("etag", `"${result.value.version}"`).send(result.value);
    },
  );

  server.put<{ Params: { serviceId: string }; Body: unknown }>(
    "/api/admin/services/:serviceId",
    { preHandler: createAdminGuard(app, "tenant_admin") },
    async (request, reply) => {
      const version = requireVersion(request.headers["if-match"], reply);
      if (version === null) return;
      const replacement = parseService(request.body, false);
      if (!replacement) return reply.code(400).send({ error: { code: "INVALID_SERVICE" } });
      const before = await app.businessCatalog.listServices(app.tenantId);
      const result = await app.businessCatalog.updateService(app.tenantId, request.params.serviceId, replacement, version);
      if (!result.ok) return sendCatalogError(reply, result.error);
      await app.adminAudit.recordMutation({
        principal: adminPrincipalFor(request), entityType: "service", entityId: request.params.serviceId,
        action: "update", entityVersion: result.value.version,
        before: before.ok ? before.value.services.find(({ id }) => id === request.params.serviceId) : undefined,
        after: result.value.service,
      });
      return reply.header("etag", `"${result.value.version}"`).send(result.value);
    },
  );

  server.delete<{ Params: { serviceId: string } }>(
    "/api/admin/services/:serviceId",
    { preHandler: createAdminGuard(app, "tenant_admin") },
    async (request, reply) => {
      const version = requireVersion(request.headers["if-match"], reply);
      if (version === null) return;
      const before = await app.businessCatalog.listServices(app.tenantId);
      const result = await app.businessCatalog.deleteService(app.tenantId, request.params.serviceId, version);
      if (!result.ok) return sendCatalogError(reply, result.error);
      await app.adminAudit.recordMutation({
        principal: adminPrincipalFor(request), entityType: "service", entityId: request.params.serviceId,
        action: "delete", entityVersion: result.value.version,
        before: before.ok ? before.value.services.find(({ id }) => id === request.params.serviceId) : undefined,
      });
      return reply.header("etag", `"${result.value.version}"`).send(result.value);
    },
  );
}

export const requireVersion = (header: string | string[] | undefined, reply: FastifyReply): number | null => {
  const version = parseIfMatch(header);
  if (version !== null) return version;
  void reply.code(header === undefined ? 428 : 400).send({
    error: { code: header === undefined ? "IF_MATCH_REQUIRED" : "INVALID_IF_MATCH" },
  });
  return null;
};

export const sendCatalogError = (reply: FastifyReply, error: BusinessCatalogError) => {
  if (error.code === "CONFIGURATION_VERSION_CONFLICT") {
    return reply.code(409).send({ error: { code: error.code, currentVersion: error.currentVersion } });
  }
  const status = ["SERVICE_NOT_FOUND", "PROFESSIONAL_NOT_FOUND", "LOCATION_NOT_FOUND"].includes(error.code) ? 404
    : ["SERVICE_ALREADY_EXISTS", "SERVICE_IN_USE", "PROFESSIONAL_ALREADY_EXISTS", "PROFESSIONAL_IN_USE"].includes(error.code) ? 409 : 422;
  return reply.code(status).send({ error: { code: error.code, ...(error.code === "BUSINESS_CONFIGURATION_INVALID" ? { message: error.message } : {}) } });
};

function parseService(value: unknown, includeId: true): TenantServiceDefinition | null;
function parseService(value: unknown, includeId: false): Omit<TenantServiceDefinition, "id"> | null;
function parseService(
  value: unknown,
  includeId: boolean,
): TenantServiceDefinition | Omit<TenantServiceDefinition, "id"> | null {
  if (!isRecord(value)) return null;
  const allowed = new Set(includeId
    ? ["id", "name", "description", "durationMinutes", "bufferMinutes", "active"]
    : ["name", "description", "durationMinutes", "bufferMinutes", "active"]);
  if (Object.keys(value).some((key) => !allowed.has(key))
    || (includeId && (typeof value.id !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(value.id)))
    || typeof value.name !== "string" || !value.name.trim() || value.name.length > 120
    || typeof value.description !== "string" || value.description.length > 1000
    || !Number.isInteger(value.durationMinutes) || Number(value.durationMinutes) <= 0 || Number(value.durationMinutes) > 1440
    || !Number.isInteger(value.bufferMinutes) || Number(value.bufferMinutes) < 0 || Number(value.bufferMinutes) > 1440
    || typeof value.active !== "boolean") return null;
  return {
    ...(includeId ? { id: (value.id as string).trim() } : {}),
    name: value.name.trim(),
    description: value.description.trim(),
    durationMinutes: Number(value.durationMinutes),
    bufferMinutes: Number(value.bufferMinutes),
    active: value.active,
  } as TenantServiceDefinition | Omit<TenantServiceDefinition, "id">;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);
