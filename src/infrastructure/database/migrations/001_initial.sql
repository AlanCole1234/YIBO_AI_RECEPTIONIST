PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS businesses (
  region_id TEXT NOT NULL CHECK (region_id IN ('MX', 'US')),
  tenant_id TEXT NOT NULL,
  business_id TEXT NOT NULL,
  profile_json TEXT NOT NULL,
  PRIMARY KEY (region_id, tenant_id),
  UNIQUE (region_id, business_id)
);

CREATE TABLE IF NOT EXISTS called_numbers (
  region_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  phone TEXT NOT NULL,
  PRIMARY KEY (region_id, phone),
  FOREIGN KEY (region_id, tenant_id)
    REFERENCES businesses(region_id, tenant_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS customers (
  region_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  phone TEXT NOT NULL,
  name TEXT,
  email TEXT,
  PRIMARY KEY (region_id, tenant_id, id),
  UNIQUE (region_id, tenant_id, phone),
  FOREIGN KEY (region_id, tenant_id)
    REFERENCES businesses(region_id, tenant_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS appointments (
  region_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  id TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  service_id TEXT NOT NULL,
  employee_id TEXT NOT NULL,
  start_at TEXT NOT NULL,
  end_at TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('PENDING_CONFIRMATION', 'CONFIRMED', 'CANCELLED', 'FAILED')),
  idempotency_key TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('AI_CALL', 'DASHBOARD', 'API')),
  source_call_id TEXT,
  external_calendar_event_id TEXT,
  PRIMARY KEY (region_id, tenant_id, id),
  UNIQUE (region_id, tenant_id, idempotency_key),
  FOREIGN KEY (region_id, tenant_id, customer_id)
    REFERENCES customers(region_id, tenant_id, id)
);

CREATE INDEX IF NOT EXISTS appointments_schedule_idx
  ON appointments(region_id, tenant_id, employee_id, start_at, end_at);

CREATE TABLE IF NOT EXISTS calendar_events (
  region_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  external_event_id TEXT NOT NULL,
  appointment_id TEXT NOT NULL,
  employee_id TEXT NOT NULL,
  title TEXT NOT NULL,
  start_at TEXT NOT NULL,
  end_at TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  cancelled INTEGER NOT NULL DEFAULT 0 CHECK (cancelled IN (0, 1)),
  PRIMARY KEY (region_id, tenant_id, external_event_id),
  UNIQUE (region_id, tenant_id, idempotency_key),
  FOREIGN KEY (region_id, tenant_id, appointment_id)
    REFERENCES appointments(region_id, tenant_id, id)
);

CREATE INDEX IF NOT EXISTS calendar_busy_idx
  ON calendar_events(region_id, tenant_id, employee_id, start_at, end_at, cancelled);
