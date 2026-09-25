import type { FastifyInstance } from "fastify";
import type { YiboApplication } from "../../bootstrap/index.js";
import {
  isValidTransferDestination,
  type LocationTransferDestination,
} from "../../modules/business/index.js";
import { adminPrincipalFor, createAdminGuard } from "../admin-guard.js";
import { requireVersion, sendCatalogError } from "./business-services.js";

export async function registerTransferDestinationRoutes(server: FastifyInstance, app: YiboApplication): Promise<void> {
  server.get<{ Params: { locationId: string } }>(
    "/api/admin/locations/:locationId/transfer-destination",
    { preHandler: createAdminGuard(app, "tenant_admin") },
    async (request, reply) => {
      const result = await app.businessCatalog.getLocationTransferDestination(app.tenantId, request.params.locationId);
      return result.ok
        ? reply.header("etag", `"${result.value.version}"`).send(result.value)
        : sendCatalogError(reply, result.error);
    },
  );

  server.put<{ Params: { locationId: string }; Body: unknown }>(
    "/api/admin/locations/:locationId/transfer-destination",
    { preHandler: createAdminGuard(app, "tenant_admin") },
    async (request, reply) => {
      const version = requireVersion(request.headers["if-match"], reply);
      if (version === null) return;
      const destination = parseDestination(request.body);
      if (destination === INVALID) return reply.code(400).send({ error: { code: "INVALID_TRANSFER_DESTINATION" } });
      const before = await app.businessCatalog.getLocationTransferDestination(app.tenantId, request.params.locationId);
      if (!before.ok) return sendCatalogError(reply, before.error);
      const result = await app.businessCatalog.updateLocationTransferDestination(
        app.tenantId, request.params.locationId, destination ?? undefined, version,
      );
      if (!result.ok) return sendCatalogError(reply, result.error);
      await app.adminAudit.recordMutation({
        principal: adminPrincipalFor(request), entityType: "transfer_destination", entityId: request.params.locationId,
        action: "update", entityVersion: result.value.version,
        before: { destination: before.value.destination ?? null }, after: { destination: result.value.destination ?? null },
      });
      return reply.header("etag", `"${result.value.version}"`).send(result.value);
    },
  );
}

const INVALID = Symbol("invalid-transfer-destination");

const parseDestination = (value: unknown): LocationTransferDestination | null | typeof INVALID => {
  if (!isRecord(value) || Object.keys(value).length !== 1 || !("destination" in value)) return INVALID;
  if (value.destination === null) return null;
  if (!isRecord(value.destination) || Object.keys(value.destination).length !== 2
    || typeof value.destination.type !== "string" || typeof value.destination.value !== "string") return INVALID;
  const destination = normalizeDestination(value.destination.type, value.destination.value);
  return destination && isValidTransferDestination(destination) ? destination : INVALID;
};

const normalizeDestination = (type: string, value: string): LocationTransferDestination | null => {
  if (type === "EXTENSION") return { type, value: value.trim() };
  if (type !== "PHONE_NUMBER") return null;
  const digits = value.replace(/\D/g, "");
  return { type, value: value.trim().startsWith("+") ? `+${digits}` : digits };
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);
