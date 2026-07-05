CREATE TABLE IF NOT EXISTS workers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  full_name TEXT NOT NULL,
  mobile_number TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  country TEXT NOT NULL,
  nationality TEXT NOT NULL,
  current_location TEXT NOT NULL,
  date_of_birth TEXT NOT NULL,
  passport_number TEXT,
  trade_profession TEXT NOT NULL,
  years_experience INTEGER NOT NULL DEFAULT 0,
  highest_qualification TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  skills_json TEXT NOT NULL DEFAULT '[]',
  availability TEXT NOT NULL DEFAULT 'available',
  preferred_countries_json TEXT NOT NULL DEFAULT '[]',
  preferred_salary TEXT,
  profile_completion INTEGER NOT NULL DEFAULT 0,
  profile_verified INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active',
  last_login_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS worker_documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  worker_id INTEGER NOT NULL REFERENCES workers(id) ON DELETE CASCADE,
  document_type TEXT NOT NULL,
  original_filename TEXT NOT NULL,
  stored_filename TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  reviewer_note TEXT,
  uploaded_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reviewed_at TEXT
);

CREATE TABLE IF NOT EXISTS worker_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  company TEXT NOT NULL,
  country TEXT NOT NULL,
  industry TEXT NOT NULL,
  trade TEXT NOT NULL,
  job_type TEXT NOT NULL,
  salary_min INTEGER,
  salary_max INTEGER,
  currency TEXT NOT NULL DEFAULT 'USD',
  experience_required INTEGER NOT NULL DEFAULT 0,
  description TEXT NOT NULL,
  requirements_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'open',
  source_url TEXT,
  posted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deadline TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS worker_saved_jobs (
  worker_id INTEGER NOT NULL REFERENCES workers(id) ON DELETE CASCADE,
  job_id INTEGER NOT NULL REFERENCES worker_jobs(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(worker_id, job_id)
);

CREATE TABLE IF NOT EXISTS worker_applications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  worker_id INTEGER NOT NULL REFERENCES workers(id) ON DELETE CASCADE,
  job_id INTEGER NOT NULL REFERENCES worker_jobs(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'submitted',
  cover_note TEXT,
  applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(worker_id, job_id)
);

CREATE TABLE IF NOT EXISTS worker_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  worker_id INTEGER NOT NULL REFERENCES workers(id) ON DELETE CASCADE,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  is_read INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS worker_notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  worker_id INTEGER NOT NULL REFERENCES workers(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  is_read INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_workers_status_trade ON workers(status, trade_profession, country);
CREATE INDEX IF NOT EXISTS idx_worker_jobs_search ON worker_jobs(status, country, industry, trade, company, job_type);
CREATE INDEX IF NOT EXISTS idx_worker_applications_worker ON worker_applications(worker_id, status);
CREATE INDEX IF NOT EXISTS idx_worker_documents_worker ON worker_documents(worker_id, status);
