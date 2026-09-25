import type { DatabaseSync } from "node:sqlite";
import type { Customer, CustomerRepository } from "../../modules/customers/index.js";
import type { CustomerId, RegionId, TenantId } from "../../shared/types/identifiers.js";

type CustomerRow = { id: string; tenant_id: string; phone: string; name: string | null; email: string | null;
  preferred_language: string | null; email_verified_at: string | null; email_opt_in: number; source: NonNullable<Customer["source"]>;
  created_at: string; updated_at: string };

export class SqliteCustomerRepository implements CustomerRepository {
  constructor(private readonly database: DatabaseSync, private readonly region: RegionId) {}

  async findByPhone(tenantId: TenantId, phone: string): Promise<Customer | null> {
    return this.row(this.database.prepare(`
      ${SELECT_CUSTOMER} FROM customers
      WHERE region_id = ? AND tenant_id = ? AND phone = ?
    `).get(this.region, tenantId, phone) as CustomerRow | undefined);
  }

  async findById(tenantId: TenantId, customerId: CustomerId): Promise<Customer | null> {
    return this.row(this.database.prepare(`
      ${SELECT_CUSTOMER} FROM customers
      WHERE region_id = ? AND tenant_id = ? AND id = ?
    `).get(this.region, tenantId, customerId) as CustomerRow | undefined);
  }

  async save(customer: Customer): Promise<void> {
    this.database.prepare(`
      INSERT INTO customers(region_id, tenant_id, id, phone, name, email, preferred_language,
        email_verified_at, email_opt_in, source, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(region_id, tenant_id, id) DO UPDATE SET
        phone = excluded.phone, name = excluded.name, email = excluded.email,
        preferred_language = excluded.preferred_language, email_verified_at = excluded.email_verified_at,
        email_opt_in = excluded.email_opt_in, source = excluded.source, updated_at = excluded.updated_at
    `).run(this.region, customer.tenantId, customer.id, customer.phone, customer.name ?? null, customer.email ?? null,
      customer.preferredLanguage ?? null, customer.emailVerifiedAt ?? null, customer.emailOptIn === false ? 0 : 1,
      customer.source ?? "UNKNOWN", customer.createdAt ?? "", customer.updatedAt ?? new Date().toISOString());
  }

  async search(tenantId: TenantId, query: string, limit: number): Promise<Customer[]> {
    const pattern = `%${query.replace(/[\\%_]/g, "\\$&")}%`;
    return this.database.prepare(`${SELECT_CUSTOMER} FROM customers
      WHERE region_id = ? AND tenant_id = ? AND (? = '' OR name LIKE ? ESCAPE '\\'
        OR phone LIKE ? ESCAPE '\\' OR email LIKE ? ESCAPE '\\')
      ORDER BY COALESCE(name, phone) COLLATE NOCASE LIMIT ?`)
      .all(this.region, tenantId, query, pattern, pattern, pattern, limit)
      .map((row) => this.row(row as CustomerRow)!);
  }

  async listAll(tenantId: TenantId): Promise<Customer[]> {
    return this.database.prepare(`${SELECT_CUSTOMER} FROM customers
      WHERE region_id = ? AND tenant_id = ? ORDER BY COALESCE(name, phone) COLLATE NOCASE`)
      .all(this.region, tenantId).map((row) => this.row(row as CustomerRow)!);
  }

  private row(value: CustomerRow | undefined): Customer | null {
    if (!value) return null;
    return {
      id: value.id,
      tenantId: value.tenant_id,
      phone: value.phone,
      ...(value.name ? { name: value.name } : {}),
      ...(value.email ? { email: value.email } : {}),
      ...(value.preferred_language ? { preferredLanguage: value.preferred_language } : {}),
      ...(value.email_verified_at ? { emailVerifiedAt: value.email_verified_at } : {}),
      emailOptIn: value.email_opt_in === 1,
      source: value.source,
      createdAt: value.created_at,
      updatedAt: value.updated_at,
    };
  }
}

const SELECT_CUSTOMER = `SELECT id, tenant_id, phone, name, email, preferred_language,
  email_verified_at, email_opt_in, source, created_at, updated_at`;
