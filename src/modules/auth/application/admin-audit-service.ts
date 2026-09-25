import { createHash, randomUUID } from "node:crypto";
import type { AdminPrincipal } from "./contracts.js";
import type { AdminAuditEntry, AdminAuditLogPort } from "../ports/admin-audit-log-port.js";

export interface RecordAdminMutation {
  principal: AdminPrincipal;
  entityType: string;
  entityId: string;
  action: string;
  entityVersion?: string | number | null;
  before?: unknown;
  after?: unknown;
}

export class AdminAuditService {
  constructor(
    private readonly log: AdminAuditLogPort,
    private readonly now: () => Date = () => new Date(),
    private readonly generateId: () => string = () => `audit-${randomUUID()}`,
  ) {}

  async recordMutation(command: RecordAdminMutation): Promise<AdminAuditEntry> {
    const entry: AdminAuditEntry = {
      id: this.generateId(),
      tenantId: command.principal.tenantId,
      subject: command.principal.subject,
      entityType: command.entityType,
      entityId: command.entityId,
      action: command.action,
      entityVersion: command.entityVersion == null ? null : String(command.entityVersion),
      occurredAt: this.now().toISOString(),
      diff: buildRedactedDiff(command.before, command.after),
    };
    await this.log.append(entry);
    return structuredClone(entry);
  }

  listByTenant(tenantId: string): Promise<AdminAuditEntry[]> {
    return this.log.listByTenant(tenantId);
  }
}

const buildRedactedDiff = (before: unknown, after: unknown): AdminAuditEntry["diff"] => {
  const previous = asRecord(before);
  const next = asRecord(after);
  const keys = new Set([...Object.keys(previous), ...Object.keys(next)]);
  return Object.fromEntries([...keys]
    .filter((key) => JSON.stringify(previous[key]) !== JSON.stringify(next[key]))
    .map((key) => [key, {
      before: redactValue(key, previous[key]),
      after: redactValue(key, next[key]),
    }]));
};

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : { value };

const redactValue = (key: string, value: unknown): unknown => {
  if (/password|secret|token|api.?key|authorization|cookie/i.test(key)) return "[REDACTED]";
  if (/prompt|instruction|system.?message/i.test(key)) return fingerprintText(value);
  if (typeof value === "string") {
    if (/email|phone|name/i.test(key)) return fingerprintText(value, "PII");
    return value.length > 256 ? fingerprintText(value, "TRUNCATED") : value;
  }
  if (Array.isArray(value)) return value.map((item) => redactValue(key, item));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([childKey, child]) => [childKey, redactValue(childKey, child)]));
  }
  return value;
};

const fingerprintText = (value: unknown, label = "REDACTED_TEXT"): string => {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  const digest = createHash("sha256").update(text ?? "undefined").digest("hex").slice(0, 16);
  return `[${label} sha256=${digest} length=${text?.length ?? 0}]`;
};
