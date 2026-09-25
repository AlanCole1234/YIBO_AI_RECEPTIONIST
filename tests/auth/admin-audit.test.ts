import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { DEVELOPMENT_BUSINESS } from "../../src/app/development-fixtures.js";
import { AdminAuditService, InMemoryAdminAuditLog } from "../../src/modules/auth/index.js";

const principal = {
  subject: "admin-1",
  tenantId: DEVELOPMENT_BUSINESS.tenantId,
  roles: ["tenant_admin" as const],
  issuedAt: "2026-09-10T09:00:00.000Z",
  expiresAt: "2026-09-10T17:00:00.000Z",
};

describe("administrative audit", () => {
  it("records a useful diff without persisting prompts, secrets or PII", async () => {
    const service = new AdminAuditService(
      new InMemoryAdminAuditLog(),
      () => new Date("2026-09-10T10:00:00.000Z"),
      () => "audit-1",
    );
    await service.recordMutation({
      principal,
      entityType: "agent_configuration",
      entityId: principal.tenantId,
      action: "update",
      entityVersion: 1,
      before: { instructions: "old complete system prompt", apiKey: "old-secret", email: "owner@example.com" },
      after: { instructions: "new complete system prompt", apiKey: "new-secret", email: "new@example.com" },
    });

    const [entry] = await service.listByTenant(principal.tenantId);
    expect(entry).toMatchObject({
      id: "audit-1",
      subject: principal.subject,
      tenantId: principal.tenantId,
      entityType: "agent_configuration",
      action: "update",
      entityVersion: "1",
      occurredAt: "2026-09-10T10:00:00.000Z",
    });
    expect(entry?.diff.instructions).toEqual({
      before: expect.stringMatching(/^\[REDACTED_TEXT sha256=/),
      after: expect.stringMatching(/^\[REDACTED_TEXT sha256=/),
    });
    expect(entry?.diff.apiKey).toEqual({ before: "[REDACTED]", after: "[REDACTED]" });
    const serialized = JSON.stringify(entry);
    for (const forbidden of ["complete system prompt", "old-secret", "new-secret", "owner@example.com", "new@example.com"]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it("persists tenant-scoped entries through the idempotent SQLite migration", async () => {
    const output = execFileSync(process.execPath, [
      "--import", "tsx", "tests/fixtures/sqlite-admin-audit.ts",
    ], { encoding: "utf8", cwd: process.cwd() });
    const result = JSON.parse(output.trim()) as { entries: unknown[]; otherTenant: unknown[] };
    expect(result.entries).toMatchObject([{
        id: "audit-sqlite-1",
        diff: { timezone: { before: "America/Mexico_City", after: "America/Cancun" } },
    }]);
    expect(result.otherTenant).toEqual([]);
  });
});
