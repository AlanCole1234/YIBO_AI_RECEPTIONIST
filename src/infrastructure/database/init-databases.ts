import { DEVELOPMENT_BUSINESS, DEVELOPMENT_US_BUSINESS } from "../../app/development-fixtures.js";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { BusinessProfile } from "../../modules/business/index.js";
import { defaultDatabasePath, migrateDatabase, openRegionalDatabase, seedBusiness } from "./regional-database.js";

export function initializeLocalDatabases(): void {
  for (const profile of [DEVELOPMENT_BUSINESS, DEVELOPMENT_US_BUSINESS] satisfies BusinessProfile[]) {
    const database = openRegionalDatabase(profile.region);
    try {
      migrateDatabase(database);
      seedBusiness(database, profile);
    } finally {
      database.close();
    }
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  initializeLocalDatabases();
  console.log(`MX database ready: ${defaultDatabasePath("MX")}`);
  console.log(`US database ready: ${defaultDatabasePath("US")}`);
}
