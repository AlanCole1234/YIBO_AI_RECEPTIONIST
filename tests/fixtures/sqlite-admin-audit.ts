import { DatabaseSync } from "node:sqlite";
import { DEVELOPMENT_BUSINESS } from "../../src/app/development-fixtures.js";
import { migrateDatabase, seedBusiness } from "../../src/infrastructure/database/regional-database.js";
import { SqliteAdminAuditLog } from "../../src/infrastructure/database/sqlite-admin-audit-log.js";
import { AdminAuditService } from "../../src/modules/auth/index.js";

const database = new DatabaseSync(":memory:");
try {
  migrateDatabase(database);
  migrateDatabase(database);
  seedBusiness(database, DEVELOPMENT_BUSINESS);
  const service = new AdminAuditService(
    new SqliteAdminAuditLog(database, "MX"),
    () => new Date("2026-09-10T10:00:00.000Z"),
    () => "audit-sqlite-1",
  );
  await service.recordMutation({
    principal: {
      subject: "admin-1",
      tenantId: DEVELOPMENT_BUSINESS.tenantId,
      roles: ["tenant_admin"],
      issuedAt: "2026-09-10T09:00:00.000Z",
      expiresAt: "2026-09-10T17:00:00.000Z",
    },
    entityType: "business_configuration",
    entityId: DEVELOPMENT_BUSINESS.businessId,
    action: "update_timezone",
    before: { timezone: "America/Mexico_City" },
    after: { timezone: "America/Cancun" },
  });
  console.log(JSON.stringify({
    entries: await service.listByTenant(DEVELOPMENT_BUSINESS.tenantId),
    otherTenant: await service.listByTenant("tenant-other"),
  }));
} finally {
  database.close();
}
