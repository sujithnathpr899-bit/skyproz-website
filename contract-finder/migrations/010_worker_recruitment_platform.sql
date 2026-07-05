PRAGMA foreign_keys = ON;

ALTER TABLE workers ADD COLUMN public_slug TEXT;
ALTER TABLE workers ADD COLUMN public_profile_enabled INTEGER NOT NULL DEFAULT 1;
ALTER TABLE workers ADD COLUMN profile_views INTEGER NOT NULL DEFAULT 0;
ALTER TABLE workers ADD COLUMN employer_searches INTEGER NOT NULL DEFAULT 0;
ALTER TABLE workers ADD COLUMN subscription_plan TEXT NOT NULL DEFAULT 'FREE';
ALTER TABLE workers ADD COLUMN subscription_renewal TEXT;
ALTER TABLE workers ADD COLUMN resume_template TEXT NOT NULL DEFAULT 'executive';
ALTER TABLE workers ADD COLUMN ai_resume_score INTEGER NOT NULL DEFAULT 0;

ALTER TABLE worker_experience ADD COLUMN current_employer INTEGER NOT NULL DEFAULT 0;

CREATE UNIQUE INDEX IF NOT EXISTS idx_workers_public_slug ON workers(public_slug);
CREATE INDEX IF NOT EXISTS idx_workers_public_enabled ON workers(public_profile_enabled, status);

CREATE TABLE IF NOT EXISTS worker_skill_levels (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  worker_id INTEGER NOT NULL REFERENCES workers(id) ON DELETE CASCADE,
  skill_name TEXT NOT NULL,
  skill_level TEXT NOT NULL DEFAULT 'Intermediate',
  years_experience INTEGER NOT NULL DEFAULT 0,
  verified INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(worker_id, skill_name)
);

CREATE TABLE IF NOT EXISTS worker_certifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  worker_id INTEGER NOT NULL REFERENCES workers(id) ON DELETE CASCADE,
  certificate_name TEXT NOT NULL,
  certificate_number TEXT,
  issuing_authority TEXT,
  issue_date TEXT,
  expiry_date TEXT,
  verification_status TEXT NOT NULL DEFAULT 'pending',
  document_id INTEGER REFERENCES worker_documents(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS worker_job_alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  worker_id INTEGER NOT NULL REFERENCES workers(id) ON DELETE CASCADE,
  country TEXT,
  trade TEXT,
  industry TEXT,
  salary TEXT,
  rotation TEXT,
  offshore INTEGER NOT NULL DEFAULT 0,
  email_enabled INTEGER NOT NULL DEFAULT 1,
  dashboard_enabled INTEGER NOT NULL DEFAULT 1,
  whatsapp_future INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS worker_interviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  worker_id INTEGER NOT NULL REFERENCES workers(id) ON DELETE CASCADE,
  application_id INTEGER REFERENCES worker_applications(id) ON DELETE SET NULL,
  employer_name TEXT NOT NULL,
  interview_title TEXT NOT NULL,
  scheduled_at TEXT NOT NULL,
  meeting_url TEXT,
  status TEXT NOT NULL DEFAULT 'scheduled',
  employer_note TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS worker_billing_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  worker_id INTEGER NOT NULL REFERENCES workers(id) ON DELETE CASCADE,
  plan_name TEXT NOT NULL,
  amount TEXT,
  currency TEXT NOT NULL DEFAULT 'USD',
  billing_status TEXT NOT NULL DEFAULT 'recorded',
  billing_date TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS worker_profile_views (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  worker_id INTEGER NOT NULL REFERENCES workers(id) ON DELETE CASCADE,
  viewed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  viewer_type TEXT NOT NULL DEFAULT 'public',
  source TEXT
);

CREATE TABLE IF NOT EXISTS worker_activity (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  worker_id INTEGER NOT NULL REFERENCES workers(id) ON DELETE CASCADE,
  activity_type TEXT NOT NULL,
  title TEXT NOT NULL,
  message TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_worker_skill_levels_worker ON worker_skill_levels(worker_id, skill_name);
CREATE INDEX IF NOT EXISTS idx_worker_certifications_worker ON worker_certifications(worker_id, verification_status);
CREATE INDEX IF NOT EXISTS idx_worker_job_alerts_worker ON worker_job_alerts(worker_id, is_active);
CREATE INDEX IF NOT EXISTS idx_worker_interviews_worker ON worker_interviews(worker_id, scheduled_at DESC);
CREATE INDEX IF NOT EXISTS idx_worker_profile_views_worker ON worker_profile_views(worker_id, viewed_at DESC);
CREATE INDEX IF NOT EXISTS idx_worker_activity_worker ON worker_activity(worker_id, created_at DESC);