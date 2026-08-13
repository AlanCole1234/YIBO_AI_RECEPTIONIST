import type { FastifyInstance } from "fastify";
import type { YiboApplication } from "../../app/index.js";
import { toHttpError } from "../http-errors.js";

interface AvailabilityQuery {
  serviceId?: string;
  employeeId?: string;
  rangeStart?: string;
  rangeEnd?: string;
}

export async function registerAvailabilityRoutes(server: FastifyInstance, app: YiboApplication): Promise<void> {
  server.get<{ Querystring: AvailabilityQuery }>("/api/availability", async (request, reply) => {
    const { serviceId, employeeId, rangeStart, rangeEnd } = request.query;
    if (!serviceId || !rangeStart || !rangeEnd) {
      return reply.code(400).send({ error: { code: "VALIDATION_ERROR" } });
    }
    const result = await app.scheduling.findAvailableSlots({
      tenantId: app.tenantId,
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
  });
}
