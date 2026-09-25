import { DatabaseSync } from "node:sqlite";
import { DEVELOPMENT_BUSINESS } from "../../src/app/development-fixtures.js";
import { SqliteAdminIdentityRepository } from "../../src/infrastructure/database/sqlite-admin-identity-repository.js";
import { migrateDatabase, seedBusiness } from "../../src/infrastructure/database/regional-database.js";
import { AdminCredentialService, ScryptPasswordHasher } from "../../src/modules/auth/index.js";

const database = new DatabaseSync(":memory:");
try {
  migrateDatabase(database);
  seedBusiness(database, DEVELOPMENT_BUSINESS);
  const service = new AdminCredentialService(
    new SqliteAdminIdentityRepository(database, "MX"),
    new ScryptPasswordHasher(),
    () => "admin-1",
  );
  const created = await service.create({
    tenantId: DEVELOPMENT_BUSINESS.tenantId,
    email: " ADMIN@YIBO.EXAMPLE ",
    password: "a-secure-password",
    roles: ["tenant_admin"],
  });
  const authenticated = await service.authenticate({
    tenantId: DEVELOPMENT_BUSINESS.tenantId,
    email: "admin@yibo.example",
    password: "a-secure-password",
  });
  const wrongPassword = await service.authenticate({
    tenantId: DEVELOPMENT_BUSINESS.tenantId,
    email: "admin@yibo.example",
    password: "wrong-password",
  });
  let duplicateRejected = false;
  try {
    await service.create({
      tenantId: DEVELOPMENT_BUSINESS.tenantId,
      email: "admin@yibo.example",
      password: "another-secure-password",
      roles: ["operator"],
    });
  } catch (error) {
    duplicateRejected = error instanceof Error && error.message === "ADMIN_EMAIL_ALREADY_EXISTS";
  }
  console.log(JSON.stringify({
    created,
    authenticated: authenticated?.subject === created.subject,
    wrongPasswordRejected: wrongPassword === null,
    duplicateRejected,
  }));
} finally {
  database.close();
}
