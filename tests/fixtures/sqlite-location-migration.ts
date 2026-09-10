import { DatabaseSync } from "node:sqlite";
import { migrateDatabase } from "../../src/infrastructure/database/regional-database.js";

const database = new DatabaseSync(":memory:");
try {
  database.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
    INSERT INTO schema_migrations(version, applied_at) VALUES
      (1, '2026-01-01T00:00:00.000Z'), (2, '2026-01-01T00:00:00.000Z'),
      (3, '2026-01-01T00:00:00.000Z'), (4, '2026-01-01T00:00:00.000Z');
    CREATE TABLE businesses (
      region_id TEXT NOT NULL, tenant_id TEXT NOT NULL, business_id TEXT NOT NULL, profile_json TEXT NOT NULL,
      PRIMARY KEY (region_id, tenant_id)
    );
    CREATE TABLE called_numbers (
      region_id TEXT NOT NULL, tenant_id TEXT NOT NULL, phone TEXT NOT NULL,
      PRIMARY KEY (region_id, phone),
      FOREIGN KEY (region_id, tenant_id) REFERENCES businesses(region_id, tenant_id)
    );
    CREATE TABLE customers (
      region_id TEXT NOT NULL, tenant_id TEXT NOT NULL, id TEXT NOT NULL, phone TEXT NOT NULL,
      name TEXT, email TEXT, PRIMARY KEY (region_id, tenant_id, id)
    );
    CREATE TABLE appointments (
      region_id TEXT NOT NULL, tenant_id TEXT NOT NULL, id TEXT NOT NULL, customer_id TEXT NOT NULL,
      service_id TEXT NOT NULL, employee_id TEXT NOT NULL, start_at TEXT NOT NULL, end_at TEXT NOT NULL,
      status TEXT NOT NULL, idempotency_key TEXT NOT NULL, source TEXT NOT NULL, source_call_id TEXT,
      external_calendar_event_id TEXT, PRIMARY KEY (region_id, tenant_id, id)
    );
    CREATE TABLE calls (
      region_id TEXT NOT NULL, tenant_id TEXT NOT NULL, call_id TEXT NOT NULL, customer_id TEXT,
      caller_number TEXT NOT NULL, called_number TEXT NOT NULL, state TEXT NOT NULL,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY (region_id, tenant_id, call_id)
    );
  `);
  database.prepare("INSERT INTO businesses VALUES (?, ?, ?, ?)")
    .run("MX", "tenant-1", "business-1", "{}");
  database.prepare("INSERT INTO called_numbers(region_id, tenant_id, phone) VALUES (?, ?, ?)")
    .run("MX", "tenant-1", "+529991234567");
  database.prepare("INSERT INTO customers(region_id, tenant_id, id, phone) VALUES (?, ?, ?, ?)")
    .run("MX", "tenant-1", "customer-1", "+529990000001");
  database.prepare(`INSERT INTO appointments(region_id, tenant_id, id, customer_id, service_id,
    employee_id, start_at, end_at, status, idempotency_key, source)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run("MX", "tenant-1", "appointment-1", "customer-1", "service-1", "employee-1",
      "2026-09-10T10:00:00.000Z", "2026-09-10T10:30:00.000Z", "CONFIRMED", "key-1", "API");
  database.prepare(`INSERT INTO calls(region_id, tenant_id, call_id, caller_number, called_number,
    state, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run("MX", "tenant-1", "call-1", "+529990000001", "+529991234567", "COMPLETED",
      "2026-09-10T10:00:00.000Z", "2026-09-10T10:05:00.000Z");

  migrateDatabase(database);
  migrateDatabase(database);
  const freshDatabase = new DatabaseSync(":memory:");
  migrateDatabase(freshDatabase);
  const freshColumns = Object.fromEntries(["businesses", "called_numbers", "calls", "appointments"].map((table) => [
    table,
    (freshDatabase.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map(({ name }) => name),
  ]));
  freshDatabase.close();
  const value = {
    versions: database.prepare("SELECT version FROM schema_migrations ORDER BY version").all(),
    calledNumber: database.prepare("SELECT phone, location_id FROM called_numbers").get(),
    call: database.prepare("SELECT call_id, location_id FROM calls").get(),
    appointment: database.prepare(`SELECT id, location_id, service_name_snapshot,
      price_amount_minor, price_currency FROM appointments`).get(),
    counts: {
      calledNumbers: (database.prepare("SELECT COUNT(*) count FROM called_numbers").get() as { count: number }).count,
      calls: (database.prepare("SELECT COUNT(*) count FROM calls").get() as { count: number }).count,
      appointments: (database.prepare("SELECT COUNT(*) count FROM appointments").get() as { count: number }).count,
    },
    freshColumns,
  };
  console.log(JSON.stringify(value));
} finally {
  database.close();
}
