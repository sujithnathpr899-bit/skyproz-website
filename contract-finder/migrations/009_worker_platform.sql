PRAGMA foreign_keys = ON;

ALTER TABLE workers ADD COLUMN profile_photo_url TEXT;
ALTER TABLE workers ADD COLUMN professional_title TEXT;
ALTER TABLE workers ADD COLUMN languages_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE workers ADD COLUMN biography TEXT;
ALTER TABLE workers ADD COLUMN emergency_contact_name TEXT;
ALTER TABLE workers ADD COLUMN emergency_contact_phone TEXT;
ALTER TABLE workers ADD COLUMN emergency_contact_relationship TEXT;
ALTER TABLE workers ADD COLUMN notification_settings_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE workers ADD COLUMN privacy_settings_json TEXT NOT NULL DEFAULT '{}';

ALTER TABLE worker_documents ADD COLUMN document_name TEXT;
ALTER TABLE worker_documents ADD COLUMN expiry_date TEXT;
ALTER TABLE worker_documents ADD COLUMN replaced_by_document_id INTEGER REFERENCES worker_documents(id) ON DELETE SET NULL;
ALTER TABLE worker_documents ADD COLUMN updated_at TEXT;
UPDATE worker_documents SET document_name = COALESCE(document_name, document_type), updated_at = COALESCE(updated_at, uploaded_at);

ALTER TABLE worker_applications ADD COLUMN viewed_at TEXT;
ALTER TABLE worker_applications ADD COLUMN interview_at TEXT;
ALTER TABLE worker_applications ADD COLUMN employer_note TEXT;

CREATE TABLE IF NOT EXISTS worker_experience (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  worker_id INTEGER NOT NULL REFERENCES workers(id) ON DELETE CASCADE,
  company TEXT NOT NULL,
  position TEXT NOT NULL,
  country TEXT NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT,
  description TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_worker_experience_worker ON worker_experience(worker_id, start_date DESC);
CREATE INDEX IF NOT EXISTS idx_worker_notifications_worker_read ON worker_notifications(worker_id, is_read, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_worker_saved_jobs_worker_created ON worker_saved_jobs(worker_id, created_at DESC);
