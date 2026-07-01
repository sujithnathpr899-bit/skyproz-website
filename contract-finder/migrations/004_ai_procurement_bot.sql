PRAGMA foreign_keys = ON;

ALTER TABLE contracts ADD COLUMN language TEXT NOT NULL DEFAULT 'en';
ALTER TABLE contracts ADD COLUMN translated_description TEXT;
ALTER TABLE contracts ADD COLUMN matched_keywords_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE contracts ADD COLUMN matching_services_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE contracts ADD COLUMN suggested_business_unit TEXT;
ALTER TABLE contracts ADD COLUMN estimated_opportunity_value TEXT;
ALTER TABLE contracts ADD COLUMN submission_urgency TEXT;
ALTER TABLE contracts ADD COLUMN country_risk TEXT;
ALTER TABLE contracts ADD COLUMN recommended_action TEXT;
ALTER TABLE contracts ADD COLUMN ai_score INTEGER NOT NULL DEFAULT 0;
ALTER TABLE contracts ADD COLUMN ai_priority TEXT NOT NULL DEFAULT 'Low';
ALTER TABLE contracts ADD COLUMN imported_at TEXT;
ALTER TABLE contracts ADD COLUMN last_seen_at TEXT;

UPDATE contracts SET imported_at = COALESCE(imported_at, created_at), last_seen_at = COALESCE(last_seen_at, updated_at, created_at);

CREATE TABLE IF NOT EXISTS procurement_keywords (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  keyword TEXT NOT NULL UNIQUE,
  service_category TEXT NOT NULL,
  business_unit TEXT NOT NULL DEFAULT 'Industrial Services',
  weight INTEGER NOT NULL DEFAULT 8,
  countries_json TEXT NOT NULL DEFAULT '[]',
  is_active INTEGER NOT NULL DEFAULT 1,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS bot_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_type TEXT NOT NULL DEFAULT 'hourly',
  status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'failed')),
  started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TEXT,
  duration_ms INTEGER,
  sources_checked INTEGER NOT NULL DEFAULT 0,
  contracts_imported INTEGER NOT NULL DEFAULT 0,
  contracts_updated INTEGER NOT NULL DEFAULT 0,
  high_value_matches INTEGER NOT NULL DEFAULT 0,
  notifications_created INTEGER NOT NULL DEFAULT 0,
  result_json TEXT NOT NULL DEFAULT '{}',
  error_message TEXT
);

CREATE TABLE IF NOT EXISTS bot_notification_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  min_score INTEGER NOT NULL DEFAULT 75,
  min_budget REAL,
  countries_json TEXT NOT NULL DEFAULT '[]',
  email_enabled INTEGER NOT NULL DEFAULT 0,
  whatsapp_enabled INTEGER NOT NULL DEFAULT 0,
  telegram_enabled INTEGER NOT NULL DEFAULT 0,
  dashboard_enabled INTEGER NOT NULL DEFAULT 1,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS dashboard_notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  contract_id INTEGER REFERENCES contracts(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'info' CHECK (severity IN ('info', 'warning', 'critical')),
  metadata_json TEXT NOT NULL DEFAULT '{}',
  is_read INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS bot_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bot_run_id INTEGER REFERENCES bot_runs(id) ON DELETE CASCADE,
  source_id INTEGER REFERENCES contract_sources(id) ON DELETE SET NULL,
  level TEXT NOT NULL CHECK (level IN ('info', 'warning', 'error')),
  message TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO bot_notification_rules(name, min_score, dashboard_enabled)
VALUES ('High relevance Skyproz opportunity', 75, 1);

INSERT OR IGNORE INTO procurement_keywords(keyword, service_category, business_unit, weight) VALUES
('rope access','Rope Access','Rope Access Services',14),
('irata','Rope Access','Rope Access Services',14),
('industrial rope access','Rope Access','Rope Access Services',16),
('work at height','Rope Access','Rope Access Services',12),
('height access','Rope Access','Rope Access Services',11),
('abseiling','Rope Access','Rope Access Services',10),
('high rise maintenance','High Rise Maintenance','Building Maintenance',12),
('facade cleaning','Facade Cleaning','Building Maintenance',12),
('facade maintenance','Facade Maintenance','Building Maintenance',12),
('glass cleaning','Glass Cleaning','Building Maintenance',10),
('window cleaning','Glass Cleaning','Building Maintenance',9),
('curtain wall cleaning','Glass Cleaning','Building Maintenance',9),
('industrial painting','Industrial Painting','Industrial Services',14),
('protective coating','Protective Coating','Industrial Services',13),
('anti corrosion','Protective Coating','Industrial Services',11),
('surface preparation','Protective Coating','Industrial Services',10),
('steel structure painting','Industrial Painting','Industrial Services',13),
('abrasive blasting','Abrasive Blasting','Industrial Services',13),
('sand blasting','Abrasive Blasting','Industrial Services',11),
('grit blasting','Abrasive Blasting','Industrial Services',11),
('hydro blasting','Hydro Blasting','Industrial Cleaning',12),
('pressure washing','Pressure Washing','Industrial Cleaning',10),
('industrial cleaning','Industrial Cleaning','Industrial Cleaning',11),
('tank cleaning','Tank Cleaning','Industrial Cleaning',13),
('tank maintenance','Tank Maintenance','Industrial Services',13),
('silo cleaning','Industrial Cleaning','Industrial Cleaning',9),
('confined space','Confined Space','Industrial Services',11),
('shutdown maintenance','Shutdown Maintenance','Industrial Services',14),
('turnaround maintenance','Shutdown Maintenance','Industrial Services',13),
('plant shutdown','Shutdown Maintenance','Industrial Services',12),
('mechanical maintenance','Mechanical Maintenance','Technical Maintenance',10),
('building maintenance','Building Maintenance','Building Maintenance',9),
('facility maintenance','Facility Management','Building Maintenance',9),
('facilities management','Facility Management','Building Maintenance',8),
('structural repair','Structural Repair','Industrial Services',12),
('waterproofing','Waterproofing','Building Maintenance',8),
('wind turbine maintenance','Wind Turbine Support','Renewable Energy',14),
('blade inspection','Wind Turbine Support','Renewable Energy',13),
('wind turbine blade','Wind Turbine Support','Renewable Energy',13),
('wind farm maintenance','Wind Turbine Support','Renewable Energy',12),
('marine maintenance','Marine Maintenance','Marine Services',13),
('offshore maintenance','Offshore Maintenance','Marine Services',13),
('ship repair','Ship Repair','Marine Services',12),
('vessel maintenance','Marine Maintenance','Marine Services',11),
('shipyard maintenance','Marine Maintenance','Marine Services',11),
('ndt inspection','NDT Inspection','Technical Inspection',13),
('non destructive testing','NDT Inspection','Technical Inspection',13),
('ultrasonic testing','NDT Inspection','Technical Inspection',10),
('magnetic particle testing','NDT Inspection','Technical Inspection',10),
('dye penetrant testing','NDT Inspection','Technical Inspection',10),
('electrical maintenance','Electrical Maintenance','Technical Maintenance',9),
('solar panel cleaning','Solar Maintenance','Renewable Energy',8),
('solar maintenance','Solar Maintenance','Renewable Energy',8),
('industrial service','Industrial Services','Industrial Services',6),
('maintenance contract','Maintenance Contracts','Industrial Services',8),
('rfq','Procurement Notice','Procurement',4),
('rfp','Procurement Notice','Procurement',4),
('eoi','Procurement Notice','Procurement',4),
('tender','Procurement Notice','Procurement',3),
('subcontract','Subcontracting','Industrial Services',8),
('epc contractor','EPC Opportunities','Industrial Services',7),
('oil and gas maintenance','Oil and Gas','Industrial Services',12),
('refinery maintenance','Oil and Gas','Industrial Services',12),
('petrochemical maintenance','Oil and Gas','Industrial Services',12),
('mining maintenance','Mining','Industrial Services',9),
('power plant maintenance','Power Plant','Technical Maintenance',11);

CREATE INDEX IF NOT EXISTS idx_keywords_active ON procurement_keywords(is_active, service_category);
CREATE INDEX IF NOT EXISTS idx_contracts_ai_score ON contracts(ai_score DESC, ai_priority);
CREATE INDEX IF NOT EXISTS idx_contracts_language ON contracts(language);
CREATE INDEX IF NOT EXISTS idx_bot_runs_started ON bot_runs(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_dashboard_notifications_user ON dashboard_notifications(user_id, is_read, created_at DESC);
