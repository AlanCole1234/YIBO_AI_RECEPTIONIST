import type { DatabaseSync } from "node:sqlite";
import type { AdminAuditEntry, AdminAuditLogPort } from "../../modules/auth/index.js";
import type { RegionId } from "../../shared/types/identifiers.js";

type AuditRow = {
  id: string;
  tenant_id: string;
  subject: string;
  entity_type: string;
  entity_id: string;
  action: string;
  entity_version: string | null;
  occurred_at: string;
  diff_json: string;
};

export class SqliteAdminAuditLog implements AdminAuditLogPort {
  constructor(private readonly database: DatabaseSync, private readonly region: RegionId) {}

  async append(entry: AdminAuditEntry): Promise<void> {
    this.database.prepare(`INSERT INTO admin_audit_log(region_id, id, tenant_id, subject,
      entity_type, entity_id, action, entity_version, occurred_at, diff_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(this.region, entry.id, entry.tenantId, entry.subject, entry.entityType,
      entry.entityId, entry.action, entry.entityVersion, entry.occurredAt, JSON.stringify(entry.diff));
  }

  async listByTenant(tenantId: string): Promise<AdminAuditEntry[]> {
    const rows = this.database.prepare(`SELECT id, tenant_id, subject, entity_type, entity_id,
      action, entity_version, occurred_at, diff_json FROM admin_audit_log
      WHERE region_id = ? AND tenant_id = ? ORDER BY occurred_at, id`
    ).all(this.region, tenantId) as AuditRow[];
    return rows.map((row) => ({
      id: row.id,
      tenantId: row.tenant_id,
      subject: row.subject,
      entityType: row.entity_type,
      entityId: row.entity_id,
      action: row.action,
      entityVersion: row.entity_version,
      occurredAt: row.occurred_at,
      diff: JSON.parse(row.diff_json) as AdminAuditEntry["diff"],
    }));
  }
}
