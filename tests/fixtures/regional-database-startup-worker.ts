import { DEVELOPMENT_US_BUSINESS } from "../../src/app/index.js";
import {
  migrateDatabase,
  openRegionalDatabase,
  seedBusiness,
} from "../../src/infrastructure/database/regional-database.js";

const path = process.argv[2];
if (!path) throw new Error("Expected a regional database path");

const database = openRegionalDatabase("US", path);
try {
  migrateDatabase(database);
  seedBusiness(database, DEVELOPMENT_US_BUSINESS);
  console.log("regional database startup complete");
} finally {
  database.close();
}
