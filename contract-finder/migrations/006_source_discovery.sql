PRAGMA foreign_keys = ON;

ALTER TABLE contract_sources ADD COLUMN discovery_metadata_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE contract_sources ADD COLUMN field_mapping_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE contract_sources ADD COLUMN health_score INTEGER NOT NULL DEFAULT 0;
ALTER TABLE contract_sources ADD COLUMN quality_score INTEGER NOT NULL DEFAULT 0;
ALTER TABLE contract_sources ADD COLUMN availability_status TEXT NOT NULL DEFAULT 'unknown';
ALTER TABLE contract_sources ADD COLUMN duplicates_removed INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS source_discovery_results (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  template_id TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  group_name TEXT,
  source_id INTEGER REFERENCES contract_sources(id) ON DELETE CASCADE,
  source_url TEXT,
  api_documentation_url TEXT,
  country TEXT,
  industry TEXT,
  status TEXT NOT NULL DEFAULT 'requires_configuration',
  endpoint_availability_json TEXT NOT NULL DEFAULT '{}',
  authentication_required INTEGER NOT NULL DEFAULT 0,
  required_api_keys_json TEXT NOT NULL DEFAULT '[]',
  rate_limit TEXT,
  pagination_json TEXT NOT NULL DEFAULT '{}',
  field_mapping_json TEXT NOT NULL DEFAULT '{}',
  health_score INTEGER NOT NULL DEFAULT 0,
  quality_score INTEGER NOT NULL DEFAULT 0,
  ai_confidence INTEGER NOT NULL DEFAULT 0,
  last_verified_at TEXT,
  verification_error TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS duplicate_merge_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  status TEXT NOT NULL CHECK (status IN ('completed', 'failed')),
  duplicates_found INTEGER NOT NULL DEFAULT 0,
  duplicates_removed INTEGER NOT NULL DEFAULT 0,
  strategy_json TEXT NOT NULL DEFAULT '{}',
  error_message TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_discovery_status ON source_discovery_results(status, group_name);
CREATE INDEX IF NOT EXISTS idx_discovery_source ON source_discovery_results(source_id);
CREATE INDEX IF NOT EXISTS idx_sources_health ON contract_sources(is_active, health_score, quality_score);
