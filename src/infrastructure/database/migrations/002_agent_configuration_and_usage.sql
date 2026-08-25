CREATE TABLE IF NOT EXISTS agent_configurations (
  region_id TEXT NOT NULL CHECK (region_id IN ('MX', 'US')),
  tenant_id TEXT NOT NULL,
  configuration_json TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (region_id, tenant_id),
  FOREIGN KEY (region_id, tenant_id)
    REFERENCES businesses(region_id, tenant_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS conversation_usage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  region_id TEXT NOT NULL CHECK (region_id IN ('MX', 'US')),
  tenant_id TEXT NOT NULL,
  call_id TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  input_audio_ms INTEGER NOT NULL DEFAULT 0,
  output_audio_ms INTEGER NOT NULL DEFAULT 0,
  tool_calls INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (region_id, tenant_id)
    REFERENCES businesses(region_id, tenant_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS conversation_usage_tenant_idx
  ON conversation_usage(region_id, tenant_id, occurred_at);
