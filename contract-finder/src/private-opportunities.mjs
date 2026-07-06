import { db, parseJson } from './db.mjs';
import { clampInt, normalizeIsoDate, slugify } from './utils.mjs';

const SERVICE_RULES = [
  ['Rope Access', ['rope access', 'irata', 'work at height', 'high rise', 'high-rise', 'height access']],
  ['Glass Cleaning', ['glass cleaning', 'window cleaning', 'curtain wall cleaning']],
  ['Building Maintenance', ['building maintenance', 'commercial building maintenance', 'preventive maintenance', 'emergency maintenance']],
  ['Facade Cleaning', ['facade cleaning', 'façade cleaning', 'exterior cleaning', 'building exterior']],
  ['Facade Repairs', ['facade repair', 'façade repair', 'facade maintenance', 'building facade repairs', 'cladding repair']],
  ['Waterproofing', ['waterproofing', 'leak repair', 'roof waterproofing', 'membrane repair']],
  ['Painting', ['painting', 'repainting', 'exterior painting', 'protective coating']],
  ['Silicone Replacement', ['silicone', 'sealant', 'sealant replacement', 'joint sealant']],
  ['Window Cleaning', ['window cleaning', 'external window', 'high rise window']],
  ['Solar Panel Cleaning', ['solar panel cleaning', 'solar cleaning', 'pv cleaning']],
  ['Bird Control', ['bird spike', 'bird control', 'anti bird', 'bird net']],
  ['Industrial Cleaning', ['industrial cleaning', 'pressure washing', 'deep cleaning']],
  ['AMC', ['annual maintenance contract', 'amc', 'maintenance contract']],
  ['Facility Management', ['facility management', 'facilities management', 'fm services']],
  ['Signage Installation', ['signage', 'signboard', 'banner installation', 'signboard installation']],
  ['Roof Maintenance', ['roof maintenance', 'roof inspection', 'roof repair']],
  ['Gutter Cleaning', ['gutter cleaning', 'rainwater gutter', 'downpipe cleaning']]
];

const TARGET_INDUSTRIES = [
  'Commercial Buildings', 'Shopping Malls', 'Hospitals', 'Hotels', 'Apartments', 'IT Parks',
  'Warehouses', 'Manufacturing Plants', 'Airports', 'Banks', 'Retail Chains', 'Educational Institutions'
];

const SOURCE_TYPES = new Set(['procurement_portal', 'vendor_registration', 'rfq_page', 'rfp_page', 'tender_page', 'rss', 'json', 'xml', 'csv']);

const SORT_COLUMNS = {
  score: 'p.match_score',
  match_score: 'p.match_score',
  company: 'p.company',
  opportunity: 'p.title',
  title: 'p.title',
  service: 'p.required_services_json',
  industry: 'p.industry',
  country: 'p.country',
  state: 'p.state',
  city: 'p.city',
  deadline: 'p.deadline',
  status: 'p.status',
  source: 'p.source_name',
  updated: 'p.updated_at',
  last_updated: 'p.updated_at'
};

function getPath(object, path, fallback = undefined) {
  if (!path) return fallback;
  return String(path).split('.').reduce((value, key) => {
    if (value === undefined || value === null) return undefined;
    return value[key];
  }, object) ?? fallback;
}

function list(value) {
  if (Array.isArray(value)) return value.map((item) => String(item || '').trim()).filter(Boolean);
  if (typeof value === 'string') return value.split(/[,;|\n]/).map((item) => item.trim()).filter(Boolean);
  return [];
}

function textFor(input = {}) {
  return [
    input.company, input.title, input.description, input.building_type, input.industry,
    input.country, input.state, input.city, ...list(input.required_services), ...list(input.tags)
  ].filter(Boolean).join(' ').toLowerCase();
}

function detectServices(input = {}) {
  const haystack = textFor(input);
  const matches = [];
  for (const [service, keywords] of SERVICE_RULES) {
    if (keywords.some((keyword) => haystack.includes(keyword))) matches.push(service);
  }
  return [...new Set([...list(input.required_services), ...matches])];
}

function requiredCertifications(services = []) {
  const certs = new Set(['Company Profile', 'GST Registration', 'Insurance / Workmen Compensation', 'HSE Method Statement']);
  if (services.some((service) => ['Rope Access', 'Glass Cleaning', 'Facade Cleaning', 'Facade Repairs', 'Painting', 'Silicone Replacement'].includes(service))) {
    certs.add('IRATA Rope Access Certification');
    certs.add('Work at Height Training');
    certs.add('Rescue Plan');
  }
  if (services.includes('Industrial Cleaning')) certs.add('Chemical Handling / Cleaning Safety Training');
  if (services.includes('Solar Panel Cleaning')) certs.add('Electrical Safety Awareness');
  return [...certs];
}

function requiredDocuments(services = []) {
  const documents = new Set(['Company profile', 'Trade license / registration', 'GST certificate', 'Insurance certificate', 'HSE plan', 'Method statement', 'Past experience list']);
  if (services.includes('AMC')) documents.add('Annual maintenance proposal');
  if (services.includes('Rope Access')) documents.add('IRATA technician certificates');
  if (services.includes('Painting')) documents.add('Paint/coating material data sheets');
  return [...documents];
}

function checklist(services = []) {
  const items = ['Verify original source and deadline', 'Confirm site access and work-at-height requirements', 'Prepare company profile and compliance documents', 'Estimate manpower, equipment and mobilisation plan', 'Submit vendor registration or proposal before deadline'];
  if (services.includes('AMC')) items.splice(3, 0, 'Prepare preventive maintenance calendar and AMC scope');
  if (services.includes('Rope Access')) items.splice(2, 0, 'Prepare rope access rescue plan and IRATA team details');
  return items;
}

export function analyzePrivateOpportunity(input = {}) {
  const services = detectServices(input);
  const haystack = textFor({ ...input, required_services: services });
  let score = 20;
  score += Math.min(45, services.length * 9);
  if (TARGET_INDUSTRIES.some((industry) => haystack.includes(industry.toLowerCase()))) score += 12;
  if (/amc|annual maintenance|facility management|building maintenance/.test(haystack)) score += 10;
  if (/rope access|irata|high rise|facade|glass cleaning/.test(haystack)) score += 10;
  if (input.budget_value && Number(input.budget_value) > 0) score += 5;
  if (input.deadline) {
    const days = Math.ceil((new Date(input.deadline).valueOf() - Date.now()) / 86400000);
    if (days >= 7 && days <= 60) score += 8;
    else if (days > 60) score += 4;
  }
  score = Math.max(0, Math.min(100, Math.round(score)));
  const company = input.company || 'The buyer';
  const serviceText = services.length ? services.join(', ') : 'building maintenance services';
  return {
    services,
    match_score: score,
    priority: score >= 80 ? 'High' : score >= 55 ? 'Medium' : 'Low',
    win_probability: score >= 80 ? 'High' : score >= 55 ? 'Medium' : 'Low',
    ai_summary: `${company} may be a fit for Skyproz private building maintenance support covering ${serviceText}. Review the official source, confirm site access requirements, and prepare a compliant proposal.`,
    required_certifications: requiredCertifications(services),
    required_documents: requiredDocuments(services),
    submission_checklist: checklist(services),
    recommended_services: services.length ? services : ['Building Maintenance', 'Facility Management']
  };
}

function uniquePrivateSlug(title, existingId = null) {
  const base = slugify(title);
  let candidate = base;
  let counter = 2;
  while (true) {
    const row = db.prepare('SELECT id FROM private_opportunities WHERE slug = ?').get(candidate);
    if (!row || row.id === existingId) return candidate;
    candidate = `${base}-${counter++}`;
  }
}

function serializeOpportunity(row) {
  if (!row) return null;
  return {
    ...row,
    required_services: parseJson(row.required_services_json, []),
    required_certifications: parseJson(row.required_certifications_json, []),
    required_documents: parseJson(row.required_documents_json, []),
    submission_checklist: parseJson(row.submission_checklist_json, []),
    recommended_services: parseJson(row.recommended_services_json, []),
    tags: parseJson(row.tags_json, []),
    metadata: parseJson(row.metadata_json, {})
  };
}

function serializeSource(row) {
  if (!row) return null;
  return {
    ...row,
    is_active: Boolean(row.is_active),
    headers: parseJson(row.headers_json, {}),
    parser_config: parseJson(row.parser_config_json, {})
  };
}

function opportunityValues(input, existing = {}) {
  const company = String(input.company ?? existing.company ?? '').trim();
  const title = String(input.title ?? input.opportunity ?? existing.title ?? '').trim();
  const description = String(input.description ?? existing.description ?? '').trim();
  if (!company) throw Object.assign(new Error('Company is required'), { status: 400 });
  if (!title) throw Object.assign(new Error('Opportunity is required'), { status: 400 });
  if (!description) throw Object.assign(new Error('Description is required'), { status: 400 });
  const sourceUrl = String(input.source_url ?? input.original_source_url ?? existing.source_url ?? '').trim();
  if (!sourceUrl) throw Object.assign(new Error('Original source link is required'), { status: 400 });
  const analysis = analyzePrivateOpportunity({ ...input, company, title, description });
  const requiredServices = analysis.services;
  const originalSourceUrl = String(input.original_source_url ?? sourceUrl).trim();
  return {
    source_id: input.source_id ?? existing.source_id ?? null,
    external_id: input.external_id ?? existing.external_id ?? null,
    company,
    title,
    description,
    building_type: input.building_type ?? existing.building_type ?? null,
    required_services_json: JSON.stringify(requiredServices),
    industry: String(input.industry ?? existing.industry ?? 'Commercial Building Maintenance').trim(),
    country: String(input.country ?? existing.country ?? 'Worldwide').trim(),
    state: String(input.state ?? existing.state ?? '').trim(),
    city: String(input.city ?? existing.city ?? '').trim(),
    budget_value: input.budget_value === '' || input.budget_value === undefined ? existing.budget_value ?? null : Number(input.budget_value),
    currency: input.currency ?? existing.currency ?? null,
    deadline: normalizeIsoDate(input.deadline ?? existing.deadline),
    posted_date: normalizeIsoDate(input.posted_date ?? existing.posted_date) || new Date().toISOString(),
    status: input.status ?? existing.status ?? 'new',
    source_name: String(input.source_name ?? existing.source_name ?? 'Private Source').trim(),
    source_url: sourceUrl,
    vendor_registration_url: input.vendor_registration_url ?? existing.vendor_registration_url ?? null,
    original_source_url: originalSourceUrl,
    ai_summary: input.ai_summary ?? existing.ai_summary ?? analysis.ai_summary,
    match_score: Number(input.match_score ?? existing.match_score ?? analysis.match_score),
    required_certifications_json: JSON.stringify(list(input.required_certifications).length ? list(input.required_certifications) : analysis.required_certifications),
    required_documents_json: JSON.stringify(list(input.required_documents).length ? list(input.required_documents) : analysis.required_documents),
    submission_checklist_json: JSON.stringify(list(input.submission_checklist).length ? list(input.submission_checklist) : analysis.submission_checklist),
    internal_notes: input.internal_notes ?? existing.internal_notes ?? null,
    win_probability: input.win_probability ?? existing.win_probability ?? analysis.win_probability,
    recommended_services_json: JSON.stringify(list(input.recommended_services).length ? list(input.recommended_services) : analysis.recommended_services),
    priority: input.priority ?? existing.priority ?? analysis.priority,
    tags_json: JSON.stringify([...new Set([...list(input.tags), ...requiredServices])]),
    metadata_json: JSON.stringify(input.metadata ?? parseJson(existing.metadata_json, {})),
    duplicate_key: input.duplicate_key || existing.duplicate_key || slugify([originalSourceUrl, title, company].filter(Boolean).join(' '))
  };
}

export function createPrivateOpportunity(input) {
  const value = opportunityValues(input);
  const slug = uniquePrivateSlug(input.slug || `${value.company} ${value.title}`);
  const columns = Object.keys(value);
  const result = db.prepare(`INSERT INTO private_opportunities(slug, ${columns.join(', ')})
    VALUES (?, ${columns.map(() => '?').join(', ')})`).run(slug, ...columns.map((key) => value[key]));
  return getPrivateOpportunity(Number(result.lastInsertRowid));
}

export function updatePrivateOpportunity(id, input) {
  const existing = db.prepare('SELECT * FROM private_opportunities WHERE id = ?').get(id);
  if (!existing) return null;
  const value = opportunityValues(input, existing);
  const slug = input.slug || input.title || input.company ? uniquePrivateSlug(input.slug || `${value.company} ${value.title}`, Number(id)) : existing.slug;
  const columns = Object.keys(value);
  db.prepare(`UPDATE private_opportunities SET slug = ?, ${columns.map((key) => `${key} = ?`).join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
    .run(slug, ...columns.map((key) => value[key]), id);
  return getPrivateOpportunity(Number(id));
}

export function getPrivateOpportunity(identifier) {
  const selector = /^\d+$/.test(String(identifier)) ? 'p.id = ?' : 'p.slug = ?';
  return serializeOpportunity(db.prepare(`SELECT p.*, s.name AS configured_source_name
    FROM private_opportunities p LEFT JOIN private_opportunity_sources s ON s.id = p.source_id
    WHERE ${selector}`).get(identifier));
}

export function searchPrivateOpportunities(filters = {}) {
  const page = clampInt(filters.page, 1, 1, 100000);
  const pageSize = clampInt(filters.page_size, 100, 1, 100);
  const where = [];
  const values = [];
  if (filters.keyword) {
    where.push('(p.title LIKE ? OR p.description LIKE ? OR p.company LIKE ? OR p.required_services_json LIKE ?)');
    const keyword = `%${String(filters.keyword).trim()}%`;
    values.push(keyword, keyword, keyword, keyword);
  }
  for (const [key, column] of [['country','p.country'], ['state','p.state'], ['city','p.city'], ['industry','p.industry'], ['status','p.status'], ['source','p.source_name']]) {
    if (filters[key]) { where.push(`${column} = ?`); values.push(String(filters[key])); }
  }
  if (filters.service) { where.push('p.required_services_json LIKE ?'); values.push(`%${String(filters.service)}%`); }
  if (filters.source_id) { where.push('p.source_id = ?'); values.push(Number(filters.source_id)); }
  if (filters.min_budget !== undefined && filters.min_budget !== '') { where.push('p.budget_value >= ?'); values.push(Number(filters.min_budget)); }
  if (filters.max_budget !== undefined && filters.max_budget !== '') { where.push('p.budget_value <= ?'); values.push(Number(filters.max_budget)); }
  if (filters.deadline_before) { where.push('p.deadline <= ?'); values.push(normalizeIsoDate(filters.deadline_before) || filters.deadline_before); }
  if (filters.deadline_after) { where.push('p.deadline >= ?'); values.push(normalizeIsoDate(filters.deadline_after) || filters.deadline_after); }
  if (filters.min_score !== undefined && filters.min_score !== '') { where.push('p.match_score >= ?'); values.push(Number(filters.min_score)); }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const count = db.prepare(`SELECT COUNT(*) AS total FROM private_opportunities p ${whereSql}`).get(...values).total;
  const [sortKey, sortDirection] = String(filters.sort || 'updated:desc').split(':');
  const column = SORT_COLUMNS[sortKey] || 'p.updated_at';
  const direction = sortDirection === 'asc' ? 'ASC' : 'DESC';
  const rows = db.prepare(`SELECT p.*, s.name AS configured_source_name FROM private_opportunities p
    LEFT JOIN private_opportunity_sources s ON s.id = p.source_id
    ${whereSql} ORDER BY ${column} ${direction}, p.id DESC LIMIT ? OFFSET ?`).all(...values, pageSize, (page - 1) * pageSize);
  return { items: rows.map(serializeOpportunity), pagination: { page, page_size: pageSize, total: count, pages: Math.max(1, Math.ceil(count / pageSize)) } };
}

export function privateOpportunityDashboard() {
  const value = (sql, ...params) => db.prepare(sql).get(...params).value || 0;
  return {
    total_opportunities: value('SELECT COUNT(*) AS value FROM private_opportunities'),
    new_today: value("SELECT COUNT(*) AS value FROM private_opportunities WHERE date(created_at) = date('now')"),
    closing_soon: value("SELECT COUNT(*) AS value FROM private_opportunities WHERE deadline BETWEEN CURRENT_TIMESTAMP AND datetime('now', '+14 days')"),
    amc_opportunities: value("SELECT COUNT(*) AS value FROM private_opportunities WHERE required_services_json LIKE '%AMC%' OR title LIKE '%AMC%' OR description LIKE '%annual maintenance%'"),
    rope_access_opportunities: value("SELECT COUNT(*) AS value FROM private_opportunities WHERE required_services_json LIKE '%Rope Access%'"),
    building_maintenance_opportunities: value("SELECT COUNT(*) AS value FROM private_opportunities WHERE required_services_json LIKE '%Building Maintenance%' OR industry LIKE '%Building%'"),
    high_priority: value("SELECT COUNT(*) AS value FROM private_opportunities WHERE priority = 'High' OR match_score >= 80"),
    ai_matches: value('SELECT COUNT(*) AS value FROM private_opportunities WHERE match_score >= 55'),
    sources: db.prepare('SELECT * FROM private_opportunity_sources ORDER BY name').all().map(serializeSource),
    recent: searchPrivateOpportunities({ page_size: 10 }).items
  };
}

export function privateFilterOptions() {
  const distinct = (column) => db.prepare(`SELECT DISTINCT ${column} AS value FROM private_opportunities WHERE ${column} IS NOT NULL AND ${column} <> '' ORDER BY value`).all().map((row) => row.value);
  return {
    countries: distinct('country'),
    states: distinct('state'),
    cities: distinct('city'),
    industries: distinct('industry'),
    statuses: distinct('status'),
    services: SERVICE_RULES.map(([service]) => service),
    sources: db.prepare('SELECT id, name, source_type, country FROM private_opportunity_sources ORDER BY name').all(),
    target_industries: TARGET_INDUSTRIES
  };
}

export function listPrivateSources() {
  return db.prepare('SELECT * FROM private_opportunity_sources ORDER BY name').all().map(serializeSource);
}

export function createPrivateSource(input) {
  if (!input.name) throw Object.assign(new Error('Source name is required'), { status: 400 });
  if (!input.source_url) throw Object.assign(new Error('Source URL is required'), { status: 400 });
  const sourceType = SOURCE_TYPES.has(input.source_type) ? input.source_type : 'procurement_portal';
  const result = db.prepare(`INSERT INTO private_opportunity_sources(
    name, source_type, source_url, endpoint_url, country, state, city, industry,
    authentication_type, api_key_env, headers_json, parser_config_json, schedule,
    rate_limit_ms, is_active, scheduler_status
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    String(input.name).trim(), sourceType, String(input.source_url).trim(), input.endpoint_url || input.api_url || null,
    input.country || 'Worldwide', input.state || null, input.city || null, input.industry || null,
    input.authentication_type || 'none', input.api_key_env || null, JSON.stringify(input.headers || {}),
    JSON.stringify(input.parser_config || {}), input.schedule || 'hourly', Number(input.rate_limit_ms || 0),
    Number(Boolean(input.is_active)), input.is_active ? 'scheduled' : 'disabled'
  );
  logPrivateSource(result.lastInsertRowid, 'source.create', 'info', 'Private opportunity source created', { name: input.name });
  return getPrivateSource(Number(result.lastInsertRowid));
}

export function getPrivateSource(id) {
  return serializeSource(db.prepare('SELECT * FROM private_opportunity_sources WHERE id = ?').get(id));
}

export function updatePrivateSource(id, input) {
  const existing = getPrivateSource(id);
  if (!existing) throw Object.assign(new Error('Private source not found'), { status: 404 });
  db.prepare(`UPDATE private_opportunity_sources SET
    name = COALESCE(?, name), source_type = COALESCE(?, source_type), source_url = COALESCE(?, source_url),
    endpoint_url = COALESCE(?, endpoint_url), country = COALESCE(?, country), state = COALESCE(?, state),
    city = COALESCE(?, city), industry = COALESCE(?, industry), authentication_type = COALESCE(?, authentication_type),
    api_key_env = COALESCE(?, api_key_env), headers_json = COALESCE(?, headers_json),
    parser_config_json = COALESCE(?, parser_config_json), schedule = COALESCE(?, schedule),
    rate_limit_ms = COALESCE(?, rate_limit_ms), is_active = COALESCE(?, is_active),
    scheduler_status = CASE WHEN COALESCE(?, is_active) = 1 THEN 'scheduled' ELSE 'disabled' END,
    updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(
      input.name ?? null, input.source_type ?? null, input.source_url ?? null, input.endpoint_url ?? input.api_url ?? null,
      input.country ?? null, input.state ?? null, input.city ?? null, input.industry ?? null,
      input.authentication_type ?? null, input.api_key_env ?? null,
      input.headers ? JSON.stringify(input.headers) : null, input.parser_config ? JSON.stringify(input.parser_config) : null,
      input.schedule ?? null, input.rate_limit_ms === undefined ? null : Number(input.rate_limit_ms),
      input.is_active === undefined ? null : Number(Boolean(input.is_active)),
      input.is_active === undefined ? null : Number(Boolean(input.is_active)), id
    );
  logPrivateSource(id, 'source.update', 'info', 'Private opportunity source updated', input);
  return getPrivateSource(id);
}

export function deletePrivateSource(id) {
  db.prepare('DELETE FROM private_opportunity_sources WHERE id = ?').run(id);
  return true;
}

function sourceHeaders(source) {
  const headers = parseJson(source.headers_json, {});
  if (source.api_key_env && process.env[source.api_key_env]) headers.authorization = headers.authorization || `Bearer ${process.env[source.api_key_env]}`;
  return headers;
}

async function downloadSource(source) {
  const target = source.endpoint_url || source.source_url;
  if (!target) throw Object.assign(new Error('Add an official API/feed endpoint before importing.'), { status: 400 });
  if (source.api_key_env && !process.env[source.api_key_env]) throw Object.assign(new Error(`Requires API key environment variable ${source.api_key_env}`), { status: 400, code: 'REQUIRES_API_KEY' });
  const started = Date.now();
  const response = await fetch(target, { headers: sourceHeaders(source), redirect: 'follow' });
  const text = await response.text();
  return { response, text, duration: Date.now() - started, target };
}

function csvRows(text) {
  const rows = [];
  let current = [];
  let cell = '';
  let quoted = false;
  for (let index = 0; index < text.length; index++) {
    const character = text[index];
    if (character === '"' && text[index + 1] === '"') { cell += '"'; index++; continue; }
    if (character === '"') { quoted = !quoted; continue; }
    if (character === ',' && !quoted) { current.push(cell); cell = ''; continue; }
    if ((character === '\n' || character === '\r') && !quoted) {
      if (cell || current.length) { current.push(cell); rows.push(current); current = []; cell = ''; }
      if (character === '\r' && text[index + 1] === '\n') index++;
      continue;
    }
    cell += character;
  }
  if (cell || current.length) { current.push(cell); rows.push(current); }
  const headers = rows.shift()?.map((item) => item.trim()) || [];
  return rows.map((row) => Object.fromEntries(headers.map((header, index) => [header, row[index] || ''])));
}

function xmlItems(text) {
  const blocks = [...text.matchAll(/<(item|entry)\b[\s\S]*?<\/\1>/gi)].map((match) => match[0]);
  const tag = (block, name) => block.match(new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)<\\/${name}>`, 'i'))?.[1]?.replace(/<!\[CDATA\[|\]\]>/g, '').replace(/<[^>]+>/g, '').trim();
  const link = (block) => block.match(/<link[^>]+href=["']([^"']+)["']/i)?.[1] || tag(block, 'link');
  return blocks.map((block) => ({
    id: tag(block, 'guid') || tag(block, 'id') || link(block),
    title: tag(block, 'title'),
    description: tag(block, 'description') || tag(block, 'summary') || tag(block, 'content'),
    link: link(block),
    published: tag(block, 'pubDate') || tag(block, 'published') || tag(block, 'updated')
  }));
}

function jsonItems(text, parserConfig = {}) {
  const parsed = JSON.parse(text);
  if (Array.isArray(parsed)) return parsed;
  const fromPath = getPath(parsed, parserConfig.items_path);
  if (Array.isArray(fromPath)) return fromPath;
  for (const key of ['items', 'results', 'data', 'opportunities', 'notices']) if (Array.isArray(parsed[key])) return parsed[key];
  return [parsed];
}

function resolveUrl(value, base) {
  if (!value) return base;
  try { return new URL(value, base).toString(); } catch { return value; }
}

function parseSourceItems(source, text) {
  const parserConfig = parseJson(source.parser_config_json, {});
  const format = parserConfig.parser_type || source.source_type;
  if (format === 'csv' || source.source_type === 'csv') return csvRows(text);
  if (['rss', 'xml'].includes(format) || ['rss', 'xml'].includes(source.source_type)) return xmlItems(text);
  if (format === 'json' || source.source_type === 'json' || source.endpoint_url) return jsonItems(text, parserConfig);
  return [];
}

function mapItem(item, source) {
  const parserConfig = parseJson(source.parser_config_json, {});
  const fieldMap = parserConfig.field_map || {};
  const get = (field, fallbacks = []) => {
    const keys = [fieldMap[field], ...fallbacks].filter(Boolean);
    for (const key of keys) {
      const value = getPath(item, key);
      if (value !== undefined && value !== null && String(value).trim() !== '') return value;
    }
    return '';
  };
  const sourceUrl = resolveUrl(get('source_url', ['source_url', 'url', 'link', 'href']), source.source_url);
  return {
    source_id: source.id,
    external_id: get('external_id', ['id', 'guid', 'reference', 'reference_number']) || sourceUrl,
    company: get('company', ['company', 'buyer', 'buyer_name', 'organization', 'organisation']) || source.name,
    title: get('title', ['title', 'name', 'subject']) || source.name,
    description: get('description', ['description', 'summary', 'details', 'content']) || get('title', ['title']),
    building_type: get('building_type', ['building_type', 'property_type']),
    required_services: list(get('required_services', ['services', 'service'])),
    industry: get('industry', ['industry', 'sector']) || source.industry || 'Commercial Building Maintenance',
    country: get('country', ['country']) || source.country || 'Worldwide',
    state: get('state', ['state', 'region']) || source.state || '',
    city: get('city', ['city']) || source.city || '',
    budget_value: get('budget_value', ['budget', 'value', 'estimated_value']),
    currency: get('currency', ['currency']),
    deadline: get('deadline', ['deadline', 'closing_date', 'submission_deadline']),
    posted_date: get('posted_date', ['posted_date', 'published', 'pubDate', 'publication_date']),
    source_name: source.name,
    source_url: sourceUrl,
    vendor_registration_url: get('vendor_registration_url', ['vendor_registration_url', 'registration_url']) || null,
    original_source_url: sourceUrl,
    metadata: item
  };
}

function upsertPrivateOpportunity(input) {
  if (input.source_id && input.external_id) {
    const existing = db.prepare('SELECT * FROM private_opportunities WHERE source_id = ? AND external_id = ?').get(input.source_id, input.external_id);
    if (existing) return { action: 'updated', opportunity: updatePrivateOpportunity(existing.id, input) };
  }
  if (input.source_id && input.original_source_url) {
    const existing = db.prepare('SELECT * FROM private_opportunities WHERE source_id = ? AND lower(trim(original_source_url)) = lower(trim(?))').get(input.source_id, input.original_source_url);
    if (existing) return { action: 'updated', opportunity: updatePrivateOpportunity(existing.id, input) };
  }
  const duplicateKey = input.duplicate_key || slugify([input.original_source_url, input.title, input.company].filter(Boolean).join(' '));
  const duplicate = db.prepare('SELECT * FROM private_opportunities WHERE duplicate_key = ?').get(duplicateKey);
  if (duplicate) return { action: 'duplicate', opportunity: getPrivateOpportunity(duplicate.id) };
  return { action: 'created', opportunity: createPrivateOpportunity({ ...input, duplicate_key: duplicateKey }) };
}

export function logPrivateSource(sourceId, action, level, message, metadata = {}) {
  db.prepare(`INSERT INTO private_opportunity_source_logs(source_id, action, level, message, metadata_json)
    VALUES (?, ?, ?, ?, ?)`).run(sourceId || null, action, level, message, JSON.stringify(metadata));
}

export function privateSourceLogs(sourceId, limit = 50) {
  return db.prepare('SELECT * FROM private_opportunity_source_logs WHERE source_id = ? ORDER BY created_at DESC LIMIT ?').all(sourceId, clampInt(limit, 50, 1, 200))
    .map((row) => ({ ...row, metadata: parseJson(row.metadata_json, {}) }));
}

export async function testPrivateSource(id) {
  const source = db.prepare('SELECT * FROM private_opportunity_sources WHERE id = ?').get(id);
  if (!source) throw Object.assign(new Error('Private source not found'), { status: 404 });
  try {
    const { response, text, duration, target } = await downloadSource(source);
    const sample = parseSourceItems(source, text).slice(0, 5).map((item) => mapItem(item, source));
    const ok = response.ok && sample.length > 0;
    db.prepare(`UPDATE private_opportunity_sources SET last_test_status = ?, last_http_status = ?, last_response_time_ms = ?,
      last_failure_reason = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
      .run(ok ? 'ok' : 'requires_mapping', response.status, duration, ok ? null : 'Connection succeeded but no importable opportunities were detected. Check parser mapping.', id);
    logPrivateSource(id, 'source.test', ok ? 'info' : 'warning', ok ? 'Private source test passed' : 'Private source test needs parser mapping', { http_status: response.status, response_time_ms: duration, endpoint: target, samples: sample.length });
    return { ok, http_status: response.status, response_time_ms: duration, sample_opportunities: sample, message: ok ? 'Connection and parser validation passed.' : 'Connection succeeded but parser mapping needs review.' };
  } catch (error) {
    db.prepare(`UPDATE private_opportunity_sources SET last_test_status = 'failed', failures = failures + 1, last_failure_reason = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(error.message, id);
    logPrivateSource(id, 'source.test', 'error', error.message, { code: error.code });
    return { ok: false, http_status: error.status || null, response_time_ms: null, sample_opportunities: [], error: error.message, code: error.code };
  }
}

export async function importPrivateSource(id) {
  const source = db.prepare('SELECT * FROM private_opportunity_sources WHERE id = ?').get(id);
  if (!source) throw Object.assign(new Error('Private source not found'), { status: 404 });
  const started = Date.now();
  try {
    const { response, text, duration } = await downloadSource(source);
    if (!response.ok) throw Object.assign(new Error(`HTTP ${response.status}`), { status: response.status });
    const items = parseSourceItems(source, text);
    let imported = 0;
    let updated = 0;
    let duplicates = 0;
    const failures = [];
    for (const item of items) {
      try {
        const result = upsertPrivateOpportunity(mapItem(item, source));
        if (result.action === 'created') imported++;
        else if (result.action === 'updated') updated++;
        else duplicates++;
      } catch (error) {
        failures.push(error.message);
      }
    }
    db.prepare(`UPDATE private_opportunity_sources SET last_run_at = CURRENT_TIMESTAMP,
      last_success_at = CASE WHEN ? = 0 THEN CURRENT_TIMESTAMP ELSE last_success_at END,
      last_test_status = CASE WHEN ? = 0 THEN 'ok' ELSE 'partial' END,
      last_http_status = ?, last_response_time_ms = ?, opportunities_imported = opportunities_imported + ?,
      failures = failures + ?, last_failure_reason = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
      .run(failures.length, failures.length, response.status, duration, imported + updated, failures.length, failures[0] || null, id);
    logPrivateSource(id, 'source.import', failures.length ? 'warning' : 'info', `Imported ${imported}, updated ${updated}, duplicates ${duplicates}`, { imported, updated, duplicates, failures, duration_ms: Date.now() - started });
    return { imported, updated, duplicates_skipped: duplicates, failures, duration_ms: Date.now() - started };
  } catch (error) {
    db.prepare(`UPDATE private_opportunity_sources SET last_run_at = CURRENT_TIMESTAMP, last_test_status = 'failed',
      failures = failures + 1, last_failure_reason = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(error.message, id);
    logPrivateSource(id, 'source.import', 'error', error.message, { code: error.code });
    throw error;
  }
}
