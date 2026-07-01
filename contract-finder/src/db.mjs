import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { config, rootDir } from './config.mjs';

function ensureWritableDatabasePath(databasePath) {
  const directory = path.dirname(databasePath);
  fs.mkdirSync(directory, { recursive: true });
  const probe = path.join(directory, `.skyproz-write-test-${process.pid}-${Date.now()}`);
  fs.writeFileSync(probe, '');
  fs.rmSync(probe, { force: true });
  return databasePath;
}

function temporaryDatabasePath(preferredPath) {
  const filename = path.basename(preferredPath || 'contract-finder.db') || 'contract-finder.db';
  return path.join(os.tmpdir(), 'skyproz-contract-finder', filename);
}

export let databaseIsTemporary = false;
export let activeDatabasePath = config.databasePath;

try {
  activeDatabasePath = ensureWritableDatabasePath(config.databasePath);
} catch (error) {
  activeDatabasePath = ensureWritableDatabasePath(temporaryDatabasePath(config.databasePath));
  databaseIsTemporary = true;
  console.warn(`[Skyproz] DATABASE_PATH "${config.databasePath}" is not writable (${error.code || error.message}). Falling back to temporary SQLite database "${activeDatabasePath}". Data will not persist between restarts or redeploys.`);
}

export const db = new DatabaseSync(activeDatabasePath);
db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');

export function migrate() {
  const migrationDir = path.join(rootDir, 'migrations');
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    filename TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
  const applied = new Set(db.prepare('SELECT filename FROM schema_migrations').all().map((row) => row.filename));
  const files = fs.readdirSync(migrationDir).filter((name) => name.endsWith('.sql')).sort();
  for (const filename of files) {
    if (applied.has(filename)) continue;
    const sql = fs.readFileSync(path.join(migrationDir, filename), 'utf8');
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(sql);
      db.prepare('INSERT INTO schema_migrations(filename) VALUES (?)').run(filename);
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }
}

export function transaction(fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export function parseJson(value, fallback = null) {
  if (!value) return fallback;
  try { return JSON.parse(value); } catch { return fallback; }
}

export function serializeContract(row) {
  if (!row) return null;
  return {
    ...row,
    tags: parseJson(row.tags_json, []),
    metadata: parseJson(row.metadata_json, {}),
    source_metadata: parseJson(row.source_metadata_json, {}),
    matched_keywords: parseJson(row.matched_keywords_json, []),
    matching_services: parseJson(row.matching_services_json, []),
    ai_requirements: parseJson(row.ai_requirements_json, []),
    ai_checklist: parseJson(row.ai_checklist_json, []),
    verified: Boolean(row.verified),
    is_favorite: row.is_favorite === undefined ? undefined : Boolean(row.is_favorite)
  };
}
