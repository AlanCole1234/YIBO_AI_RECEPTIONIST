import type { TenantId } from "../../../shared/types/identifiers.js";

export interface AdminAuditDiffValue {
  before: unknown;
  after: unknown;
}

export interface AdminAuditEntry {
  id: string;
  tenantId: TenantId;
  subject: string;
  entityType: string;
  entityId: string;
  action: string;
  entityVersion: string | null;
  occurredAt: string;
  diff: Record<string, AdminAuditDiffValue>;
}

export interface AdminAuditLogPort {
  append(entry: AdminAuditEntry): Promise<void>;
  listByTenant(tenantId: TenantId): Promise<AdminAuditEntry[]>;
}
