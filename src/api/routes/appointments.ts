import type { FastifyInstance } from "fastify";
import type { YiboApplication } from "../../bootstrap/index.js";
import { adminPrincipalFor, createAdminGuard } from "../admin-guard.js";
import { toHttpError } from "../http-errors.js";

interface AppointmentBody {
  customerId?: unknown;
  serviceId?: unknown;
  employeeId?: unknown;
  startAt?: unknown;
}

export async function registerAppointmentRoutes(server: FastifyInstance, app: YiboApplication): Promise<void> {
  // Operator-safe metadata, using the same tenant-owned configuration as scheduling.
  server.get("/api/appointment-locations", { preHandler: createAdminGuard(app, "operator") }, async (_request, reply) => {
    const result = await app.business.getBusinessConfiguration(app.tenantId);
    if (!result.ok) { const error = toHttpError(result.error); return reply.code(error.statusCode).send(error.payload); }
    return { locations: result.value.configuration.locations.map(location => ({
      id: location.id, name: location.name, active: location.active, timezone: location.timezone,
      minimumCancellationNoticeMinutes: location.policies.minimumCancellationNoticeMinutes,
      minimumRescheduleNoticeMinutes: location.policies.minimumRescheduleNoticeMinutes,
    })) };
  });

  server.get<{ Params: { locationId: string }; Querystring: { customerId?: string } }>(
    "/api/locations/:locationId/appointments", { preHandler: createAdminGuard(app, "operator") }, async (request, reply) => {
      if (typeof request.query.customerId !== "string" || !request.query.customerId.trim()) return reply.code(400).send({ error: { code: "VALIDATION_ERROR" } });
      return { appointments: await app.appointments.listUpcomingAppointments({ tenantId: app.tenantId,
        locationId: request.params.locationId, customerId: request.query.customerId.trim() }) };
    },
  );
  server.get<{ Params: { locationId: string; appointmentId: string } }>(
    "/api/locations/:locationId/appointments/:appointmentId", { preHandler: createAdminGuard(app, "operator") }, async (request, reply) => {
      const result = await app.appointments.getAppointment({ tenantId: app.tenantId, ...request.params });
      if (!result.ok) { const error = toHttpError(result.error); return reply.code(error.statusCode).send(error.payload); }
      return result.value;
    },
  );
  for (const action of ["cancel", "reschedule"] as const) {
    server.post<{ Params: { locationId: string; appointmentId: string }; Body: unknown }>(
      `/api/locations/:locationId/appointments/:appointmentId/${action}`,
      { preHandler: createAdminGuard(app, "operator") }, async (request, reply) => {
        const body = request.body;
        if (!body || typeof body !== "object" || Array.isArray(body)
          || Object.keys(body).some(key => action !== "reschedule" || key !== "startAt")
          || (action === "reschedule" && (!("startAt" in body) || typeof body.startAt !== "string" || !body.startAt.trim()))) {
          return reply.code(400).send({ error: { code: "VALIDATION_ERROR" } });
        }
        const context = { tenantId: app.tenantId, ...request.params };
        const before = await app.appointments.getAppointment(context);
        const result = action === "cancel" ? await app.appointments.cancelAppointment(context)
          : await app.appointments.rescheduleAppointment({ ...context, startAt: (body as { startAt: string }).startAt });
        if (!result.ok) { const error = toHttpError(result.error); return reply.code(error.statusCode).send(error.payload); }
        await app.adminAudit.recordMutation({ principal: adminPrincipalFor(request), entityType: "appointment",
          entityId: result.value.id, action, before: before.ok ? before.value : null, after: result.value });
        return result.value;
      },
    );
  }

  server.post<{ Body: AppointmentBody }>(
    "/api/appointments",
    { preHandler: createAdminGuard(app, "operator") },
    async (request, reply) => {
    const { customerId, serviceId, employeeId, startAt } = request.body ?? {};
    if (![customerId, serviceId, employeeId, startAt].every((value) => typeof value === "string" && value.length > 0)) {
      return reply.code(400).send({ error: { code: "VALIDATION_ERROR" } });
    }
    const idempotencyHeader = request.headers["idempotency-key"];
    const idempotencyKey = typeof idempotencyHeader === "string" && idempotencyHeader.trim()
      ? idempotencyHeader.trim()
      : `dashboard:${app.ids.generate("idempotency")}`;
    const result = await app.appointments.createAppointment({
      tenantId: app.tenantId,
      locationId: "default",
      customerId: customerId as string,
      serviceId: serviceId as string,
      employeeId: employeeId as string,
      startAt: startAt as string,
      idempotencyKey,
      source: "DASHBOARD",
    });
    if (!result.ok) {
      const mapped = toHttpError(result.error);
      return reply.code(mapped.statusCode).send(mapped.payload);
    }
    await app.adminAudit.recordMutation({
      principal: adminPrincipalFor(request),
      entityType: "appointment",
      entityId: result.value.id,
      action: "create",
      before: null,
      after: result.value,
    });
    return reply.code(201).send(result.value);
    },
  );

  server.get<{ Params: { appointmentId: string } }>(
    "/api/appointments/:appointmentId",
    { preHandler: createAdminGuard(app, "operator") },
    async (request, reply) => {
    const result = await app.appointments.getAppointment({
      tenantId: app.tenantId,
      locationId: "default",
      appointmentId: request.params.appointmentId,
    });
    if (!result.ok) {
      const mapped = toHttpError(result.error);
      return reply.code(mapped.statusCode).send(mapped.payload);
    }
    return result.value;
    },
  );
}
