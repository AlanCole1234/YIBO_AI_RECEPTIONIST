import { describe, expect, it } from "vitest";
import {
  DefaultCustomerService,
  InMemoryCustomerRepository,
} from "../../src/modules/customers/index.js";

function createService(ids = ["customer-1", "customer-2", "customer-3"]) {
  const repository = new InMemoryCustomerRepository();
  let index = 0;
  const service = new DefaultCustomerService(repository, () => ids[index++] ?? "unexpected-id");
  return { repository, service };
}

describe("DefaultCustomerService", () => {
  it("creates a normalized customer and returns it on an idempotent phone lookup", async () => {
    const { service } = createService();

    const created = await service.findOrCreateByPhone({
      tenantId: "tenant-a",
      phone: "+52 (999) 123-4567",
      name: "  Ana  ",
      email: "ANA@EXAMPLE.COM",
    });
    const found = await service.findOrCreateByPhone({
      tenantId: "tenant-a",
      phone: "+52 999 123 4567",
      name: "Ignored on lookup",
    });

    expect(created).toEqual({
      ok: true,
      value: {
        id: "customer-1",
        tenantId: "tenant-a",
        phone: "+529991234567",
        name: "Ana",
        email: "ana@example.com",
      },
    });
    expect(found).toEqual(created);
  });

  it("keeps customers with the same phone isolated by tenant", async () => {
    const { service } = createService();

    const tenantA = await service.findOrCreateByPhone({ tenantId: "tenant-a", phone: "5551234567" });
    const tenantB = await service.findOrCreateByPhone({ tenantId: "tenant-b", phone: "5551234567" });

    expect(tenantA.ok && tenantA.value.id).toBe("customer-1");
    expect(tenantB.ok && tenantB.value.id).toBe("customer-2");
  });

  it("does not allow updating a customer through another tenant", async () => {
    const { service } = createService();
    const created = await service.findOrCreateByPhone({ tenantId: "tenant-a", phone: "5551234567" });
    expect(created.ok).toBe(true);

    const result = await service.updateCustomer({
      tenantId: "tenant-b",
      customerId: "customer-1",
      name: "Intruder",
    });

    expect(result).toEqual({ ok: false, error: { code: "CUSTOMER_NOT_FOUND" } });
  });

  it("updates profile fields within the owning tenant", async () => {
    const { service } = createService();
    await service.findOrCreateByPhone({ tenantId: "tenant-a", phone: "5551234567", name: "Ana" });

    const result = await service.updateCustomer({
      tenantId: "tenant-a",
      customerId: "customer-1",
      phone: "+52 999 111 2233",
      email: "NEW@EXAMPLE.COM",
    });

    expect(result).toEqual({
      ok: true,
      value: {
        id: "customer-1",
        tenantId: "tenant-a",
        phone: "+529991112233",
        name: "Ana",
        email: "new@example.com",
      },
    });
  });

  it("rejects an invalid phone without persisting a customer", async () => {
    const { service } = createService();

    const result = await service.findOrCreateByPhone({ tenantId: "tenant-a", phone: "123" });

    expect(result).toEqual({
      ok: false,
      error: {
        code: "VALIDATION_ERROR",
        field: "phone",
        message: "phone must contain between 7 and 15 digits",
      },
    });
  });

  it("rejects assigning a phone already owned by another customer in the tenant", async () => {
    const { service } = createService();
    await service.findOrCreateByPhone({ tenantId: "tenant-a", phone: "5551111111" });
    await service.findOrCreateByPhone({ tenantId: "tenant-a", phone: "5552222222" });

    const result = await service.updateCustomer({
      tenantId: "tenant-a",
      customerId: "customer-2",
      phone: "5551111111",
    });

    expect(result).toEqual({ ok: false, error: { code: "PHONE_ALREADY_EXISTS" } });
  });
});
