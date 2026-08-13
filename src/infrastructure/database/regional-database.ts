import { readFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import type { BusinessProfile } from "../../modules/business/index.js";
import type { RegionId } from "../../shared/types/identifiers.js";

const migrationPath = fileURLToPath(new URL("./migrations/001_initial.sql", import.meta.url));

export const defaultDatabasePath = (region: RegionId): string =>
  process.env[`YIBO_DATABASE_${region}`] ?? resolve(process.cwd(), "data", `yibo-${region.toLowerCase()}.sqlite`);

export function openRegionalDatabase(region: RegionId, path = defaultDatabasePath(region)): DatabaseSync {
  mkdirSync(dirname(path), { recursive: true });
  const database = new DatabaseSync(path);
  database.exec("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;");
  return database;
}

export function migrateDatabase(database: DatabaseSync): void {
  database.exec(readFileSync(migrationPath, "utf8"));
  database.prepare("INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (?, ?)")
    .run(1, new Date().toISOString());
}

export function seedBusiness(database: DatabaseSync, profile: BusinessProfile): void {
  database.prepare(`
    INSERT INTO businesses(region_id, tenant_id, business_id, profile_json)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(region_id, tenant_id) DO UPDATE SET
      business_id = excluded.business_id,
      profile_json = excluded.profile_json
  `).run(profile.region, profile.tenantId, profile.businessId, JSON.stringify(profile));
  database.prepare("DELETE FROM called_numbers WHERE region_id = ? AND tenant_id = ?")
    .run(profile.region, profile.tenantId);
  const insertNumber = database.prepare(
    "INSERT INTO called_numbers(region_id, tenant_id, phone) VALUES (?, ?, ?)",
  );
  for (const phone of profile.calledNumbers) insertNumber.run(profile.region, profile.tenantId, phone);
}
