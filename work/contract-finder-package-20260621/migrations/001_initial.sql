PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  display_name TEXT NOT NULL,
  phone TEXT,
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
  plan TEXT NOT NULL DEFAULT 'free' CHECK (plan IN ('free', 'premium')),
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS contract_sources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  source_url TEXT NOT NULL,
  api_url TEXT,
  country TEXT,
  source_type TEXT NOT NULL DEFAULT 'government' CHECK (source_type IN ('government', 'private')),
  parser_type TEXT NOT NULL DEFAULT 'json' CHECK (parser_type IN ('json', 'manual')),
  parser_config_json TEXT NOT NULL DEFAULT '{}',
  is_active INTEGER NOT NULL DEFAULT 1,
  last_imported_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS contract_categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  slug TEXT NOT NULL UNIQUE,
  description TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS contracts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id INTEGER REFERENCES contract_sources(id) ON DELETE SET NULL,
  external_id TEXT,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  source_name TEXT NOT NULL,
  source_url TEXT NOT NULL,
  country TEXT NOT NULL,
  industry TEXT NOT NULL,
  contract_type TEXT NOT NULL,
  buyer_type TEXT NOT NULL DEFAULT 'government' CHECK (buyer_type IN ('government', 'private')),
  work_mode TEXT NOT NULL DEFAULT 'onsite' CHECK (work_mode IN ('remote', 'onsite', 'hybrid')),
  budget_value REAL,
  currency TEXT,
  deadline TEXT,
  posted_date TEXT NOT NULL,
  tags_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('draft', 'open', 'closing_soon', 'expired', 'awarded', 'cancelled')),
  verified INTEGER NOT NULL DEFAULT 0,
  ai_summary TEXT,
  ai_requirements_json TEXT,
  ai_checklist_json TEXT,
  ai_proposal_outline TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(source_id, external_id)
);

CREATE TABLE IF NOT EXISTS contract_category_links (
  contract_id INTEGER NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  category_id INTEGER NOT NULL REFERENCES contract_categories(id) ON DELETE CASCADE,
  PRIMARY KEY (contract_id, category_id)
);

CREATE TABLE IF NOT EXISTS saved_searches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  filters_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS user_alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  saved_search_id INTEGER REFERENCES saved_searches(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  filters_json TEXT NOT NULL,
  frequency TEXT NOT NULL DEFAULT 'daily' CHECK (frequency IN ('instant', 'daily', 'weekly')),
  email_enabled INTEGER NOT NULL DEFAULT 1,
  whatsapp_enabled INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  last_sent_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS user_favorites (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  contract_id INTEGER NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  notes TEXT,
  deadline_reminder_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, contract_id)
);

CREATE TABLE IF NOT EXISTS watchlists (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS watchlist_contracts (
  watchlist_id INTEGER NOT NULL REFERENCES watchlists(id) ON DELETE CASCADE,
  contract_id INTEGER NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (watchlist_id, contract_id)
);

CREATE TABLE IF NOT EXISTS alert_deliveries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  alert_id INTEGER NOT NULL REFERENCES user_alerts(id) ON DELETE CASCADE,
  contract_id INTEGER NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  channel TEXT NOT NULL CHECK (channel IN ('email', 'whatsapp')),
  status TEXT NOT NULL CHECK (status IN ('pending', 'sent', 'failed')),
  error_message TEXT,
  sent_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(alert_id, contract_id, channel)
);

CREATE TABLE IF NOT EXISTS import_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id INTEGER REFERENCES contract_sources(id) ON DELETE SET NULL,
  status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'failed')),
  imported_count INTEGER NOT NULL DEFAULT 0,
  updated_count INTEGER NOT NULL DEFAULT 0,
  skipped_count INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_contracts_search_filters ON contracts(status, country, industry, buyer_type, work_mode);
CREATE INDEX IF NOT EXISTS idx_contracts_deadline ON contracts(deadline);
CREATE INDEX IF NOT EXISTS idx_contracts_posted_date ON contracts(posted_date DESC);
CREATE INDEX IF NOT EXISTS idx_contracts_budget ON contracts(budget_value);
CREATE INDEX IF NOT EXISTS idx_alerts_active ON user_alerts(is_active, frequency, last_sent_at);
CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_favorites_user ON user_favorites(user_id, created_at DESC);

CREATE VIRTUAL TABLE IF NOT EXISTS contracts_fts USING fts5(
  title,
  description,
  industry,
  tags,
  content='contracts',
  content_rowid='id'
);

CREATE TRIGGER IF NOT EXISTS contracts_ai AFTER INSERT ON contracts BEGIN
  INSERT INTO contracts_fts(rowid, title, description, industry, tags)
  VALUES (new.id, new.title, new.description, new.industry, new.tags_json);
END;

CREATE TRIGGER IF NOT EXISTS contracts_ad AFTER DELETE ON contracts BEGIN
  INSERT INTO contracts_fts(contracts_fts, rowid, title, description, industry, tags)
  VALUES ('delete', old.id, old.title, old.description, old.industry, old.tags_json);
END;

CREATE TRIGGER IF NOT EXISTS contracts_au AFTER UPDATE ON contracts BEGIN
  INSERT INTO contracts_fts(contracts_fts, rowid, title, description, industry, tags)
  VALUES ('delete', old.id, old.title, old.description, old.industry, old.tags_json);
  INSERT INTO contracts_fts(rowid, title, description, industry, tags)
  VALUES (new.id, new.title, new.description, new.industry, new.tags_json);
END;
