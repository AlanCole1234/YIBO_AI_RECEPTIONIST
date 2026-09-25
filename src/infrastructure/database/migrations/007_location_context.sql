ALTER TABLE called_numbers
  ADD COLUMN location_id TEXT NOT NULL DEFAULT 'default';

ALTER TABLE calls
  ADD COLUMN location_id TEXT NOT NULL DEFAULT 'default';

ALTER TABLE appointments
  ADD COLUMN location_id TEXT NOT NULL DEFAULT 'default';

CREATE INDEX IF NOT EXISTS called_numbers_location_idx
  ON called_numbers(region_id, tenant_id, location_id);

CREATE INDEX IF NOT EXISTS calls_location_created_idx
  ON calls(region_id, tenant_id, location_id, created_at DESC);

CREATE INDEX IF NOT EXISTS appointments_location_schedule_idx
  ON appointments(region_id, tenant_id, location_id, employee_id, start_at, end_at);
