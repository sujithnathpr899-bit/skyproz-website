import { db } from '../db.mjs';
import { getConnector, listConnectors } from '../connectors/index.mjs';
import { config } from '../config.mjs';

export function availableConnectors() {
  return listConnectors();
}

function updateConnectorStatistics(connector, result, ok, error = null) {
  const existing = db.prepare('SELECT * FROM connector_statistics WHERE connector_key = ?').get(connector.key);
  const duration = result?.duration_ms || 0;
  const imported = result?.imported || 0;
  const updated = result?.updated || 0;
  const skipped = result?.skipped || 0;
  if (!existing) {
    db.prepare(`INSERT INTO connector_statistics(connector_key, display_name, last_status, last_checked_at, last_imported_at,
      success_count, failure_count, total_imported, total_updated, total_skipped, average_duration_ms, last_error)
      VALUES (?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, ?, ?, ?, ?, ?, ?, ?)`)
      .run(connector.key, connector.name, ok ? 'ok' : 'failed', ok ? 1 : 0, ok ? 0 : 1, imported, updated, skipped, duration, error);
    return;
  }
  const successCount = existing.success_count + (ok ? 1 : 0);
  const failureCount = existing.failure_count + (ok ? 0 : 1);
  const averageDuration = duration ? Math.round(((existing.average_duration_ms || 0) * Math.max(1, successCount + failureCount - 1) + duration) / Math.max(1, successCount + failureCount)) : existing.average_duration_ms;
  db.prepare(`UPDATE connector_statistics SET display_name = ?, last_status = ?, last_checked_at = CURRENT_TIMESTAMP,
    last_imported_at = CURRENT_TIMESTAMP, success_count = ?, failure_count = ?, total_imported = total_imported + ?,
    total_updated = total_updated + ?, total_skipped = total_skipped + ?, average_duration_ms = ?, last_error = ?
    WHERE connector_key = ?`)
    .run(connector.name, ok ? 'ok' : 'failed', successCount, failureCount, imported, updated, skipped, averageDuration, error, connector.key);
}

export async function testSourceConnection(source) {
  const connector = getConnector(source.connector_key || source.parser_type || 'json');
  const result = await connector.testConnection(source);
  db.prepare(`UPDATE contract_sources SET last_status = ?, last_error = ?, last_tested_at = CURRENT_TIMESTAMP,
    last_duration_ms = ?, failure_count = failure_count + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
    .run(result.ok ? 'ok' : 'failed', result.error || result.message || null, result.duration_ms || null, result.ok ? 0 : 1, source.id);
  return { connector: connector.key, ...result };
}

export async function importSource(source, options = {}) {
  const connector = getConnector(source.connector_key || source.parser_type || 'json');
  if (!source.api_url && source.parser_type === 'manual') return { imported: 0, updated: 0, skipped: 0, warnings: [], failures: [], connector: connector.key };
  const run = db.prepare("INSERT INTO import_runs(source_id, connector_key, job_type, status) VALUES (?, ?, ?, 'running')")
    .run(source.id, connector.key, options.jobType || 'manual');
  const runId = Number(run.lastInsertRowid);
  try {
    const result = await connector.import(source, { runId });
    db.prepare(`UPDATE import_runs SET status = 'completed', imported_count = ?, updated_count = ?, skipped_count = ?,
      warning_count = ?, failure_count = ?, duration_ms = ?, warnings_json = ?, metadata_json = ?, completed_at = CURRENT_TIMESTAMP WHERE id = ?`)
      .run(result.imported, result.updated, result.skipped, result.warnings.length, result.failures.length, result.duration_ms, JSON.stringify(result.warnings), JSON.stringify({ failures: result.failures, contract_ids: result.contract_ids || [] }), runId);
    db.prepare(`UPDATE contract_sources SET last_imported_at = CURRENT_TIMESTAMP, last_status = 'ok', last_error = NULL,
      failure_count = 0, warning_count = ?, last_duration_ms = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
      .run(result.warnings.length, result.duration_ms, source.id);
    updateConnectorStatistics(connector, result, true);
    return { connector: connector.key, run_id: runId, ...result };
  } catch (error) {
    db.prepare(`UPDATE import_runs SET status = 'failed', error_message = ?, failure_count = 1, completed_at = CURRENT_TIMESTAMP WHERE id = ?`).run(error.message, runId);
    db.prepare(`UPDATE contract_sources SET last_status = 'failed', last_error = ?, failure_count = failure_count + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(error.message, source.id);
    updateConnectorStatistics(connector, { imported: 0, updated: 0, skipped: 0, duration_ms: 0 }, false, error.message);
    throw error;
  }
}

async function withRetry(source, options) {
  const attempts = Math.max(1, Number(options.retries ?? config.bot.retryAttempts ?? 2) + 1);
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return { source: source.name, source_id: source.id, ok: true, ...(await importSource(source, options)) };
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, Math.min(30000, 800 * attempt)));
    }
  }
  return { source: source.name, source_id: source.id, ok: false, error: lastError?.message || 'Import failed' };
}

async function runLimited(items, limit, worker) {
  const results = [];
  let index = 0;
  async function next() {
    while (index < items.length) {
      const current = items[index++];
      results.push(await worker(current));
    }
  }
  const workers = Array.from({ length: Math.min(limit, items.length || 1) }, next);
  await Promise.all(workers);
  return results;
}

export async function importAllSources(options = {}) {
  const schedule = options.schedule;
  const where = schedule ? "WHERE is_active = 1 AND (schedule = ? OR ? = 'manual')" : 'WHERE is_active = 1';
  const args = schedule ? [schedule, schedule] : [];
  const sources = db.prepare(`SELECT * FROM contract_sources ${where} ORDER BY id`).all(...args);
  const concurrency = Math.max(1, Number(options.concurrency || config.bot.importConcurrency || 4));
  return await runLimited(sources, concurrency, (source) => withRetry(source, { jobType: schedule || 'manual', retries: options.retries }));
}

export function connectorStatus() {
  return {
    connectors: availableConnectors().map((connector) => ({
      ...connector,
      statistics: db.prepare('SELECT * FROM connector_statistics WHERE connector_key = ?').get(connector.key) || null
    })),
    sources: db.prepare(`SELECT id, name, connector_key, source_type, country, region, schedule, is_active,
      last_status, last_error, last_imported_at, last_tested_at, last_duration_ms, failure_count, warning_count
      FROM contract_sources ORDER BY name`).all(),
    queue: db.prepare('SELECT * FROM import_queue ORDER BY priority ASC, run_after ASC LIMIT 20').all(),
    failed_imports: db.prepare("SELECT * FROM import_runs WHERE status = 'failed' ORDER BY started_at DESC LIMIT 20").all(),
    recent_imports: db.prepare('SELECT * FROM import_runs ORDER BY started_at DESC LIMIT 20').all()
  };
}
