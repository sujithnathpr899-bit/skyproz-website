CREATE TABLE IF NOT EXISTS erp_counters (
  module_key TEXT PRIMARY KEY,
  prefix TEXT NOT NULL,
  next_number INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS erp_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  module_key TEXT NOT NULL,
  record_number TEXT NOT NULL,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  customer_name TEXT,
  company_name TEXT,
  contact_name TEXT,
  amount REAL NOT NULL DEFAULT 0,
  tax_amount REAL NOT NULL DEFAULT 0,
  total_amount REAL NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'INR',
  issue_date TEXT,
  due_date TEXT,
  assigned_to TEXT,
  priority TEXT NOT NULL DEFAULT 'normal',
  tags_json TEXT NOT NULL DEFAULT '[]',
  data_json TEXT NOT NULL DEFAULT '{}',
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(module_key, record_number)
);

CREATE TABLE IF NOT EXISTS erp_line_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  record_id INTEGER NOT NULL REFERENCES erp_records(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  hsn_sac TEXT,
  quantity REAL NOT NULL DEFAULT 1,
  unit TEXT NOT NULL DEFAULT 'nos',
  unit_price REAL NOT NULL DEFAULT 0,
  gst_rate REAL NOT NULL DEFAULT 0,
  cgst REAL NOT NULL DEFAULT 0,
  sgst REAL NOT NULL DEFAULT 0,
  igst REAL NOT NULL DEFAULT 0,
  total REAL NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS erp_documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  record_id INTEGER REFERENCES erp_records(id) ON DELETE CASCADE,
  module_key TEXT NOT NULL,
  document_type TEXT NOT NULL,
  filename TEXT NOT NULL,
  content_type TEXT NOT NULL DEFAULT 'application/octet-stream',
  size_bytes INTEGER NOT NULL DEFAULT 0,
  body_base64 TEXT,
  notes TEXT,
  uploaded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS erp_activity (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  module_key TEXT NOT NULL,
  record_id INTEGER REFERENCES erp_records(id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  note TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS erp_settings (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL DEFAULT '{}',
  updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_erp_records_module ON erp_records(module_key, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_erp_records_search ON erp_records(module_key, title, customer_name, company_name, status);
CREATE INDEX IF NOT EXISTS idx_erp_records_due_date ON erp_records(module_key, due_date);
CREATE INDEX IF NOT EXISTS idx_erp_line_items_record ON erp_line_items(record_id);
CREATE INDEX IF NOT EXISTS idx_erp_documents_record ON erp_documents(record_id);
CREATE INDEX IF NOT EXISTS idx_erp_activity_record ON erp_activity(record_id, created_at DESC);
