import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { YiboApplication } from "../../app/index.js";
import { toHttpError } from "../http-errors.js";

interface AppointmentBody {
  customerId?: unknown;
  serviceId?: unknown;
  employeeId?: unknown;
  startAt?: unknown;
}

export async function registerAppointmentRoutes(server: FastifyInstance, app: YiboApplication): Promise<void> {
  server.post<{ Body: AppointmentBody }>("/api/appointments", async (request, reply) => {
    const { customerId, serviceId, employeeId, startAt } = request.body ?? {};
    if (![customerId, serviceId, employeeId, startAt].every((value) => typeof value === "string" && value.length > 0)) {
      return reply.code(400).send({ error: { code: "VALIDATION_ERROR" } });
    }
    const idempotencyHeader = request.headers["idempotency-key"];
    const idempotencyKey = typeof idempotencyHeader === "string" && idempotencyHeader.trim()
      ? idempotencyHeader.trim()
      : `dashboard:${randomUUID()}`;
    const result = await app.appointments.createAppointment({
      tenantId: app.tenantId,
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
    return reply.code(201).send(result.value);
  });

  server.get<{ Params: { appointmentId: string } }>("/api/appointments/:appointmentId", async (request, reply) => {
    const result = await app.appointments.getAppointment({
      tenantId: app.tenantId,
      appointmentId: request.params.appointmentId,
    });
    if (!result.ok) {
      const mapped = toHttpError(result.error);
      return reply.code(mapped.statusCode).send(mapped.payload);
    }
    return result.value;
  });
}
