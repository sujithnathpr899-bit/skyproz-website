PRAGMA foreign_keys = ON;

ALTER TABLE contract_sources ADD COLUMN initial_import_limit INTEGER NOT NULL DEFAULT 500;
ALTER TABLE contract_sources ADD COLUMN daily_import_limit INTEGER NOT NULL DEFAULT 50;
ALTER TABLE contract_sources ADD COLUMN duplicates_skipped INTEGER NOT NULL DEFAULT 0;

ALTER TABLE import_runs ADD COLUMN duplicate_skipped_count INTEGER NOT NULL DEFAULT 0;
