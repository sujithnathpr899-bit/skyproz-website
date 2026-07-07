PRAGMA foreign_keys = OFF;

CREATE TABLE IF NOT EXISTS private_opportunity_sources_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  source_type TEXT NOT NULL DEFAULT 'procurement_portal' CHECK (source_type IN ('procurement_portal', 'vendor_registration', 'rfq_page', 'rfp_page', 'tender_page', 'company_website', 'public_notice', 'rss', 'json', 'xml', 'csv')),
  source_url TEXT NOT NULL,
  endpoint_url TEXT,
  country TEXT,
  state TEXT,
  city TEXT,
  industry TEXT,
  authentication_type TEXT NOT NULL DEFAULT 'none',
  api_key_env TEXT,
  headers_json TEXT NOT NULL DEFAULT '{}',
  parser_config_json TEXT NOT NULL DEFAULT '{}',
  schedule TEXT NOT NULL DEFAULT 'hourly' CHECK (schedule IN ('hourly', 'daily', 'weekly', 'monthly')),
  rate_limit_ms INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 0,
  scheduler_status TEXT NOT NULL DEFAULT 'disabled',
  last_test_status TEXT NOT NULL DEFAULT 'not_tested',
  last_http_status INTEGER,
  last_response_time_ms INTEGER,
  last_run_at TEXT,
  last_success_at TEXT,
  last_failure_reason TEXT,
  opportunities_imported INTEGER NOT NULL DEFAULT 0,
  failures INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO private_opportunity_sources_new (
  id, name, source_type, source_url, endpoint_url, country, state, city, industry,
  authentication_type, api_key_env, headers_json, parser_config_json, schedule,
  rate_limit_ms, is_active, scheduler_status, last_test_status, last_http_status,
  last_response_time_ms, last_run_at, last_success_at, last_failure_reason,
  opportunities_imported, failures, created_at, updated_at
)
SELECT
  id, name, source_type, source_url, endpoint_url, country, state, city, industry,
  authentication_type, api_key_env, headers_json, parser_config_json, schedule,
  rate_limit_ms, is_active, scheduler_status, last_test_status, last_http_status,
  last_response_time_ms, last_run_at, last_success_at, last_failure_reason,
  opportunities_imported, failures, created_at, updated_at
FROM private_opportunity_sources;

DROP TABLE private_opportunity_sources;
ALTER TABLE private_opportunity_sources_new RENAME TO private_opportunity_sources;

PRAGMA foreign_keys = ON;

ALTER TABLE private_opportunities ADD COLUMN lead_type TEXT NOT NULL DEFAULT 'business_intelligence';
ALTER TABLE private_opportunities ADD COLUMN company_profile_url TEXT;
ALTER TABLE private_opportunities ADD COLUMN public_contact_email TEXT;
ALTER TABLE private_opportunities ADD COLUMN public_contact_phone TEXT;
ALTER TABLE private_opportunities ADD COLUMN procurement_portal_url TEXT;
ALTER TABLE private_opportunities ADD COLUMN map_latitude REAL;
ALTER TABLE private_opportunities ADD COLUMN map_longitude REAL;
ALTER TABLE private_opportunities ADD COLUMN crm_status TEXT NOT NULL DEFAULT 'not_converted';
ALTER TABLE private_opportunities ADD COLUMN crm_record_id INTEGER;
ALTER TABLE private_opportunities ADD COLUMN watchlist INTEGER NOT NULL DEFAULT 0;
ALTER TABLE private_opportunities ADD COLUMN alert_enabled INTEGER NOT NULL DEFAULT 0;
ALTER TABLE private_opportunities ADD COLUMN source_compliance TEXT NOT NULL DEFAULT 'public_or_official';
ALTER TABLE private_opportunities ADD COLUMN lead_score_reason TEXT;

CREATE TABLE IF NOT EXISTS business_lead_saved_searches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  filters_json TEXT NOT NULL DEFAULT '{}',
  alert_enabled INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_private_opportunities_filters ON private_opportunities(status, country, industry, deadline, match_score);
CREATE INDEX IF NOT EXISTS idx_private_opportunities_source ON private_opportunities(source_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_private_opportunities_duplicate ON private_opportunities(duplicate_key);
CREATE INDEX IF NOT EXISTS idx_private_opportunities_india_bi ON private_opportunities(country, state, city, lead_type, watchlist, crm_status, match_score);
CREATE INDEX IF NOT EXISTS idx_private_sources_active ON private_opportunity_sources(is_active, scheduler_status, last_test_status);
CREATE INDEX IF NOT EXISTS idx_business_lead_saved_searches_user ON business_lead_saved_searches(user_id, updated_at DESC);
