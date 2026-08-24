import { readFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import type { BusinessProfile } from "../../modules/business/index.js";
import type { RegionId } from "../../shared/types/identifiers.js";

const migrations = [
  { version: 1, path: fileURLToPath(new URL("./migrations/001_initial.sql", import.meta.url)) },
  { version: 2, path: fileURLToPath(new URL("./migrations/002_google_calendar_tokens.sql", import.meta.url)) },
];

export const defaultDatabasePath = (region: RegionId): string =>
  process.env[`YIBO_DATABASE_${region}`] ?? resolve(process.cwd(), "data", `yibo-${region.toLowerCase()}.sqlite`);

export function openRegionalDatabase(region: RegionId, path = defaultDatabasePath(region)): DatabaseSync {
  mkdirSync(dirname(path), { recursive: true });
  const database = new DatabaseSync(path);
  database.exec("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;");
  return database;
}

export function migrateDatabase(database: DatabaseSync): void {
  for (const migration of migrations) {
    const applied = database.prepare("SELECT 1 FROM schema_migrations WHERE version = ?").get(migration.version);
    if (applied) continue;
    database.exec(readFileSync(migration.path, "utf8"));
    database.prepare("INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)")
      .run(migration.version, new Date().toISOString());
  }
}

export function seedBusiness(database: DatabaseSync, profile: BusinessProfile): void {
  // A local database outlives individual application runs. Treat an existing
  // tenant or business ID as the source of truth rather than overwriting it
  // with development fixtures (which would also discard saved settings such
  // as the clinic timezone).
  const existing = database.prepare(`
    SELECT tenant_id
    FROM businesses
    WHERE region_id = ? AND (tenant_id = ? OR business_id = ?)
    LIMIT 1
  `).get(profile.region, profile.tenantId, profile.businessId);
  if (existing) return;

  database.prepare(`
    INSERT INTO businesses(region_id, tenant_id, business_id, profile_json)
    VALUES (?, ?, ?, ?)
  `).run(profile.region, profile.tenantId, profile.businessId, JSON.stringify(profile));
  database.prepare("DELETE FROM called_numbers WHERE region_id = ? AND tenant_id = ?")
    .run(profile.region, profile.tenantId);
  const insertNumber = database.prepare(
    "INSERT INTO called_numbers(region_id, tenant_id, phone) VALUES (?, ?, ?)",
  );
  for (const phone of profile.calledNumbers) insertNumber.run(profile.region, profile.tenantId, phone);
}
