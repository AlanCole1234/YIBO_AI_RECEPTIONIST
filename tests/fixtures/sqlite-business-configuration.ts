import { DatabaseSync } from "node:sqlite";
import { DEVELOPMENT_BUSINESS } from "../../src/app/development-fixtures.js";
import { migrateDatabase, seedBusiness } from "../../src/infrastructure/database/regional-database.js";
import { SqliteBusinessRepository } from "../../src/infrastructure/database/sqlite-business-repository.js";
import { SqliteAppointmentRepository } from "../../src/infrastructure/database/sqlite-appointment-repository.js";

const database = new DatabaseSync(":memory:");
try {
  migrateDatabase(database);
  seedBusiness(database, DEVELOPMENT_BUSINESS);
  database.prepare(`INSERT INTO customers(region_id, tenant_id, id, phone)
    VALUES (?, ?, ?, ?)`
  ).run("MX", DEVELOPMENT_BUSINESS.tenantId, "customer-1", "+529990000001");
  const appointments = new SqliteAppointmentRepository(database, "MX");
  await appointments.save({
    id: "appointment-1", tenantId: DEVELOPMENT_BUSINESS.tenantId, locationId: "default",
    customerId: "customer-1", serviceId: "consultation", employeeId: "employee-1",
    startAt: "2026-09-11T15:00:00.000Z", endAt: "2026-09-11T15:30:00.000Z",
    status: "CONFIRMED", idempotencyKey: "professional-usage", source: "API",
  });
  const repository = new SqliteBusinessRepository(database, "MX");
  const initial = await repository.findConfigurationByTenantId(DEVELOPMENT_BUSINESS.tenantId);
  if (!initial) throw new Error("Expected seeded configuration");
  const updatedProfile = { ...DEVELOPMENT_BUSINESS, name: "SQLite updated" };
  const saved = await repository.saveIfVersion(updatedProfile, initial.version);
  const stale = await repository.saveIfVersion(DEVELOPMENT_BUSINESS, initial.version);
  const final = await repository.findConfigurationByTenantId(DEVELOPMENT_BUSINESS.tenantId);
  const professionalUsage = {
    anyLocation: await appointments.hasProfessionalReferences({
      tenantId: DEVELOPMENT_BUSINESS.tenantId, professionalId: "employee-1",
    }),
    defaultLocation: await appointments.hasProfessionalReferences({
      tenantId: DEVELOPMENT_BUSINESS.tenantId, locationId: "default", professionalId: "employee-1",
    }),
    otherLocation: await appointments.hasProfessionalReferences({
      tenantId: DEVELOPMENT_BUSINESS.tenantId, locationId: "other", professionalId: "employee-1",
    }),
  };
  console.log(JSON.stringify({ initialVersion: initial.version, saved, stale, final, professionalUsage }));
} finally {
  database.close();
}
