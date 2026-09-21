import type { FastifyInstance } from "fastify";
import type { YiboApplication } from "../../bootstrap/index.js";
import { adminPrincipalFor, createAdminGuard } from "../admin-guard.js";
import { toHttpError } from "../http-errors.js";

interface CustomerBody { phone?: unknown; name?: unknown; email?: unknown; preferredLanguage?: unknown; emailOptIn?: unknown }

export async function registerCustomerRoutes(server: FastifyInstance, app: YiboApplication): Promise<void> {
  server.get<{ Querystring: { q?: string; limit?: string } }>(
    "/api/customers",
    { preHandler: createAdminGuard(app, "operator") },
    async (request) => ({
      customers: await app.customers.searchCustomers(
        app.tenantId,
        typeof request.query.q === "string" ? request.query.q : "",
        Number(request.query.limit ?? 25),
      ),
    }),
  );

  server.get<{ Params: { customerId: string } }>(
    "/api/customers/:customerId",
    { preHandler: createAdminGuard(app, "operator") },
    async (request, reply) => {
      const result = await app.customers.getCustomer(app.tenantId, request.params.customerId);
      if (!result.ok) {
        const mapped = toHttpError(result.error);
        return reply.code(mapped.statusCode).send(mapped.payload);
      }
      return result.value;
    },
  );

  server.get<{ Params: { customerId: string } }>(
    "/api/customers/:customerId/appointments",
    { preHandler: createAdminGuard(app, "operator") },
    async (request) => ({ appointments: await app.appointments.listCustomerHistory(app.tenantId, request.params.customerId) }),
  );

  server.post<{ Body: CustomerBody }>(
    "/api/customers",
    { preHandler: createAdminGuard(app, "operator") },
    async (request, reply) => {
    const { phone, name, email, preferredLanguage, emailOptIn } = request.body ?? {};
    if (typeof phone !== "string" || (name !== undefined && typeof name !== "string") ||
        (email !== undefined && typeof email !== "string")
        || (preferredLanguage !== undefined && typeof preferredLanguage !== "string")
        || (emailOptIn !== undefined && typeof emailOptIn !== "boolean")) {
      return reply.code(400).send({ error: { code: "VALIDATION_ERROR" } });
    }
    const result = await app.customers.findOrCreateByPhone({
      tenantId: app.tenantId,
      phone,
      ...(typeof name === "string" ? { name } : {}),
      ...(typeof email === "string" ? { email } : {}),
      ...(typeof preferredLanguage === "string" ? { preferredLanguage } : {}),
      ...(typeof emailOptIn === "boolean" ? { emailOptIn } : {}),
      source: "OFFICE",
    });
    if (!result.ok) {
      const mapped = toHttpError(result.error);
      return reply.code(mapped.statusCode).send(mapped.payload);
    }
    await app.adminAudit.recordMutation({
      principal: adminPrincipalFor(request),
      entityType: "customer",
      entityId: result.value.id,
      action: "find_or_create",
      before: null,
      after: result.value,
    });
    return reply.code(200).send(result.value);
    },
  );

  server.put<{ Params: { customerId: string }; Body: CustomerBody }>(
    "/api/customers/:customerId",
    { preHandler: createAdminGuard(app, "operator") },
    async (request, reply) => {
      const body = request.body ?? {};
      if (Object.values(body).some((value) => value !== undefined
        && typeof value !== "string" && typeof value !== "boolean")) {
        return reply.code(400).send({ error: { code: "VALIDATION_ERROR" } });
      }
      const before = await app.customers.getCustomer(app.tenantId, request.params.customerId);
      const result = await app.customers.updateCustomer({
        tenantId: app.tenantId,
        customerId: request.params.customerId,
        ...(typeof body.phone === "string" ? { phone: body.phone } : {}),
        ...(typeof body.name === "string" ? { name: body.name } : {}),
        ...(typeof body.email === "string" ? { email: body.email } : {}),
        ...(typeof body.preferredLanguage === "string" ? { preferredLanguage: body.preferredLanguage } : {}),
        ...(typeof body.emailOptIn === "boolean" ? { emailOptIn: body.emailOptIn } : {}),
      });
      if (!result.ok) {
        const mapped = toHttpError(result.error);
        return reply.code(mapped.statusCode).send(mapped.payload);
      }
      await app.adminAudit.recordMutation({ principal: adminPrincipalFor(request), entityType: "customer",
        entityId: result.value.id, action: "update", before: before.ok ? before.value : null, after: result.value });
      return result.value;
    },
  );
}
