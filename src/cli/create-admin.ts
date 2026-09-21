import { randomUUID } from "node:crypto";
import { stdin, stdout } from "node:process";
import { DEVELOPMENT_BUSINESS, DEVELOPMENT_US_BUSINESS } from "../app/development-fixtures.js";
import { AdminCredentialService, ScryptPasswordHasher, type AdminRole } from "../modules/auth/index.js";
import { SqliteAdminIdentityRepository } from "../infrastructure/database/sqlite-admin-identity-repository.js";
import { migrateDatabase, openRegionalDatabase, seedBusiness } from "../infrastructure/database/regional-database.js";
import type { RegionId } from "../shared/types/identifiers.js";

const options = parseArguments(process.argv.slice(2));
const profile = [DEVELOPMENT_BUSINESS, DEVELOPMENT_US_BUSINESS]
  .find((candidate) => candidate.tenantId === options.tenantId && candidate.region === options.region);
if (!profile) throw new Error("The tenant must exist in the configured regional bootstrap catalog");

const password = await readSecret("Password (minimum 12 characters): ");
const database = openRegionalDatabase(options.region);
try {
  migrateDatabase(database);
  seedBusiness(database, profile);
  const service = new AdminCredentialService(
    new SqliteAdminIdentityRepository(database, options.region),
    new ScryptPasswordHasher(),
    () => `admin-${randomUUID()}`,
  );
  const created = await service.create({
    tenantId: options.tenantId,
    email: options.email,
    password,
    roles: [options.role],
  });
  stdout.write(`Created ${created.email} for ${created.tenantId} with role ${created.roles.join(",")}\n`);
} finally {
  database.close();
}

function parseArguments(values: string[]): { tenantId: string; email: string; region: RegionId; role: AdminRole } {
  const valueFor = (name: string): string | undefined => {
    const index = values.indexOf(name);
    return index < 0 ? undefined : values[index + 1];
  };
  const tenantId = valueFor("--tenant")?.trim();
  const email = valueFor("--email")?.trim();
  const region = valueFor("--region")?.toUpperCase();
  const role = valueFor("--role") ?? "tenant_admin";
  if (!tenantId || !email || (region !== "MX" && region !== "US")
    || !["owner", "office_manager", "secretary", "read_only", "tenant_admin", "operator"].includes(role)) {
    throw new Error("Usage: pnpm admin:create --tenant <id> --region <MX|US> --email <email> [--role owner|office_manager|secretary|read_only]");
  }
  return { tenantId, email, region, role: role as AdminRole };
}

async function readSecret(prompt: string): Promise<string> {
  if (!stdin.isTTY || typeof stdin.setRawMode !== "function") throw new Error("admin:create requires an interactive terminal");
  stdout.write(prompt);
  stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding("utf8");
  return new Promise((resolve, reject) => {
    let value = "";
    const cleanup = () => { stdin.setRawMode(false); stdin.pause(); stdin.removeListener("data", onData); };
    const onData = (chunk: string) => {
      for (const character of chunk) {
        if (character === "\u0003") { cleanup(); stdout.write("\n"); reject(new Error("Cancelled")); return; }
        if (character === "\r" || character === "\n") { cleanup(); stdout.write("\n"); resolve(value); return; }
        if (character === "\u007f" || character === "\b") {
          if (value) { value = value.slice(0, -1); stdout.write("\b \b"); }
        } else { value += character; stdout.write("*"); }
      }
    };
    stdin.on("data", onData);
  });
}
