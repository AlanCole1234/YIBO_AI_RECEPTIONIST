import { DatabaseSync } from "node:sqlite";
import { DEVELOPMENT_US_BUSINESS } from "../../src/app/development-fixtures.js";
import { migrateDatabase, openRegionalDatabase, seedBusiness } from "../../src/infrastructure/database/regional-database.js";

const [path, mode] = process.argv.slice(2) as [string, "legacy" | "custom"];
if (!path || (mode !== "legacy" && mode !== "custom")) throw new Error("Expected database path and test mode");

const setup = new DatabaseSync(path);
migrateDatabase(setup);
const existing = mode === "legacy"
  ? {
      ...DEVELOPMENT_US_BUSINESS,
      timezone: "America/Denver",
      openingHours: DEVELOPMENT_US_BUSINESS.openingHours.map((rule) => ({ ...rule, startTime: "09:00" })),
    }
  : {
      ...DEVELOPMENT_US_BUSINESS,
      openingHours: DEVELOPMENT_US_BUSINESS.openingHours.map((rule) => ({ ...rule, startTime: "10:00", endTime: "16:00" })),
      slotIntervalMinutes: 45,
    };
if (mode === "legacy") delete existing.slotIntervalMinutes;
setup.prepare("INSERT INTO businesses(region_id, tenant_id, business_id, profile_json) VALUES (?, ?, ?, ?)")
  .run(existing.region, existing.tenantId, existing.businessId, JSON.stringify(existing));
setup.close();

const database = openRegionalDatabase("US", path);
seedBusiness(database, DEVELOPMENT_US_BUSINESS);
const row = database.prepare("SELECT profile_json FROM businesses WHERE region_id = ? AND tenant_id = ?")
  .get("US", DEVELOPMENT_US_BUSINESS.tenantId) as { profile_json: string };
console.log(JSON.stringify(JSON.parse(row.profile_json)));
database.close();
