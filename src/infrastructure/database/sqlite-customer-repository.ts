import type { DatabaseSync } from "node:sqlite";
import type { Customer, CustomerRepository } from "../../modules/customers/index.js";
import type { CustomerId, RegionId, TenantId } from "../../shared/types/identifiers.js";

type CustomerRow = { id: string; tenant_id: string; phone: string; name: string | null; email: string | null };

export class SqliteCustomerRepository implements CustomerRepository {
  constructor(private readonly database: DatabaseSync, private readonly region: RegionId) {}

  async findByPhone(tenantId: TenantId, phone: string): Promise<Customer | null> {
    return this.row(this.database.prepare(`
      SELECT id, tenant_id, phone, name, email FROM customers
      WHERE region_id = ? AND tenant_id = ? AND phone = ?
    `).get(this.region, tenantId, phone) as CustomerRow | undefined);
  }

  async findById(tenantId: TenantId, customerId: CustomerId): Promise<Customer | null> {
    return this.row(this.database.prepare(`
      SELECT id, tenant_id, phone, name, email FROM customers
      WHERE region_id = ? AND tenant_id = ? AND id = ?
    `).get(this.region, tenantId, customerId) as CustomerRow | undefined);
  }

  async save(customer: Customer): Promise<void> {
    this.database.prepare(`
      INSERT INTO customers(region_id, tenant_id, id, phone, name, email)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(region_id, tenant_id, id) DO UPDATE SET
        phone = excluded.phone, name = excluded.name, email = excluded.email
    `).run(this.region, customer.tenantId, customer.id, customer.phone, customer.name ?? null, customer.email ?? null);
  }

  private row(value: CustomerRow | undefined): Customer | null {
    if (!value) return null;
    return {
      id: value.id,
      tenantId: value.tenant_id,
      phone: value.phone,
      ...(value.name ? { name: value.name } : {}),
      ...(value.email ? { email: value.email } : {}),
    };
  }
}
