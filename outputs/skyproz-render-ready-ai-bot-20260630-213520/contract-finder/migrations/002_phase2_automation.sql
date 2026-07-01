PRAGMA foreign_keys = ON;

ALTER TABLE contract_sources ADD COLUMN connector_key TEXT;
ALTER TABLE contract_sources ADD COLUMN region TEXT;
ALTER TABLE contract_sources ADD COLUMN schedule TEXT NOT NULL DEFAULT 'daily';
ALTER TABLE contract_sources ADD COLUMN last_status TEXT;
ALTER TABLE contract_sources ADD COLUMN last_error TEXT;
ALTER TABLE contract_sources ADD COLUMN last_tested_at TEXT;
ALTER TABLE contract_sources ADD COLUMN failure_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE contract_sources ADD COLUMN warning_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE contract_sources ADD COLUMN last_duration_ms INTEGER;
ALTER TABLE contract_sources ADD COLUMN metadata_json TEXT NOT NULL DEFAULT '{}';

ALTER TABLE contracts ADD COLUMN buyer_name TEXT;
ALTER TABLE contracts ADD COLUMN region TEXT;
ALTER TABLE contracts ADD COLUMN latitude REAL;
ALTER TABLE contracts ADD COLUMN longitude REAL;
ALTER TABLE contracts ADD COLUMN source_metadata_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE contracts ADD COLUMN import_run_id INTEGER REFERENCES import_runs(id) ON DELETE SET NULL;
ALTER TABLE contracts ADD COLUMN opportunity_score INTEGER NOT NULL DEFAULT 0;
ALTER TABLE contracts ADD COLUMN opportunity_label TEXT NOT NULL DEFAULT 'Low Match';
ALTER TABLE contracts ADD COLUMN ai_category TEXT;
ALTER TABLE contracts ADD COLUMN duplicate_key TEXT;

ALTER TABLE user_alerts ADD COLUMN telegram_enabled INTEGER NOT NULL DEFAULT 0;
ALTER TABLE user_alerts ADD COLUMN browser_push_enabled INTEGER NOT NULL DEFAULT 0;
ALTER TABLE user_alerts ADD COLUMN last_checked_at TEXT;

ALTER TABLE import_runs ADD COLUMN connector_key TEXT;
ALTER TABLE import_runs ADD COLUMN job_type TEXT NOT NULL DEFAULT 'manual';
ALTER TABLE import_runs ADD COLUMN duration_ms INTEGER;
ALTER TABLE import_runs ADD COLUMN warning_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE import_runs ADD COLUMN failure_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE import_runs ADD COLUMN warnings_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE import_runs ADD COLUMN metadata_json TEXT NOT NULL DEFAULT '{}';

CREATE TABLE IF NOT EXISTS import_queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id INTEGER REFERENCES contract_sources(id) ON DELETE CASCADE,
  connector_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'completed', 'failed', 'skipped')),
  priority INTEGER NOT NULL DEFAULT 5,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  run_after TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS connector_statistics (
  connector_key TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  is_available INTEGER NOT NULL DEFAULT 1,
  last_status TEXT,
  last_checked_at TEXT,
  last_imported_at TEXT,
  success_count INTEGER NOT NULL DEFAULT 0,
  failure_count INTEGER NOT NULL DEFAULT 0,
  total_imported INTEGER NOT NULL DEFAULT 0,
  total_updated INTEGER NOT NULL DEFAULT 0,
  total_skipped INTEGER NOT NULL DEFAULT 0,
  average_duration_ms INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  entity_type TEXT,
  entity_id TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  ip_address TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS scheduler_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_type TEXT NOT NULL CHECK (job_type IN ('hourly', 'daily', 'weekly', 'monthly', 'manual')),
  status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'failed')),
  duration_ms INTEGER,
  result_json TEXT NOT NULL DEFAULT '{}',
  error_message TEXT,
  started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TEXT
);

CREATE TABLE IF NOT EXISTS analytics_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  period TEXT NOT NULL,
  metrics_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_sources_connector_active ON contract_sources(connector_key, is_active, schedule);
CREATE INDEX IF NOT EXISTS idx_contracts_advanced_filters ON contracts(status, country, region, industry, buyer_name, contract_type, buyer_type, work_mode);
CREATE INDEX IF NOT EXISTS idx_contracts_score ON contracts(opportunity_score DESC);
CREATE INDEX IF NOT EXISTS idx_contracts_duplicate_key ON contracts(duplicate_key);
CREATE INDEX IF NOT EXISTS idx_import_runs_connector ON import_runs(connector_key, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_queue_status ON import_queue(status, run_after, priority);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON audit_logs(created_at DESC);
