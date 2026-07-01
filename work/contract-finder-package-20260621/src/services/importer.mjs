import { db, parseJson } from '../db.mjs';
import { upsertImportedContract } from '../contracts.mjs';

function getPath(value, path) {
  return String(path || '').split('.').filter(Boolean).reduce((current, key) => current?.[key], value);
}

function mapItem(source, item) {
  const config = parseJson(source.parser_config_json, {});
  const fieldMap = config.field_map || {};
  const mapped = {};
  for (const [target, sourcePath] of Object.entries(fieldMap)) mapped[target] = getPath(item, sourcePath);
  return {
    ...mapped,
    source_id: source.id,
    source_name: source.name,
    source_url: mapped.source_url || source.source_url,
    country: mapped.country || source.country || 'Unknown',
    buyer_type: mapped.buyer_type || source.source_type,
    tags: Array.isArray(mapped.tags) ? mapped.tags : String(mapped.tags || '').split(',').map((value) => value.trim()).filter(Boolean)
  };
}

export async function importSource(source) {
  if (!source.api_url || source.parser_type === 'manual') return { imported: 0, updated: 0, skipped: 0 };
  const run = db.prepare("INSERT INTO import_runs(source_id, status) VALUES (?, 'running')").run(source.id);
  const runId = Number(run.lastInsertRowid);
  let imported = 0; let updated = 0; let skipped = 0;
  try {
    const response = await fetch(source.api_url, { headers: { accept: 'application/json', 'user-agent': 'SkyprozContractFinder/1.0' } });
    if (!response.ok) throw new Error(`Source returned HTTP ${response.status}`);
    const payload = await response.json();
    const config = parseJson(source.parser_config_json, {});
    const items = getPath(payload, config.items_path) || payload;
    if (!Array.isArray(items)) throw new Error('Configured source payload is not an array');
    for (const item of items) {
      try {
        const mapped = mapItem(source, item);
        if (!mapped.title || !mapped.description) { skipped++; continue; }
        const result = upsertImportedContract(mapped);
        if (result.action === 'created') imported++; else updated++;
      } catch { skipped++; }
    }
    db.prepare(`UPDATE import_runs SET status = 'completed', imported_count = ?, updated_count = ?, skipped_count = ?, completed_at = CURRENT_TIMESTAMP WHERE id = ?`)
      .run(imported, updated, skipped, runId);
    db.prepare('UPDATE contract_sources SET last_imported_at = CURRENT_TIMESTAMP WHERE id = ?').run(source.id);
    return { imported, updated, skipped };
  } catch (error) {
    db.prepare(`UPDATE import_runs SET status = 'failed', error_message = ?, completed_at = CURRENT_TIMESTAMP WHERE id = ?`).run(error.message, runId);
    throw error;
  }
}

export async function importAllSources() {
  const sources = db.prepare('SELECT * FROM contract_sources WHERE is_active = 1 AND api_url IS NOT NULL').all();
  const results = [];
  for (const source of sources) {
    try { results.push({ source: source.name, ok: true, ...(await importSource(source)) }); }
    catch (error) { results.push({ source: source.name, ok: false, error: error.message }); }
  }
  return results;
}
