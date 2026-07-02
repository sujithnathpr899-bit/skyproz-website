import { db, parseJson } from '../db.mjs';
import { getConnector, listConnectors } from '../connectors/index.mjs';
import { listConnectorTemplates } from '../connectors/template-catalog.mjs';
import { config } from '../config.mjs';

export function availableConnectors() {
  return listConnectors();
}

function logConnectorEvent({ sourceId = null, connectorKey, level = 'info', action, message, metadata = {}, durationMs = null }) {
  db.prepare(`INSERT INTO connector_logs(source_id, connector_key, level, action, message, metadata_json, duration_ms)
    VALUES (?, ?, ?, ?, ?, ?, ?)`).run(sourceId, connectorKey, level, action, message, JSON.stringify(metadata || {}), durationMs);
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

function completedImportCount(sourceId) {
  return db.prepare("SELECT COUNT(*) AS count FROM import_runs WHERE source_id = ? AND status = 'completed'").get(sourceId).count;
}

function sourceForImportLimit(source, options = {}) {
  const completedRuns = completedImportCount(source.id);
  const mode = options.importMode || (completedRuns === 0 && Number(source.contracts_imported || 0) === 0 ? 'initial' : 'daily');
  const configuredLimit = mode === 'initial'
    ? Number(source.initial_import_limit || 500)
    : Number(source.daily_import_limit || 50);
  const overrideLimit = Number(options.limit || 0);
  const appliedLimit = Math.max(1, Math.min(1000, overrideLimit || configuredLimit || 50));
  const parserConfig = parseJson(source.parser_config_json, {}) || {};
  return {
    source: {
      ...source,
      parser_config_json: JSON.stringify({ ...parserConfig, limit: appliedLimit })
    },
    mode,
    appliedLimit
  };
}

export async function testSourceConnection(source) {
  const connector = getConnector(source.connector_key || source.parser_type || 'json');
  const result = await connector.testConnection(source);
  const status = result.ok ? 'ok' : (result.status === 'empty' ? 'warning' : 'failed');
  db.prepare(`UPDATE contract_sources SET last_status = ?, last_error = ?, last_tested_at = CURRENT_TIMESTAMP,
    last_success_at = CASE WHEN ? = 1 THEN CURRENT_TIMESTAMP ELSE last_success_at END,
    sample_contracts_json = ?, last_duration_ms = ?, failure_count = failure_count + ?,
    scheduler_status = CASE WHEN is_active = 1 THEN 'scheduled' ELSE 'disabled' END,
    updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
    .run(
      status,
      result.ok ? null : (result.error || result.message || status),
      result.ok ? 1 : 0,
      JSON.stringify(result.sample_contracts || []),
      result.duration_ms || null,
      result.ok ? 0 : 1,
      source.id
    );
  logConnectorEvent({
    sourceId: source.id,
    connectorKey: connector.key,
    level: result.ok ? 'info' : 'error',
    action: 'test',
    message: result.ok ? (result.message || 'Connection test passed') : (result.error || result.message || 'Connection test failed'),
    metadata: result,
    durationMs: result.duration_ms || null
  });
  return { connector: connector.key, ...result };
}

export async function importSource(source, options = {}) {
  const connector = getConnector(source.connector_key || source.parser_type || 'json');
  if (!source.api_url && source.parser_type === 'manual') return { imported: 0, updated: 0, skipped: 0, duplicate_skipped: 0, warnings: [], failures: [], connector: connector.key };
  const plan = sourceForImportLimit(source, options);
  const run = db.prepare("INSERT INTO import_runs(source_id, connector_key, job_type, status) VALUES (?, ?, ?, 'running')")
    .run(source.id, connector.key, options.jobType || 'manual');
  const runId = Number(run.lastInsertRowid);
  db.prepare("UPDATE contract_sources SET last_run_at = CURRENT_TIMESTAMP, scheduler_status = 'running', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(source.id);
  logConnectorEvent({ sourceId: source.id, connectorKey: connector.key, action: 'import.start', message: 'Import started', metadata: { run_id: runId, job_type: options.jobType || 'manual', import_mode: plan.mode, applied_limit: plan.appliedLimit } });
  try {
    const result = await connector.import(plan.source, { runId, importMode: plan.mode, limit: plan.appliedLimit });
    result.duplicate_skipped = Number(result.duplicate_skipped || 0);
    db.prepare(`UPDATE import_runs SET status = 'completed', imported_count = ?, updated_count = ?, skipped_count = ?,
      warning_count = ?, failure_count = ?, duplicate_skipped_count = ?, duration_ms = ?, warnings_json = ?, metadata_json = ?, completed_at = CURRENT_TIMESTAMP WHERE id = ?`)
      .run(result.imported, result.updated, result.skipped, result.warnings.length, result.failures.length, result.duplicate_skipped, result.duration_ms, JSON.stringify(result.warnings), JSON.stringify({ failures: result.failures, contract_ids: result.contract_ids || [], import_mode: plan.mode, applied_limit: plan.appliedLimit, duplicate_skipped: result.duplicate_skipped }), runId);
    db.prepare(`UPDATE contract_sources SET last_imported_at = CURRENT_TIMESTAMP, last_status = 'ok', last_error = NULL,
      last_success_at = CURRENT_TIMESTAMP, failure_count = 0, warning_count = ?, last_duration_ms = ?,
      contracts_imported = contracts_imported + ?, duplicates_skipped = duplicates_skipped + ?, scheduler_status = CASE WHEN is_active = 1 THEN 'scheduled' ELSE 'disabled' END,
      updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
      .run(result.warnings.length, result.duration_ms, Number(result.imported || 0) + Number(result.updated || 0), result.duplicate_skipped, source.id);
    logConnectorEvent({
      sourceId: source.id,
      connectorKey: connector.key,
      action: 'import.complete',
      message: `Import completed: ${result.imported} new, ${result.updated} updated, ${result.duplicate_skipped} duplicate skipped, ${result.skipped} total skipped`,
      metadata: { ...result, import_mode: plan.mode, applied_limit: plan.appliedLimit },
      durationMs: result.duration_ms
    });
    updateConnectorStatistics(connector, result, true);
    return { connector: connector.key, run_id: runId, import_mode: plan.mode, applied_limit: plan.appliedLimit, ...result };
  } catch (error) {
    db.prepare(`UPDATE import_runs SET status = 'failed', error_message = ?, failure_count = 1, completed_at = CURRENT_TIMESTAMP WHERE id = ?`).run(error.message, runId);
    db.prepare(`UPDATE contract_sources SET last_status = 'failed', last_error = ?, failure_count = failure_count + 1,
      scheduler_status = CASE WHEN is_active = 1 THEN 'retry_pending' ELSE 'disabled' END, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(error.message, source.id);
    logConnectorEvent({ sourceId: source.id, connectorKey: connector.key, level: 'error', action: 'import.failed', message: error.message, metadata: { run_id: runId } });
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
  const summary = {
    total_connectors: db.prepare('SELECT COUNT(*) AS count FROM contract_sources').get().count,
    enabled_connectors: db.prepare('SELECT COUNT(*) AS count FROM contract_sources WHERE is_active = 1').get().count,
    healthy_connectors: db.prepare("SELECT COUNT(*) AS count FROM contract_sources WHERE is_active = 1 AND last_status = 'ok'").get().count,
    failed_connectors: db.prepare("SELECT COUNT(*) AS count FROM contract_sources WHERE is_active = 1 AND last_status = 'failed'").get().count,
    contracts_imported_today: db.prepare("SELECT COALESCE(SUM(imported_count + updated_count), 0) AS count FROM import_runs WHERE status = 'completed' AND date(started_at) = date('now')").get().count,
    average_import_duration: db.prepare("SELECT ROUND(AVG(duration_ms), 0) AS value FROM import_runs WHERE status = 'completed' AND duration_ms IS NOT NULL").get().value || 0
  };
  return {
    summary,
    connectors: availableConnectors().map((connector) => ({
      ...connector,
      statistics: db.prepare('SELECT * FROM connector_statistics WHERE connector_key = ?').get(connector.key) || null
    })),
    sources: db.prepare(`SELECT id, name, connector_key, source_type, country, region, schedule, is_active,
      source_format, base_url, api_url, api_key_env, parser_config_json, headers_json, auth_config_json,
      pagination_config_json, rate_limit_ms, sample_contracts_json, last_status, last_error, last_run_at,
      last_success_at, last_imported_at, last_tested_at, last_duration_ms, failure_count, warning_count,
      contracts_imported, duplicates_skipped, initial_import_limit, daily_import_limit, scheduler_status
      FROM contract_sources ORDER BY name`).all(),
    queue: db.prepare('SELECT * FROM import_queue ORDER BY priority ASC, run_after ASC LIMIT 20').all(),
    failed_imports: db.prepare("SELECT * FROM import_runs WHERE status = 'failed' ORDER BY started_at DESC LIMIT 20").all(),
    recent_imports: db.prepare('SELECT * FROM import_runs ORDER BY started_at DESC LIMIT 20').all(),
    logs: db.prepare('SELECT * FROM connector_logs ORDER BY created_at DESC LIMIT 50').all()
      .map((row) => ({ ...row, metadata: parseJson(row.metadata_json, {}) })),
    templates: listConnectorTemplates()
  };
}

export function connectorLogs(sourceId, limit = 50) {
  return db.prepare('SELECT * FROM connector_logs WHERE source_id = ? ORDER BY created_at DESC LIMIT ?')
    .all(Number(sourceId), Math.max(1, Math.min(200, Number(limit) || 50)))
    .map((row) => ({ ...row, metadata: parseJson(row.metadata_json, {}) }));
}
