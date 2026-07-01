import { db, parseJson, serializeContract, transaction } from './db.mjs';
import { clampInt, normalizeIsoDate, slugify, uniqueSlug } from './utils.mjs';
import { enrichContractIntelligence } from './scoring.mjs';

const SORTS = {
  newest: 'c.posted_date DESC, c.id DESC',
  deadline: "CASE WHEN c.deadline IS NULL THEN 1 ELSE 0 END, c.deadline ASC",
  budget_high: 'c.budget_value DESC NULLS LAST',
  budget_low: 'c.budget_value ASC NULLS LAST'
};

export function searchContracts(filters = {}, userId = null) {
  const page = clampInt(filters.page, 1, 1, 100000);
  const pageSize = clampInt(filters.page_size, 20, 1, 100);
  const where = [];
  const values = [];
  const keyword = String(filters.keyword || '').trim();
  let ftsJoin = '';

  if (keyword) {
    const safeKeyword = keyword.replace(/["']/g, ' ').split(/\s+/).filter(Boolean).map((word) => `"${word}"*`).join(' ');
    if (safeKeyword) {
      ftsJoin = 'JOIN contracts_fts fts ON fts.rowid = c.id';
      where.push('contracts_fts MATCH ?');
      values.push(safeKeyword);
    }
  }
  const exactFilters = [
    ['country', 'c.country'], ['industry', 'c.industry'], ['buyer_type', 'c.buyer_type'],
    ['work_mode', 'c.work_mode'], ['contract_type', 'c.contract_type'], ['status', 'c.status'],
    ['region', 'c.region'], ['buyer', 'c.buyer_name'], ['source_name', 'c.source_name'], ['ai_category', 'c.ai_category']
  ];
  for (const [key, column] of exactFilters) {
    if (filters[key]) { where.push(`${column} = ?`); values.push(String(filters[key])); }
  }
  if (filters.min_budget !== undefined && filters.min_budget !== '') {
    where.push('c.budget_value >= ?'); values.push(Number(filters.min_budget));
  }
  if (filters.max_budget !== undefined && filters.max_budget !== '') {
    where.push('c.budget_value <= ?'); values.push(Number(filters.max_budget));
  }
  if (filters.deadline_before) {
    where.push('c.deadline <= ?'); values.push(normalizeIsoDate(filters.deadline_before) || filters.deadline_before);
  }
  if (filters.deadline_after) {
    where.push('c.deadline >= ?'); values.push(normalizeIsoDate(filters.deadline_after) || filters.deadline_after);
  }
  if (filters.posted_after) {
    where.push('c.posted_date >= ?'); values.push(normalizeIsoDate(filters.posted_after) || filters.posted_after);
  }
  if (filters.posted_before) {
    where.push('c.posted_date <= ?'); values.push(normalizeIsoDate(filters.posted_before) || filters.posted_before);
  }
  if (filters.min_score !== undefined && filters.min_score !== '') {
    where.push('c.opportunity_score >= ?'); values.push(Number(filters.min_score));
  }
  if (filters.verified === 'true' || filters.verified === true) where.push('c.verified = 1');
  if (filters.source_id) { where.push('c.source_id = ?'); values.push(Number(filters.source_id)); }
  if (filters.category) {
    where.push(`EXISTS (
      SELECT 1 FROM contract_category_links ccl
      JOIN contract_categories cc ON cc.id = ccl.category_id
      WHERE ccl.contract_id = c.id AND cc.slug = ?
    )`);
    values.push(String(filters.category));
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const count = db.prepare(`SELECT COUNT(*) AS total FROM contracts c ${ftsJoin} ${whereSql}`).get(...values).total;
  const favoriteSelect = userId
    ? ', EXISTS(SELECT 1 FROM user_favorites uf WHERE uf.contract_id = c.id AND uf.user_id = ?) AS is_favorite'
    : '';
  const dataValues = userId ? [userId, ...values] : [...values];
  const orderBy = SORTS[filters.sort] || SORTS.newest;
  const rows = db.prepare(`SELECT c.* ${favoriteSelect}
    FROM contracts c ${ftsJoin} ${whereSql}
    ORDER BY ${orderBy} LIMIT ? OFFSET ?`).all(...dataValues, pageSize, (page - 1) * pageSize);

  return {
    items: rows.map(serializeContract),
    pagination: { page, page_size: pageSize, total: count, pages: Math.max(1, Math.ceil(count / pageSize)) }
  };
}

export function getContract(identifier, userId = null) {
  const favoriteSelect = userId
    ? ', EXISTS(SELECT 1 FROM user_favorites uf WHERE uf.contract_id = c.id AND uf.user_id = ?) AS is_favorite'
    : '';
  const selector = /^\d+$/.test(String(identifier)) ? 'c.id = ?' : 'c.slug = ?';
  const args = userId ? [userId, identifier] : [identifier];
  const row = db.prepare(`SELECT c.* ${favoriteSelect}, s.name AS configured_source_name
    FROM contracts c LEFT JOIN contract_sources s ON s.id = c.source_id WHERE ${selector}`).get(...args);
  if (!row) return null;
  const contract = serializeContract(row);
  contract.categories = db.prepare(`SELECT cc.* FROM contract_categories cc
    JOIN contract_category_links ccl ON ccl.category_id = cc.id WHERE ccl.contract_id = ? ORDER BY cc.name`).all(row.id);
  return contract;
}

function contractValues(input, existing = {}) {
  const title = String(input.title ?? existing.title ?? '').trim();
  if (!title) throw Object.assign(new Error('Title is required'), { status: 400 });
  const tags = Array.isArray(input.tags) ? input.tags : parseJson(input.tags_json, parseJson(existing.tags_json, []));
  const matchedKeywords = Array.isArray(input.matched_keywords) ? input.matched_keywords : parseJson(input.matched_keywords_json, parseJson(existing.matched_keywords_json, []));
  const matchingServices = Array.isArray(input.matching_services) ? input.matching_services : parseJson(input.matching_services_json, parseJson(existing.matching_services_json, []));
  const enriched = enrichContractIntelligence({
    ...input,
    title,
    description: String(input.description ?? existing.description ?? '').trim(),
    industry: String(input.industry ?? existing.industry ?? '').trim(),
    contract_type: String(input.contract_type ?? existing.contract_type ?? '').trim(),
    country: String(input.country ?? existing.country ?? '').trim(),
    buyer_type: input.buyer_type ?? existing.buyer_type ?? 'government',
    buyer_name: input.buyer_name ?? existing.buyer_name ?? '',
    deadline: normalizeIsoDate(input.deadline ?? existing.deadline),
    budget_value: input.budget_value === '' || input.budget_value === null ? null : Number(input.budget_value ?? existing.budget_value),
    tags
  });
  const country = String(input.country ?? existing.country ?? '').trim();
  const deadline = normalizeIsoDate(input.deadline ?? existing.deadline);
  const sourceUrl = String(input.source_url ?? existing.source_url ?? '').trim();
  const duplicateKey = input.duplicate_key || existing.duplicate_key || slugify([title, country, deadline ? deadline.slice(0, 10) : sourceUrl].filter(Boolean).join(' '));
  return {
    source_id: input.source_id ?? existing.source_id ?? null,
    external_id: input.external_id ?? existing.external_id ?? null,
    title,
    description: enriched.description,
    source_name: String(input.source_name ?? existing.source_name ?? '').trim(),
    source_url: sourceUrl,
    country,
    region: String(input.region ?? existing.region ?? '').trim(),
    buyer_name: String(input.buyer_name ?? existing.buyer_name ?? '').trim(),
    industry: enriched.industry,
    contract_type: enriched.contract_type,
    buyer_type: input.buyer_type ?? existing.buyer_type ?? 'government',
    work_mode: input.work_mode ?? existing.work_mode ?? 'onsite',
    budget_value: enriched.budget_value,
    currency: input.currency ?? existing.currency ?? null,
    deadline,
    posted_date: normalizeIsoDate(input.posted_date ?? existing.posted_date) || new Date().toISOString(),
    tags_json: JSON.stringify(enriched.tags || []),
    status: input.status ?? existing.status ?? 'open',
    verified: input.verified === undefined ? Number(existing.verified || 0) : Number(Boolean(input.verified)),
    metadata_json: JSON.stringify(input.metadata ?? parseJson(existing.metadata_json, {})),
    latitude: input.latitude === '' || input.latitude === undefined ? existing.latitude ?? null : Number(input.latitude),
    longitude: input.longitude === '' || input.longitude === undefined ? existing.longitude ?? null : Number(input.longitude),
    source_metadata_json: JSON.stringify(input.source_metadata ?? parseJson(existing.source_metadata_json, {})),
    import_run_id: input.import_run_id ?? existing.import_run_id ?? null,
    opportunity_score: Number(enriched.opportunity_score ?? existing.opportunity_score ?? 0),
    opportunity_label: enriched.opportunity_label || existing.opportunity_label || 'Low Match',
    ai_category: enriched.ai_category || existing.ai_category || null,
    duplicate_key: duplicateKey,
    language: input.language ?? existing.language ?? 'en',
    translated_description: input.translated_description ?? existing.translated_description ?? null,
    matched_keywords_json: JSON.stringify(matchedKeywords),
    matching_services_json: JSON.stringify(matchingServices),
    suggested_business_unit: input.suggested_business_unit ?? existing.suggested_business_unit ?? null,
    estimated_opportunity_value: input.estimated_opportunity_value ?? existing.estimated_opportunity_value ?? null,
    submission_urgency: input.submission_urgency ?? existing.submission_urgency ?? null,
    country_risk: input.country_risk ?? existing.country_risk ?? null,
    recommended_action: input.recommended_action ?? existing.recommended_action ?? null,
    ai_score: Number(input.ai_score ?? existing.ai_score ?? enriched.opportunity_score ?? 0),
    ai_priority: input.ai_priority ?? existing.ai_priority ?? 'Low',
    imported_at: input.imported_at ?? existing.imported_at ?? new Date().toISOString(),
    last_seen_at: new Date().toISOString()
  };
}

export function createContract(input) {
  const value = contractValues(input);
  const slug = uniqueSlug(db, input.slug || value.title);
  const columns = Object.keys(value);
  const result = db.prepare(`INSERT INTO contracts(slug, ${columns.join(', ')})
    VALUES (?, ${columns.map(() => '?').join(', ')})`).run(slug, ...columns.map((key) => value[key]));
  setCategories(Number(result.lastInsertRowid), input.category_ids || []);
  return getContract(Number(result.lastInsertRowid));
}

export function updateContract(id, input) {
  const existing = db.prepare('SELECT * FROM contracts WHERE id = ?').get(id);
  if (!existing) return null;
  const value = contractValues(input, existing);
  const slug = input.slug || input.title ? uniqueSlug(db, input.slug || value.title, Number(id)) : existing.slug;
  const columns = Object.keys(value);
  db.prepare(`UPDATE contracts SET slug = ?, ${columns.map((key) => `${key} = ?`).join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
    .run(slug, ...columns.map((key) => value[key]), id);
  if (input.category_ids) setCategories(Number(id), input.category_ids);
  return getContract(Number(id));
}

export function upsertImportedContract(input) {
  if (input.source_id && input.external_id) {
    const existing = db.prepare('SELECT id FROM contracts WHERE source_id = ? AND external_id = ?').get(input.source_id, input.external_id);
    if (existing) return { action: 'updated', contract: updateContract(existing.id, input) };
  }
  if (input.duplicate_key) {
    const existing = db.prepare('SELECT id FROM contracts WHERE duplicate_key = ?').get(input.duplicate_key);
    if (existing) return { action: 'updated', contract: updateContract(existing.id, input) };
  }
  if (input.title && input.country) {
    const existing = db.prepare(`SELECT id FROM contracts
      WHERE lower(trim(title)) = lower(trim(?)) AND lower(trim(country)) = lower(trim(?))
        AND COALESCE(date(deadline),'') = COALESCE(date(?),'') LIMIT 1`).get(input.title, input.country, input.deadline || null);
    if (existing) return { action: 'updated', contract: updateContract(existing.id, input) };
  }
  return { action: 'created', contract: createContract(input) };
}

export function setCategories(contractId, categoryIds) {
  transaction(() => {
    db.prepare('DELETE FROM contract_category_links WHERE contract_id = ?').run(contractId);
    const insert = db.prepare('INSERT OR IGNORE INTO contract_category_links(contract_id, category_id) VALUES (?, ?)');
    for (const categoryId of categoryIds.map(Number).filter(Boolean)) insert.run(contractId, categoryId);
  });
}

export function removeDuplicateContracts() {
  const duplicates = db.prepare(`SELECT MIN(id) AS keep_id, GROUP_CONCAT(id) AS ids, COUNT(*) AS count
    FROM contracts GROUP BY COALESCE(duplicate_key, lower(trim(title)) || '|' || country || '|' || COALESCE(date(deadline), '')) HAVING COUNT(*) > 1`).all();
  let removed = 0;
  transaction(() => {
    for (const duplicate of duplicates) {
      const ids = String(duplicate.ids).split(',').map(Number).filter((id) => id !== duplicate.keep_id);
      for (const id of ids) { db.prepare('DELETE FROM contracts WHERE id = ?').run(id); removed++; }
    }
  });
  return removed;
}

export function listFilterOptions() {
  const distinct = (column) => db.prepare(`SELECT DISTINCT ${column} AS value FROM contracts WHERE ${column} IS NOT NULL AND ${column} <> '' ORDER BY value`).all().map((row) => row.value);
  return {
    countries: distinct('country'),
    regions: distinct('region'),
    industries: distinct('industry'),
    buyers: distinct('buyer_name'),
    contract_types: distinct('contract_type'),
    ai_categories: distinct('ai_category'),
    business_units: distinct('suggested_business_unit'),
    categories: db.prepare('SELECT id, name, slug FROM contract_categories ORDER BY name').all(),
    sources: db.prepare('SELECT id, name, country, source_type FROM contract_sources WHERE is_active = 1 ORDER BY name').all()
  };
}
