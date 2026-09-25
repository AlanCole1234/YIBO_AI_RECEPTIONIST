CREATE TABLE IF NOT EXISTS admin_users (
  region_id TEXT NOT NULL CHECK (region_id IN ('MX', 'US')),
  tenant_id TEXT NOT NULL,
  subject TEXT NOT NULL,
  email_normalized TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  roles_json TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (region_id, tenant_id, subject),
  UNIQUE (region_id, tenant_id, email_normalized),
  FOREIGN KEY (region_id, tenant_id)
    REFERENCES businesses(region_id, tenant_id) ON DELETE CASCADE
);
