import { describe, expect, it } from "vitest";
import { createDevelopmentApplication } from "../../src/app/index.js";

const monday = {
  rangeStart: "2026-08-10T00:00:00.000Z",
  rangeEnd: "2026-08-11T00:00:00.000Z",
};

describe("development application composition", () => {
  it("confirms a booking and makes the occupied slot unavailable", async () => {
    const app = createDevelopmentApplication();
    const customer = await app.customers.findOrCreateByPhone({
      tenantId: app.tenantId,
      phone: "+529991234567",
      name: "Cliente de prueba",
    });
    if (!customer.ok) throw new Error("Expected customer creation to succeed");

    const before = await app.scheduling.findAvailableSlots({
      tenantId: app.tenantId,
      serviceId: "consultation",
      employeeId: "employee-1",
      ...monday,
      limit: 100,
    });
    if (!before.ok || !before.value[0]) throw new Error("Expected at least one available slot");
    const selected = before.value[0];

    const created = await app.appointments.createAppointment({
      tenantId: app.tenantId,
      customerId: customer.value.id,
      serviceId: "consultation",
      employeeId: selected.employeeId,
      startAt: selected.startAt,
      idempotencyKey: "integration-booking-1",
      source: "API",
    });
    expect(created.ok && created.value.status).toBe("CONFIRMED");

    const after = await app.scheduling.findAvailableSlots({
      tenantId: app.tenantId,
      serviceId: "consultation",
      employeeId: "employee-1",
      ...monday,
      limit: 100,
    });
    expect(after.ok).toBe(true);
    expect(after.ok && after.value.some((slot) => slot.startAt === selected.startAt)).toBe(false);
  });
});
