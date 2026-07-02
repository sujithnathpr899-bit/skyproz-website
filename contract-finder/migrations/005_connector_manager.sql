PRAGMA foreign_keys = ON;

ALTER TABLE contract_sources ADD COLUMN source_format TEXT NOT NULL DEFAULT 'json';
ALTER TABLE contract_sources ADD COLUMN base_url TEXT;
ALTER TABLE contract_sources ADD COLUMN api_key_env TEXT;
ALTER TABLE contract_sources ADD COLUMN headers_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE contract_sources ADD COLUMN auth_config_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE contract_sources ADD COLUMN pagination_config_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE contract_sources ADD COLUMN rate_limit_ms INTEGER NOT NULL DEFAULT 0;
ALTER TABLE contract_sources ADD COLUMN sample_contracts_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE contract_sources ADD COLUMN last_run_at TEXT;
ALTER TABLE contract_sources ADD COLUMN last_success_at TEXT;
ALTER TABLE contract_sources ADD COLUMN contracts_imported INTEGER NOT NULL DEFAULT 0;
ALTER TABLE contract_sources ADD COLUMN scheduler_status TEXT NOT NULL DEFAULT 'scheduled';

CREATE TABLE IF NOT EXISTS connector_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id INTEGER REFERENCES contract_sources(id) ON DELETE CASCADE,
  connector_key TEXT NOT NULL,
  level TEXT NOT NULL DEFAULT 'info' CHECK (level IN ('info', 'warning', 'error')),
  action TEXT NOT NULL,
  message TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  duration_ms INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_connector_logs_source_created ON connector_logs(source_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_connector_logs_connector_created ON connector_logs(connector_key, created_at DESC);
