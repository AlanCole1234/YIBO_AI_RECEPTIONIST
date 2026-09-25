import type { FastifyInstance } from "fastify";
import type { YiboApplication } from "../../bootstrap/index.js";
import { createAdminGuard } from "../admin-guard.js";
import { toHttpError } from "../http-errors.js";

interface AvailabilityQuery {
  locationId?: string;
  serviceId?: string;
  employeeId?: string;
  rangeStart?: string;
  rangeEnd?: string;
}

export async function registerAvailabilityRoutes(server: FastifyInstance, app: YiboApplication): Promise<void> {
  server.get<{ Querystring: AvailabilityQuery }>(
    "/api/availability",
    { preHandler: createAdminGuard(app, "operator") },
    async (request, reply) => {
    const { serviceId, employeeId, rangeStart, rangeEnd } = request.query;
    if (!serviceId || !rangeStart || !rangeEnd
      || (request.query.locationId !== undefined && (typeof request.query.locationId !== "string" || !request.query.locationId.trim()))) {
      return reply.code(400).send({ error: { code: "VALIDATION_ERROR" } });
    }
    const result = await app.scheduling.findAvailableSlots({
      tenantId: app.tenantId,
      locationId: request.query.locationId ?? "default",
      serviceId,
      ...(employeeId ? { employeeId } : {}),
      rangeStart,
      rangeEnd,
      limit: 100,
    });
    if (!result.ok) {
      const mapped = toHttpError(result.error);
      return reply.code(mapped.statusCode).send(mapped.payload);
    }
    return { slots: result.value };
    },
  );
}
