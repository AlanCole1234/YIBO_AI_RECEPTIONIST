import type { FastifyInstance } from "fastify";
import type { YiboApplication } from "../../app/index.js";
import { toHttpError } from "../http-errors.js";

interface CustomerBody { phone?: unknown; name?: unknown; email?: unknown }

export async function registerCustomerRoutes(server: FastifyInstance, app: YiboApplication): Promise<void> {
  server.post<{ Body: CustomerBody }>("/api/customers", async (request, reply) => {
    const { phone, name, email } = request.body ?? {};
    if (typeof phone !== "string" || (name !== undefined && typeof name !== "string") ||
        (email !== undefined && typeof email !== "string")) {
      return reply.code(400).send({ error: { code: "VALIDATION_ERROR" } });
    }
    const result = await app.customers.findOrCreateByPhone({
      tenantId: app.tenantId,
      phone,
      ...(typeof name === "string" ? { name } : {}),
      ...(typeof email === "string" ? { email } : {}),
    });
    if (!result.ok) {
      const mapped = toHttpError(result.error);
      return reply.code(mapped.statusCode).send(mapped.payload);
    }
    return reply.code(200).send(result.value);
  });
}
