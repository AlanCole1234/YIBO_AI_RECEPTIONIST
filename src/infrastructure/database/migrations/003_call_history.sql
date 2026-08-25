CREATE TABLE IF NOT EXISTS calls (
  region_id TEXT NOT NULL CHECK (region_id IN ('MX', 'US')),
  tenant_id TEXT NOT NULL,
  call_id TEXT NOT NULL,
  customer_id TEXT,
  caller_number TEXT NOT NULL,
  called_number TEXT NOT NULL,
  state TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (region_id, tenant_id, call_id),
  FOREIGN KEY (region_id, tenant_id) REFERENCES businesses(region_id, tenant_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS calls_tenant_created_idx ON calls(region_id, tenant_id, created_at DESC);

CREATE TABLE IF NOT EXISTS call_state_transitions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  region_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  call_id TEXT NOT NULL,
  state TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  FOREIGN KEY (region_id, tenant_id, call_id)
    REFERENCES calls(region_id, tenant_id, call_id) ON DELETE CASCADE
);
