import type { FastifyInstance } from "fastify";
import type { YiboApplication } from "../../bootstrap/index.js";
import { isValidCalendarId } from "../../modules/business/index.js";
import { adminPrincipalFor, createAdminGuard } from "../admin-guard.js";
import { requireVersion, sendCatalogError } from "./business-services.js";

export async function registerCalendarAssignmentRoutes(server: FastifyInstance, app: YiboApplication): Promise<void> {
  server.get<{ Params: { locationId: string } }>(
    "/api/admin/locations/:locationId/calendars",
    { preHandler: createAdminGuard(app, "tenant_admin") },
    async (request, reply) => {
      const result = await app.businessCatalog.getLocationCalendars(app.tenantId, request.params.locationId);
      return result.ok
        ? reply.header("etag", `"${result.value.version}"`).send(result.value)
        : sendCatalogError(reply, result.error);
    },
  );

  server.put<{ Params: { locationId: string }; Body: unknown }>(
    "/api/admin/locations/:locationId/calendar",
    { preHandler: createAdminGuard(app, "tenant_admin") },
    async (request, reply) => {
      const version = requireVersion(request.headers["if-match"], reply);
      if (version === null) return;
      const calendarId = parseCalendarId(request.body);
      if (calendarId === INVALID) return reply.code(400).send({ error: { code: "INVALID_CALENDAR_ID" } });
      const before = await app.businessCatalog.getLocationCalendars(app.tenantId, request.params.locationId);
      const result = await app.businessCatalog.updateLocationDefaultCalendar(
        app.tenantId, request.params.locationId, calendarId ?? undefined, version,
      );
      if (!result.ok) return sendCatalogError(reply, result.error);
      await app.adminAudit.recordMutation({
        principal: adminPrincipalFor(request), entityType: "location_calendar", entityId: request.params.locationId,
        action: "update", entityVersion: result.value.version,
        before: before.ok ? { calendarId: before.value.defaultCalendarId ?? null } : undefined,
        after: { calendarId: result.value.defaultCalendarId ?? null },
      });
      return reply.header("etag", `"${result.value.version}"`).send(result.value);
    },
  );

  server.put<{ Params: { locationId: string; professionalId: string }; Body: unknown }>(
    "/api/admin/locations/:locationId/professionals/:professionalId/calendar",
    { preHandler: createAdminGuard(app, "tenant_admin") },
    async (request, reply) => {
      const version = requireVersion(request.headers["if-match"], reply);
      if (version === null) return;
      const calendarId = parseCalendarId(request.body);
      if (calendarId === INVALID) return reply.code(400).send({ error: { code: "INVALID_CALENDAR_ID" } });
      const before = await app.businessCatalog.getLocationCalendars(app.tenantId, request.params.locationId);
      const result = await app.businessCatalog.updateProfessionalCalendar(
        app.tenantId, request.params.locationId, request.params.professionalId, calendarId ?? undefined, version,
      );
      if (!result.ok) return sendCatalogError(reply, result.error);
      const findProfessional = (snapshot: typeof result.value) =>
        snapshot.professionals.find(({ professionalId }) => professionalId === request.params.professionalId);
      await app.adminAudit.recordMutation({
        principal: adminPrincipalFor(request), entityType: "professional_calendar",
        entityId: `${request.params.locationId}:${request.params.professionalId}`,
        action: "update", entityVersion: result.value.version,
        before: before.ok ? { calendarId: findProfessional(before.value)?.calendarId ?? null } : undefined,
        after: { calendarId: findProfessional(result.value)?.calendarId ?? null },
      });
      return reply.header("etag", `"${result.value.version}"`).send(result.value);
    },
  );
}

const INVALID = Symbol("invalid-calendar-id");

const parseCalendarId = (value: unknown): string | null | typeof INVALID => {
  if (!isRecord(value) || Object.keys(value).length !== 1 || !("calendarId" in value)) return INVALID;
  if (value.calendarId === null) return null;
  if (typeof value.calendarId !== "string") return INVALID;
  const calendarId = value.calendarId.trim();
  return isValidCalendarId(calendarId) ? calendarId : INVALID;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);
