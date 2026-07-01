PRAGMA foreign_keys = ON;

ALTER TABLE user_alerts RENAME TO user_alerts_old;

CREATE TABLE user_alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  saved_search_id INTEGER REFERENCES saved_searches(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  filters_json TEXT NOT NULL,
  frequency TEXT NOT NULL DEFAULT 'daily' CHECK (frequency IN ('immediate', 'instant', 'hourly', 'daily', 'weekly')),
  email_enabled INTEGER NOT NULL DEFAULT 1,
  whatsapp_enabled INTEGER NOT NULL DEFAULT 0,
  telegram_enabled INTEGER NOT NULL DEFAULT 0,
  browser_push_enabled INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  last_sent_at TEXT,
  last_checked_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO user_alerts (
  id, user_id, saved_search_id, name, filters_json, frequency, email_enabled, whatsapp_enabled,
  telegram_enabled, browser_push_enabled, is_active, last_sent_at, last_checked_at, created_at, updated_at
)
SELECT
  id, user_id, saved_search_id, name, filters_json, frequency, email_enabled, whatsapp_enabled,
  telegram_enabled, browser_push_enabled, is_active, last_sent_at, last_checked_at, created_at, updated_at
FROM user_alerts_old;

CREATE TABLE alert_deliveries_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  alert_id INTEGER NOT NULL REFERENCES user_alerts(id) ON DELETE CASCADE,
  contract_id INTEGER NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  channel TEXT NOT NULL CHECK (channel IN ('email', 'whatsapp', 'telegram', 'browser_push')),
  status TEXT NOT NULL CHECK (status IN ('pending', 'sent', 'failed')),
  error_message TEXT,
  sent_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(alert_id, contract_id, channel)
);

INSERT INTO alert_deliveries_new (id, alert_id, contract_id, channel, status, error_message, sent_at, created_at)
SELECT id, alert_id, contract_id, channel, status, error_message, sent_at, created_at
FROM alert_deliveries;

DROP TABLE alert_deliveries;
DROP TABLE user_alerts_old;
ALTER TABLE alert_deliveries_new RENAME TO alert_deliveries;

CREATE INDEX IF NOT EXISTS idx_alerts_active ON user_alerts(is_active, frequency, last_sent_at);
