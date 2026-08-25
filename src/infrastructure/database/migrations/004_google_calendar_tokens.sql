CREATE TABLE IF NOT EXISTS google_calendar_tokens (
  region_id TEXT NOT NULL CHECK (region_id IN ('MX', 'US')),
  tenant_id TEXT NOT NULL,
  encrypted_token TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (region_id, tenant_id),
  FOREIGN KEY (region_id, tenant_id)
    REFERENCES businesses(region_id, tenant_id) ON DELETE CASCADE
);
