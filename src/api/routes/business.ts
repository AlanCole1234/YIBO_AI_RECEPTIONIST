import type { FastifyInstance } from "fastify";
import type { YiboApplication } from "../../app/index.js";
import { toHttpError } from "../http-errors.js";

export async function registerBusinessRoutes(server: FastifyInstance, app: YiboApplication): Promise<void> {
  server.get("/api/business", async (_request, reply) => {
    const result = await app.business.getBusinessProfile(app.tenantId);
    if (!result.ok) {
      const mapped = toHttpError(result.error);
      return reply.code(mapped.statusCode).send(mapped.payload);
    }
    const { region, name, timezone, locale, services, employees, openingHours } = result.value;
    return { region, name, timezone, locale, services, employees, openingHours };
  });
}
