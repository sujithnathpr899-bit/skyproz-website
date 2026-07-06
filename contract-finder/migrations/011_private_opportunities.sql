CREATE TABLE IF NOT EXISTS private_opportunity_sources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  source_type TEXT NOT NULL DEFAULT 'procurement_portal' CHECK (source_type IN ('procurement_portal', 'vendor_registration', 'rfq_page', 'rfp_page', 'tender_page', 'rss', 'json', 'xml', 'csv')),
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

CREATE TABLE IF NOT EXISTS private_opportunities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id INTEGER REFERENCES private_opportunity_sources(id) ON DELETE SET NULL,
  external_id TEXT,
  slug TEXT NOT NULL UNIQUE,
  company TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  building_type TEXT,
  required_services_json TEXT NOT NULL DEFAULT '[]',
  industry TEXT,
  country TEXT,
  state TEXT,
  city TEXT,
  budget_value REAL,
  currency TEXT,
  deadline TEXT,
  posted_date TEXT,
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'reviewing', 'qualified', 'contacted', 'submitted', 'won', 'lost', 'closed')),
  source_name TEXT NOT NULL,
  source_url TEXT NOT NULL,
  vendor_registration_url TEXT,
  original_source_url TEXT NOT NULL,
  ai_summary TEXT,
  match_score INTEGER NOT NULL DEFAULT 0,
  required_certifications_json TEXT NOT NULL DEFAULT '[]',
  required_documents_json TEXT NOT NULL DEFAULT '[]',
  submission_checklist_json TEXT NOT NULL DEFAULT '[]',
  internal_notes TEXT,
  win_probability TEXT,
  recommended_services_json TEXT NOT NULL DEFAULT '[]',
  priority TEXT NOT NULL DEFAULT 'Medium',
  tags_json TEXT NOT NULL DEFAULT '[]',
  metadata_json TEXT NOT NULL DEFAULT '{}',
  duplicate_key TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(source_id, external_id)
);

CREATE TABLE IF NOT EXISTS private_opportunity_source_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id INTEGER REFERENCES private_opportunity_sources(id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  level TEXT NOT NULL DEFAULT 'info',
  message TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_private_opportunities_filters ON private_opportunities(status, country, industry, deadline, match_score);
CREATE INDEX IF NOT EXISTS idx_private_opportunities_source ON private_opportunities(source_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_private_opportunities_duplicate ON private_opportunities(duplicate_key);
CREATE INDEX IF NOT EXISTS idx_private_sources_active ON private_opportunity_sources(is_active, scheduler_status, last_test_status);
