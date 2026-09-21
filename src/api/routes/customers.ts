import type { FastifyInstance } from "fastify";
import type { YiboApplication } from "../../bootstrap/index.js";
import { adminPrincipalFor, createAdminGuard } from "../admin-guard.js";
import { toHttpError } from "../http-errors.js";

interface CustomerBody { phone?: unknown; name?: unknown; email?: unknown; preferredLanguage?: unknown; emailOptIn?: unknown }

export async function registerCustomerRoutes(server: FastifyInstance, app: YiboApplication): Promise<void> {
  server.get("/api/office/directory", { preHandler: createAdminGuard(app, "operator") }, async () => {
    const [customers, appointments, business] = await Promise.all([
      app.customers.listAllCustomers(app.tenantId),
      app.appointments.listTenantHistory(app.tenantId),
      app.business.getBusinessConfiguration(app.tenantId),
    ]);
    if (!business.ok) return { customers: [], professionals: [] };
    const now = new Date().toISOString();
    const byCustomer = new Map<string, typeof appointments>();
    for (const appointment of appointments) {
      const values = byCustomer.get(appointment.customerId) ?? [];
      values.push(appointment); byCustomer.set(appointment.customerId, values);
    }
    return {
      customers: customers.map((customer) => {
        const history = byCustomer.get(customer.id) ?? [];
        const active = history.filter(({ status }) => status === "CONFIRMED");
        return { ...customer, appointmentCount: history.length,
          professionalIds: [...new Set(history.map(({ employeeId }) => employeeId))],
          nextAppointmentAt: active.filter(({ startAt }) => startAt >= now).sort((a, b) => a.startAt.localeCompare(b.startAt))[0]?.startAt,
          lastAppointmentAt: history.filter(({ startAt }) => startAt < now).sort((a, b) => b.startAt.localeCompare(a.startAt))[0]?.startAt };
      }),
      professionals: business.value.configuration.professionals.map((professional) => ({
        id: professional.id, name: professional.displayName, active: professional.active,
        patientIds: [...new Set(appointments.filter(({ employeeId }) => employeeId === professional.id)
          .map(({ customerId }) => customerId))],
      })),
    };
  });

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
