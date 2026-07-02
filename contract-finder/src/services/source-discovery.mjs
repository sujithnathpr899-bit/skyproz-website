import { db, parseJson } from '../db.mjs';
import { listConnectorTemplates } from '../connectors/template-catalog.mjs';

const FIELD_CANDIDATES = {
  title: ['title', 'name', 'subject', 'bid_description', 'notice_title'],
  description: ['description', 'summary', 'details', 'notice_text', 'scope'],
  buyer: ['buyer', 'buyer_name', 'agency', 'organization', 'contact_organization'],
  country: ['country', 'project_ctry_name', 'location_country'],
  deadline: ['deadline', 'closing_date', 'submission_deadline_date', 'due_date'],
  budget: ['budget', 'budget_value', 'estimated_value', 'amount'],
  currency: ['currency', 'currency_code'],
  attachments: ['attachments', 'documents', 'files'],
  documents: ['documents', 'attachments', 'files'],
  source_url: ['source_url', 'url', 'link', 'detail_url'],
  published_date: ['posted_date', 'published', 'publication_date', 'submission_date'],
  category: ['category', 'industry', 'procurement_group', 'notice_type']
};

function keysFromObject(value, prefix = '') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  return Object.entries(value).flatMap(([key, child]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    if (child && typeof child === 'object' && !Array.isArray(child)) return [path, ...keysFromObject(child, path)];
    return [path];
  });
}

function bestFieldMatch(keys, candidates) {
  const normalized = keys.map((key) => [key, key.toLowerCase().replace(/[^a-z0-9]/g, '')]);
  for (const candidate of candidates) {
    const compact = candidate.toLowerCase().replace(/[^a-z0-9]/g, '');
    const exact = normalized.find(([, key]) => key === compact);
    if (exact) return exact[0];
  }
  for (const candidate of candidates) {
    const compact = candidate.toLowerCase().replace(/[^a-z0-9]/g, '');
    const partial = normalized.find(([, key]) => key.includes(compact) || compact.includes(key));
    if (partial) return partial[0];
  }
  return null;
}

export function inferFieldMappingFromSamples(samples = [], parserConfig = {}) {
  const configured = parserConfig.field_map || {};
  const keys = [...new Set(samples.flatMap((sample) => keysFromObject(sample)))];
  const mapping = {};
  for (const [target, candidates] of Object.entries(FIELD_CANDIDATES)) {
    mapping[target] = configured[target] || bestFieldMatch(keys, candidates) || null;
  }
  const matched = Object.values(mapping).filter(Boolean).length;
  return {
    mapping,
    confidence: Math.round((matched / Object.keys(FIELD_CANDIDATES).length) * 100),
    detected_fields: keys.slice(0, 80),
    admin_override_allowed: true
  };
}

function endpointAvailability(source) {
  const parserConfig = parseJson(source.parser_config_json, {});
  const format = String(source.source_format || parserConfig.parser_type || source.parser_type || '').toLowerCase();
  const apiUrl = Boolean(source.api_url);
  return {
    official_api_available: apiUrl && format === 'rest',
    rss_available: apiUrl && format === 'rss',
    xml_available: apiUrl && format === 'xml',
    json_available: apiUrl && (format === 'json' || format === 'rest'),
    csv_available: apiUrl && format === 'csv',
    configured_endpoint: source.api_url || null,
    source_page: source.source_url || null
  };
}

function authMetadata(source) {
  const auth = parseJson(source.auth_config_json, {});
  const parserConfig = parseJson(source.parser_config_json, {});
  const keys = [source.api_key_env, auth.api_key_env, parserConfig.api_key_env, auth.bearer_token_env, parserConfig.bearer_token_env].filter(Boolean);
  return {
    authentication_required: keys.length > 0,
    required_api_keys: [...new Set(keys)]
  };
}

export function calculateHealthScore(source) {
  let score = 0;
  if (source.is_active) score += 10;
  if (source.api_url) score += 15;
  if (source.last_status === 'ok') score += 45;
  if (source.last_status === 'warning') score += 25;
  if (source.last_status === 'failed') score -= 20;
  if (source.last_success_at) score += 15;
  if (Number(source.last_duration_ms || 0) > 0 && Number(source.last_duration_ms) <= 3000) score += 10;
  if (Number(source.failure_count || 0) === 0) score += 5;
  return Math.max(0, Math.min(100, score));
}

export function calculateQualityScore(source, fieldMapping = {}) {
  const endpoints = endpointAvailability(source);
  const officialSource = Boolean(source.source_url || source.api_url);
  const fieldCompleteness = Object.values(fieldMapping.mapping || {}).filter(Boolean).length / Object.keys(FIELD_CANDIDATES).length;
  const reliability = source.last_status === 'ok' ? 1 : source.last_status === 'failed' ? 0 : 0.35;
  const freshness = source.last_success_at ? 1 : 0.25;
  const endpointConfidence = Object.entries(endpoints).some(([, value]) => value === true) ? 1 : 0.25;
  return Math.round((
    (officialSource ? 20 : 0) +
    (fieldCompleteness * 25) +
    (reliability * 25) +
    (freshness * 15) +
    (endpointConfidence * 15)
  ));
}

function sourceStatus(source, auth) {
  if (!source.api_url && !source.source_url) return 'requires_configuration';
  if (auth.authentication_required && auth.required_api_keys.some((key) => !key)) return 'needs_api_key';
  if (source.last_status === 'ok') return 'verified';
  if (source.last_status === 'failed') return 'broken';
  if (source.api_key_env) return 'needs_api_key';
  if (source.api_url) return 'ready_to_test';
  return 'requires_configuration';
}

function sourceDiscoveryRecord(source) {
  const samples = parseJson(source.sample_contracts_json, []);
  const parserConfig = parseJson(source.parser_config_json, {});
  const fieldMapping = inferFieldMappingFromSamples(samples.map((item) => item.source_metadata || item), parserConfig);
  const auth = authMetadata(source);
  const endpoints = endpointAvailability(source);
  const healthScore = calculateHealthScore(source);
  const qualityScore = calculateQualityScore(source, fieldMapping);
  const status = sourceStatus(source, auth);
  return {
    template_id: `source:${source.id}`,
    name: source.name,
    group_name: source.source_type === 'private' ? 'Private Configured Source' : 'Government Configured Source',
    source_id: source.id,
    source_url: source.source_url || null,
    api_documentation_url: parseJson(source.metadata_json, {}).api_documentation_url || null,
    country: source.country || 'Worldwide',
    industry: parseJson(source.metadata_json, {}).industry || 'Procurement',
    status,
    endpoint_availability: endpoints,
    authentication_required: auth.authentication_required,
    required_api_keys: auth.required_api_keys,
    rate_limit: source.rate_limit_ms ? `${source.rate_limit_ms} ms` : null,
    pagination: parseJson(source.pagination_config_json, {}),
    field_mapping: fieldMapping,
    health_score: healthScore,
    quality_score: qualityScore,
    ai_confidence: fieldMapping.confidence,
    last_verified_at: source.last_tested_at || source.last_success_at || null,
    verification_error: source.last_error || null,
    metadata: {
      connector_key: source.connector_key || source.parser_type || 'json',
      source_format: source.source_format || parserConfig.parser_type || 'json',
      availability: source.last_status || 'not_tested',
      last_successful_sync: source.last_success_at,
      contracts_imported: source.contracts_imported || 0,
      failures: source.failure_count || 0,
      sample_contracts: samples
    }
  };
}

function templateDiscoveryRecord(template) {
  return {
    template_id: template.id,
    name: template.name,
    group_name: template.group,
    source_id: null,
    source_url: null,
    api_documentation_url: null,
    country: template.country,
    industry: template.group,
    status: 'requires_configuration',
    endpoint_availability: {
      official_api_available: false,
      rss_available: false,
      xml_available: false,
      json_available: false,
      csv_available: false,
      configured_endpoint: null,
      source_page: null
    },
    authentication_required: false,
    required_api_keys: [],
    rate_limit: null,
    pagination: {},
    field_mapping: { mapping: {}, confidence: 0, detected_fields: [], admin_override_allowed: true },
    health_score: 0,
    quality_score: 0,
    ai_confidence: 0,
    last_verified_at: null,
    verification_error: template.failure_reason,
    metadata: template
  };
}

function saveDiscoveryRecord(record) {
  db.prepare(`INSERT INTO source_discovery_results(template_id, name, group_name, source_id, source_url,
    api_documentation_url, country, industry, status, endpoint_availability_json, authentication_required,
    required_api_keys_json, rate_limit, pagination_json, field_mapping_json, health_score, quality_score,
    ai_confidence, last_verified_at, verification_error, metadata_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(template_id) DO UPDATE SET
      name = excluded.name,
      group_name = excluded.group_name,
      source_id = excluded.source_id,
      source_url = excluded.source_url,
      api_documentation_url = excluded.api_documentation_url,
      country = excluded.country,
      industry = excluded.industry,
      status = excluded.status,
      endpoint_availability_json = excluded.endpoint_availability_json,
      authentication_required = excluded.authentication_required,
      required_api_keys_json = excluded.required_api_keys_json,
      rate_limit = excluded.rate_limit,
      pagination_json = excluded.pagination_json,
      field_mapping_json = excluded.field_mapping_json,
      health_score = excluded.health_score,
      quality_score = excluded.quality_score,
      ai_confidence = excluded.ai_confidence,
      last_verified_at = excluded.last_verified_at,
      verification_error = excluded.verification_error,
      metadata_json = excluded.metadata_json,
      updated_at = CURRENT_TIMESTAMP`)
    .run(
      record.template_id,
      record.name,
      record.group_name,
      record.source_id,
      record.source_url,
      record.api_documentation_url,
      record.country,
      record.industry,
      record.status,
      JSON.stringify(record.endpoint_availability),
      Number(record.authentication_required),
      JSON.stringify(record.required_api_keys),
      record.rate_limit,
      JSON.stringify(record.pagination),
      JSON.stringify(record.field_mapping),
      record.health_score,
      record.quality_score,
      record.ai_confidence,
      record.last_verified_at,
      record.verification_error,
      JSON.stringify(record.metadata)
    );
  if (record.source_id) {
    db.prepare(`UPDATE contract_sources SET discovery_metadata_json = ?, field_mapping_json = ?,
      health_score = ?, quality_score = ?, availability_status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
      .run(JSON.stringify(record.metadata), JSON.stringify(record.field_mapping), record.health_score, record.quality_score, record.status, record.source_id);
  }
}

export function runSourceDiscovery() {
  const sources = db.prepare('SELECT * FROM contract_sources ORDER BY name').all();
  const records = [
    ...sources.map(sourceDiscoveryRecord),
    ...listConnectorTemplates().map(templateDiscoveryRecord)
  ];
  for (const record of records) saveDiscoveryRecord(record);
  return discoverySnapshot();
}

function serializeDiscovery(row) {
  return {
    ...row,
    endpoint_availability: parseJson(row.endpoint_availability_json, {}),
    required_api_keys: parseJson(row.required_api_keys_json, []),
    pagination: parseJson(row.pagination_json, {}),
    field_mapping: parseJson(row.field_mapping_json, {}),
    metadata: parseJson(row.metadata_json, {}),
    authentication_required: Boolean(row.authentication_required)
  };
}

export function discoverySnapshot() {
  const items = db.prepare('SELECT * FROM source_discovery_results ORDER BY group_name, name').all().map(serializeDiscovery);
  const count = (predicate) => items.filter(predicate).length;
  const endpoints = items.map((item) => item.endpoint_availability || {});
  return {
    summary: {
      total: items.length,
      verified: count((item) => item.status === 'verified'),
      requires_configuration: count((item) => item.status === 'requires_configuration'),
      needs_api_key: count((item) => item.status === 'needs_api_key'),
      broken: count((item) => item.status === 'broken'),
      ready_to_test: count((item) => item.status === 'ready_to_test'),
      official_api_available: endpoints.filter((item) => item.official_api_available).length,
      rss_available: endpoints.filter((item) => item.rss_available).length,
      xml_available: endpoints.filter((item) => item.xml_available).length,
      json_available: endpoints.filter((item) => item.json_available).length,
      csv_available: endpoints.filter((item) => item.csv_available).length
    },
    items
  };
}

export function marketplaceSnapshot() {
  const discovery = runSourceDiscovery();
  const items = discovery.items.map((item) => ({
    id: item.template_id,
    source_id: item.source_id,
    name: item.name,
    group: item.group_name,
    official_api_available: Boolean(item.endpoint_availability.official_api_available),
    rss_available: Boolean(item.endpoint_availability.rss_available),
    json_available: Boolean(item.endpoint_availability.json_available),
    xml_available: Boolean(item.endpoint_availability.xml_available),
    csv_available: Boolean(item.endpoint_availability.csv_available),
    authentication_required: item.authentication_required,
    api_documentation: item.api_documentation_url,
    country: item.country,
    industry: item.industry,
    status: item.status,
    install_supported: item.status === 'ready_to_test' || item.status === 'verified',
    one_click_install: false,
    compliance_note: item.metadata?.compliance_note || 'Install only after adding official source configuration.'
  }));
  return { summary: discovery.summary, items };
}

export function importAnalytics() {
  return {
    working_connectors: db.prepare("SELECT COUNT(*) AS count FROM contract_sources WHERE is_active = 1 AND last_status = 'ok'").get().count,
    broken_connectors: db.prepare("SELECT COUNT(*) AS count FROM contract_sources WHERE is_active = 1 AND last_status = 'failed'").get().count,
    needs_configuration: db.prepare("SELECT COUNT(*) AS count FROM source_discovery_results WHERE status = 'requires_configuration'").get().count,
    needs_api_key: db.prepare("SELECT COUNT(*) AS count FROM source_discovery_results WHERE status = 'needs_api_key'").get().count,
    contracts_today: db.prepare("SELECT COALESCE(SUM(imported_count + updated_count), 0) AS count FROM import_runs WHERE status = 'completed' AND date(started_at) = date('now')").get().count,
    contracts_this_week: db.prepare("SELECT COALESCE(SUM(imported_count + updated_count), 0) AS count FROM import_runs WHERE status = 'completed' AND started_at >= datetime('now', '-7 days')").get().count,
    average_import_time: db.prepare("SELECT ROUND(AVG(duration_ms), 0) AS value FROM import_runs WHERE status = 'completed' AND duration_ms IS NOT NULL").get().value || 0,
    average_ai_score: db.prepare('SELECT ROUND(AVG(ai_score), 0) AS value FROM contracts WHERE ai_score > 0').get().value || 0,
    duplicates_removed: db.prepare('SELECT COALESCE(SUM(duplicates_removed), 0) AS value FROM duplicate_merge_runs').get().value || 0,
    scheduler_health: db.prepare('SELECT status FROM scheduler_runs ORDER BY started_at DESC LIMIT 1').get()?.status || 'not_run'
  };
}
