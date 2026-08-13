import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { createApiServer } from "../../src/api/index.js";
import { createDevelopmentApplication } from "../../src/app/index.js";

let server: FastifyInstance | undefined;
afterEach(async () => { await server?.close(); server = undefined; });

describe("local API flow", () => {
  it("supports health, customer, availability, booking, refresh, conflict, and lookup", async () => {
    server = await createApiServer(createDevelopmentApplication());

    const health = await server.inject({ method: "GET", url: "/api/health" });
    expect(health.statusCode).toBe(200);
    expect(health.json()).toEqual({ status: "ok" });

    const customerResponse = await server.inject({
      method: "POST",
      url: "/api/customers",
      payload: { phone: "+529991234567", name: "María Demo" },
    });
    expect(customerResponse.statusCode).toBe(200);
    const customer = customerResponse.json<{ id: string }>();

    const availabilityUrl = "/api/availability?serviceId=consultation&employeeId=employee-1" +
      "&rangeStart=2026-08-10T00%3A00%3A00.000Z&rangeEnd=2026-08-11T00%3A00%3A00.000Z";
    const availability = await server.inject({ method: "GET", url: availabilityUrl });
    expect(availability.statusCode).toBe(200);
    const selected = availability.json<{ slots: Array<{ startAt: string; employeeId: string }> }>().slots[0];
    if (!selected) throw new Error("Expected an available slot");

    const appointmentResponse = await server.inject({
      method: "POST",
      url: "/api/appointments",
      headers: { "idempotency-key": "api-flow-1" },
      payload: {
        customerId: customer.id,
        serviceId: "consultation",
        employeeId: selected.employeeId,
        startAt: selected.startAt,
      },
    });
    expect(appointmentResponse.statusCode).toBe(201);
    const appointment = appointmentResponse.json<{ id: string; status: string }>();
    expect(appointment.status).toBe("CONFIRMED");

    const refreshed = await server.inject({ method: "GET", url: availabilityUrl });
    expect(refreshed.json<{ slots: Array<{ startAt: string }> }>().slots)
      .not.toContainEqual(expect.objectContaining({ startAt: selected.startAt }));

    const conflict = await server.inject({
      method: "POST",
      url: "/api/appointments",
      headers: { "idempotency-key": "api-flow-conflict" },
      payload: {
        customerId: customer.id,
        serviceId: "consultation",
        employeeId: selected.employeeId,
        startAt: selected.startAt,
      },
    });
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json()).toEqual({ error: { code: "SLOT_NO_LONGER_AVAILABLE" } });

    const lookup = await server.inject({ method: "GET", url: `/api/appointments/${appointment.id}` });
    expect(lookup.statusCode).toBe(200);
    expect(lookup.json()).toMatchObject({ id: appointment.id, status: "CONFIRMED" });
  });
});
