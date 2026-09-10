import type { FastifyInstance } from "fastify";
import type { YiboApplication } from "../../bootstrap/index.js";
import { toHttpError } from "../http-errors.js";

export async function registerBusinessRoutes(server: FastifyInstance, app: YiboApplication): Promise<void> {
  server.get("/api/business", async (_request, reply) => {
    const result = await app.business.getBusinessProfile(app.tenantId);
    if (!result.ok) {
      const mapped = toHttpError(result.error);
      return reply.code(mapped.statusCode).send(mapped.payload);
    }
    const { region, name, timezone, locale, services, employees, openingHours, slotIntervalMinutes } = result.value;
    return { region, name, timezone, locale, services, employees, openingHours, slotIntervalMinutes };
  });

  server.put<{ Body: { timezone?: unknown } }>("/api/business/timezone", async (request, reply) => {
    if (typeof request.body?.timezone !== "string") {
      return reply.code(400).send({ error: { code: "INVALID_TIMEZONE" } });
    }
    const result = await app.business.updateBusinessTimezone(app.tenantId, request.body.timezone);
    if (!result.ok) {
      const mapped = toHttpError(result.error);
      return reply.code(mapped.statusCode).send(mapped.payload);
    }
    const { region, name, timezone, locale, services, employees, openingHours, slotIntervalMinutes } = result.value;
    return { region, name, timezone, locale, services, employees, openingHours, slotIntervalMinutes };
  });
}
