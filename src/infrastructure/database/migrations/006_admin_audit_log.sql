CREATE TABLE IF NOT EXISTS admin_audit_log (
  id TEXT NOT NULL,
  region_id TEXT NOT NULL CHECK (region_id IN ('MX', 'US')),
  tenant_id TEXT NOT NULL,
  subject TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  action TEXT NOT NULL,
  entity_version TEXT,
  occurred_at TEXT NOT NULL,
  diff_json TEXT NOT NULL,
  PRIMARY KEY (region_id, id),
  FOREIGN KEY (region_id, tenant_id)
    REFERENCES businesses(region_id, tenant_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS admin_audit_log_tenant_time_idx
  ON admin_audit_log(region_id, tenant_id, occurred_at);
