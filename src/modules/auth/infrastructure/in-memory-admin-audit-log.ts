import type { AdminAuditEntry, AdminAuditLogPort } from "../ports/admin-audit-log-port.js";

export class InMemoryAdminAuditLog implements AdminAuditLogPort {
  private readonly entries: AdminAuditEntry[] = [];

  async append(entry: AdminAuditEntry): Promise<void> {
    this.entries.push(structuredClone(entry));
  }

  async listByTenant(tenantId: string): Promise<AdminAuditEntry[]> {
    return this.entries.filter((entry) => entry.tenantId === tenantId).map((entry) => structuredClone(entry));
  }
}
