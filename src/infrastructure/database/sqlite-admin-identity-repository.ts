import type { DatabaseSync } from "node:sqlite";
import type {
  AdminIdentity,
  AdminIdentityRepository,
  AdminRole,
} from "../../modules/auth/index.js";
import type { RegionId, TenantId } from "../../shared/types/identifiers.js";

type AdminRow = {
  subject: string;
  tenant_id: string;
  email_normalized: string;
  password_hash: string;
  roles_json: string;
  active: number;
  created_at: string;
  updated_at: string;
};

export class SqliteAdminIdentityRepository implements AdminIdentityRepository {
  constructor(private readonly database: DatabaseSync, private readonly region: RegionId) {}

  async findByEmail(tenantId: TenantId, normalizedEmail: string): Promise<AdminIdentity | null> {
    const row = this.database.prepare(`SELECT subject, tenant_id, email_normalized, password_hash,
      roles_json, active, created_at, updated_at FROM admin_users
      WHERE region_id = ? AND tenant_id = ? AND email_normalized = ?`
    ).get(this.region, tenantId, normalizedEmail) as AdminRow | undefined;
    return row ? fromRow(row) : null;
  }

  async save(identity: AdminIdentity): Promise<void> {
    this.database.prepare(`INSERT INTO admin_users(region_id, tenant_id, subject, email_normalized,
      password_hash, roles_json, active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(region_id, tenant_id, subject) DO UPDATE SET
      email_normalized=excluded.email_normalized, password_hash=excluded.password_hash,
      roles_json=excluded.roles_json, active=excluded.active, updated_at=excluded.updated_at`
    ).run(this.region, identity.tenantId, identity.subject, identity.email, identity.passwordHash,
      JSON.stringify(identity.roles), identity.active ? 1 : 0, identity.createdAt, identity.updatedAt);
  }
}

const fromRow = (row: AdminRow): AdminIdentity => ({
  subject: row.subject,
  tenantId: row.tenant_id,
  email: row.email_normalized,
  passwordHash: row.password_hash,
  roles: JSON.parse(row.roles_json) as AdminRole[],
  active: row.active === 1,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});
