import type { FastifyInstance } from "fastify";
import type { YiboApplication } from "../../bootstrap/index.js";
import type {
  LocationProfessionalAssignment,
  OpeningHoursRule,
  ProfessionalDefinition,
} from "../../modules/business/index.js";
import { adminPrincipalFor, createAdminGuard } from "../admin-guard.js";
import { requireVersion, sendCatalogError } from "./business-services.js";

export async function registerBusinessProfessionalRoutes(server: FastifyInstance, app: YiboApplication): Promise<void> {
  server.get(
    "/api/admin/professionals",
    { preHandler: createAdminGuard(app, "tenant_admin") },
    async (_request, reply) => {
      const result = await app.businessCatalog.listProfessionals(app.tenantId);
      return result.ok
        ? reply.header("etag", `"${result.value.version}"`).send(result.value)
        : sendCatalogError(reply, result.error);
    },
  );

  server.post<{ Body: unknown }>(
    "/api/admin/professionals",
    { preHandler: createAdminGuard(app, "tenant_admin") },
    async (request, reply) => {
      const version = requireVersion(request.headers["if-match"], reply);
      if (version === null) return;
      const professional = parseProfessional(request.body, true);
      if (!professional) return reply.code(400).send({ error: { code: "INVALID_PROFESSIONAL" } });
      const result = await app.businessCatalog.createProfessional(app.tenantId, professional, version);
      if (!result.ok) return sendCatalogError(reply, result.error);
      await app.adminAudit.recordMutation({
        principal: adminPrincipalFor(request), entityType: "professional", entityId: professional.id,
        action: "create", entityVersion: result.value.version, after: professional,
      });
      return reply.code(201).header("etag", `"${result.value.version}"`).send(result.value);
    },
  );

  server.put<{ Params: { professionalId: string }; Body: unknown }>(
    "/api/admin/professionals/:professionalId",
    { preHandler: createAdminGuard(app, "tenant_admin") },
    async (request, reply) => {
      const version = requireVersion(request.headers["if-match"], reply);
      if (version === null) return;
      const replacement = parseProfessional(request.body, false);
      if (!replacement) return reply.code(400).send({ error: { code: "INVALID_PROFESSIONAL" } });
      const before = await app.businessCatalog.listProfessionals(app.tenantId);
      const result = await app.businessCatalog.updateProfessional(
        app.tenantId, request.params.professionalId, replacement, version,
      );
      if (!result.ok) return sendCatalogError(reply, result.error);
      await app.adminAudit.recordMutation({
        principal: adminPrincipalFor(request), entityType: "professional", entityId: request.params.professionalId,
        action: "update", entityVersion: result.value.version,
        before: before.ok ? before.value.professionals.find(({ id }) => id === request.params.professionalId) : undefined,
        after: result.value.professional,
      });
      return reply.header("etag", `"${result.value.version}"`).send(result.value);
    },
  );

  server.delete<{ Params: { professionalId: string } }>(
    "/api/admin/professionals/:professionalId",
    { preHandler: createAdminGuard(app, "tenant_admin") },
    async (request, reply) => {
      const version = requireVersion(request.headers["if-match"], reply);
      if (version === null) return;
      const before = await app.businessCatalog.listProfessionals(app.tenantId);
      const result = await app.businessCatalog.deleteProfessional(app.tenantId, request.params.professionalId, version);
      if (!result.ok) return sendCatalogError(reply, result.error);
      await app.adminAudit.recordMutation({
        principal: adminPrincipalFor(request), entityType: "professional", entityId: request.params.professionalId,
        action: "delete", entityVersion: result.value.version,
        before: before.ok ? before.value.professionals.find(({ id }) => id === request.params.professionalId) : undefined,
      });
      return reply.header("etag", `"${result.value.version}"`).send(result.value);
    },
  );

  server.put<{ Params: { locationId: string; professionalId: string }; Body: unknown }>(
    "/api/admin/locations/:locationId/professionals/:professionalId",
    { preHandler: createAdminGuard(app, "tenant_admin") },
    async (request, reply) => {
      const version = requireVersion(request.headers["if-match"], reply);
      if (version === null) return;
      const assignment = parseAssignment(request.body);
      if (!assignment) return reply.code(400).send({ error: { code: "INVALID_PROFESSIONAL_ASSIGNMENT" } });
      const result = await app.businessCatalog.setProfessionalAssignment(
        app.tenantId, request.params.locationId, request.params.professionalId, assignment, version,
      );
      if (!result.ok) return sendCatalogError(reply, result.error);
      await app.adminAudit.recordMutation({
        principal: adminPrincipalFor(request), entityType: "professional_assignment",
        entityId: `${request.params.locationId}:${request.params.professionalId}`,
        action: "upsert", entityVersion: result.value.version, after: result.value.assignment,
      });
      return reply.header("etag", `"${result.value.version}"`).send(result.value);
    },
  );

  server.delete<{ Params: { locationId: string; professionalId: string } }>(
    "/api/admin/locations/:locationId/professionals/:professionalId",
    { preHandler: createAdminGuard(app, "tenant_admin") },
    async (request, reply) => {
      const version = requireVersion(request.headers["if-match"], reply);
      if (version === null) return;
      const result = await app.businessCatalog.deleteProfessionalAssignment(
        app.tenantId, request.params.locationId, request.params.professionalId, version,
      );
      if (!result.ok) return sendCatalogError(reply, result.error);
      await app.adminAudit.recordMutation({
        principal: adminPrincipalFor(request), entityType: "professional_assignment",
        entityId: `${request.params.locationId}:${request.params.professionalId}`,
        action: "delete", entityVersion: result.value.version,
      });
      return reply.header("etag", `"${result.value.version}"`).send(result.value);
    },
  );
}

function parseProfessional(value: unknown, includeId: true): ProfessionalDefinition | null;
function parseProfessional(value: unknown, includeId: false): Omit<ProfessionalDefinition, "id"> | null;
function parseProfessional(value: unknown, includeId: boolean): ProfessionalDefinition | Omit<ProfessionalDefinition, "id"> | null {
  if (!isRecord(value)) return null;
  const allowed = new Set(includeId ? ["id", "displayName", "active"] : ["displayName", "active"]);
  if (Object.keys(value).some((key) => !allowed.has(key))
    || (includeId && (typeof value.id !== "string" || !validId(value.id)))
    || typeof value.displayName !== "string" || !value.displayName.trim() || value.displayName.length > 120
    || typeof value.active !== "boolean") return null;
  return {
    ...(includeId ? { id: (value.id as string).trim() } : {}),
    displayName: value.displayName.trim(),
    active: value.active,
  } as ProfessionalDefinition | Omit<ProfessionalDefinition, "id">;
}

const parseAssignment = (value: unknown): Omit<LocationProfessionalAssignment, "professionalId"> | null => {
  if (!isRecord(value)) return null;
  const allowed = new Set(["active", "serviceIds", "openingHours", "calendarId"]);
  const serviceIds = value.serviceIds;
  const openingHours = value.openingHours;
  if (Object.keys(value).some((key) => !allowed.has(key)) || typeof value.active !== "boolean"
    || !Array.isArray(serviceIds) || serviceIds.some((id) => typeof id !== "string" || !validId(id))
    || new Set(serviceIds).size !== serviceIds.length || !Array.isArray(openingHours)
    || openingHours.some((rule) => !isOpeningHoursRule(rule))
    || (value.calendarId !== undefined && (typeof value.calendarId !== "string" || !value.calendarId.trim()))) return null;
  return {
    active: value.active,
    serviceIds: serviceIds as string[],
    openingHours: openingHours as OpeningHoursRule[],
    ...(typeof value.calendarId === "string" ? { calendarId: value.calendarId.trim() } : {}),
  };
};

const isOpeningHoursRule = (value: unknown): value is OpeningHoursRule => isRecord(value)
  && Object.keys(value).every((key) => ["dayOfWeek", "startTime", "endTime"].includes(key))
  && Number.isInteger(value.dayOfWeek) && Number(value.dayOfWeek) >= 0 && Number(value.dayOfWeek) <= 6
  && typeof value.startTime === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(value.startTime)
  && typeof value.endTime === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(value.endTime)
  && value.startTime < value.endTime;

const validId = (value: string): boolean => /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(value);
const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);
