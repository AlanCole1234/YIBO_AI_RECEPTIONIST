import { DatabaseSync } from "node:sqlite";
import { DEVELOPMENT_BUSINESS } from "../../src/app/development-fixtures.js";
import { migrateDatabase, seedBusiness } from "../../src/infrastructure/database/regional-database.js";
import { SqliteBusinessRepository } from "../../src/infrastructure/database/sqlite-business-repository.js";

const database = new DatabaseSync(":memory:");
try {
  migrateDatabase(database);
  seedBusiness(database, DEVELOPMENT_BUSINESS);
  const repository = new SqliteBusinessRepository(database, "MX");
  const initial = await repository.findConfigurationByTenantId(DEVELOPMENT_BUSINESS.tenantId);
  if (!initial) throw new Error("Expected seeded configuration");
  const updatedProfile = { ...DEVELOPMENT_BUSINESS, name: "SQLite updated" };
  const saved = await repository.saveIfVersion(updatedProfile, initial.version);
  const stale = await repository.saveIfVersion(DEVELOPMENT_BUSINESS, initial.version);
  const final = await repository.findConfigurationByTenantId(DEVELOPMENT_BUSINESS.tenantId);
  console.log(JSON.stringify({ initialVersion: initial.version, saved, stale, final }));
} finally {
  database.close();
}
