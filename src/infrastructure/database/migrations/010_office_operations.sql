ALTER TABLE customers ADD COLUMN preferred_language TEXT;
ALTER TABLE customers ADD COLUMN email_verified_at TEXT;
ALTER TABLE customers ADD COLUMN email_opt_in INTEGER NOT NULL DEFAULT 1 CHECK (email_opt_in IN (0, 1));
ALTER TABLE customers ADD COLUMN source TEXT NOT NULL DEFAULT 'UNKNOWN';
ALTER TABLE customers ADD COLUMN created_at TEXT NOT NULL DEFAULT '';
ALTER TABLE customers ADD COLUMN updated_at TEXT NOT NULL DEFAULT '';

ALTER TABLE appointments ADD COLUMN outcome_status TEXT CHECK (outcome_status IN ('COMPLETED', 'NO_SHOW'));

CREATE TABLE IF NOT EXISTS appointment_events (
  region_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  appointment_id TEXT NOT NULL,
  id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  actor_type TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  PRIMARY KEY (region_id, tenant_id, id),
  FOREIGN KEY (region_id, tenant_id, appointment_id)
    REFERENCES appointments(region_id, tenant_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS appointment_events_timeline_idx
  ON appointment_events(region_id, tenant_id, appointment_id, occurred_at);

CREATE TABLE IF NOT EXISTS notification_deliveries (
  region_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  appointment_id TEXT NOT NULL,
  id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('CONFIRMATION', 'RESCHEDULE', 'CANCELLATION', 'REMINDER')),
  channel TEXT NOT NULL CHECK (channel IN ('EMAIL')),
  destination_masked TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('PENDING', 'SENT', 'FAILED', 'SKIPPED')),
  provider_message_id TEXT,
  error_code TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (region_id, tenant_id, id),
  FOREIGN KEY (region_id, tenant_id, appointment_id)
    REFERENCES appointments(region_id, tenant_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS notification_deliveries_timeline_idx
  ON notification_deliveries(region_id, tenant_id, appointment_id, created_at);
