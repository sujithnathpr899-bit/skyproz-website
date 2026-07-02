import dns from 'node:dns/promises';
import { db, parseJson } from '../db.mjs';
import { getConnector, listConnectors } from '../connectors/index.mjs';
import { listConnectorTemplates } from '../connectors/template-catalog.mjs';
import { importSource, testSourceConnection } from './importer.mjs';
import { inferFieldMappingFromSamples, runSourceDiscovery } from './source-discovery.mjs';
import { tedSearchRequest } from '../connectors/ted.mjs';

const USER_AGENT = 'SkyprozContractFinder/2.0 (+https://skyproz.in)';

function parseMaybeJson(value, fallback = {}) {
  if (value && typeof value === 'object') return value;
  return parseJson(value, fallback);
}

function clean(value) {
  return String(value || '').trim();
}

function endpointFromBody(body = {}) {
  return clean(body.api_url || body.rss_url || body.xml_url || body.json_url || body.csv_url || body.source_url);
}

function formatFromBody(body = {}) {
  if (body.rss_url) return 'rss';
  if (body.xml_url) return 'xml';
  if (body.json_url) return 'json';
  if (body.csv_url) return 'csv';
  return clean(body.source_format || body.parser_type || 'rest').toLowerCase();
}

function parserTypeFor(format) {
  return format === 'manual' ? 'manual' : 'json';
}

function parserConfigTypeFor(format) {
  return format === 'rest' ? 'json' : format;
}

function sourceById(sourceId) {
  return sourceId ? db.prepare('SELECT * FROM contract_sources WHERE id = ?').get(sourceId) : null;
}

function metadataFor(source = {}, extra = {}) {
  const existingMetadata = parseJson(source?.metadata_json, {});
  return {
    ...existingMetadata,
    ...parseMaybeJson(extra.metadata, {}),
    api_documentation_url: clean(extra.api_documentation_url) || existingMetadata.api_documentation_url || null,
    compliance_note: clean(extra.compliance_note) || existingMetadata.compliance_note || 'Use only official APIs, public feeds, or permitted public interfaces.'
  };
}

export function buildWizardSource(body = {}) {
  const existing = sourceById(body.source_id);
  const sourceFormat = formatFromBody({ ...existing, ...body });
  const parserConfig = {
    ...parseJson(existing?.parser_config_json, {}),
    ...parseMaybeJson(body.parser_config, {}),
    parser_type: parserConfigTypeFor(sourceFormat),
    field_map: parseMaybeJson(body.field_mapping, parseJson(existing?.field_mapping_json, {}).mapping || parseJson(existing?.parser_config_json, {}).field_map || {})
  };
  if (body.items_path) parserConfig.items_path = clean(body.items_path);
  if (body.limit) parserConfig.limit = Number(body.limit);
  if (body.request_method) parserConfig.request_method = clean(body.request_method).toUpperCase();

  const headers = {
    ...parseJson(existing?.headers_json, {}),
    ...parseMaybeJson(body.headers, {})
  };
  const apiKeyEnv = clean(body.api_key_env || existing?.api_key_env);
  const authConfig = {
    ...parseJson(existing?.auth_config_json, {}),
    ...parseMaybeJson(body.auth_config, {})
  };
  if (apiKeyEnv) authConfig.api_key_env = apiKeyEnv;
  if (body.api_key_header) authConfig.api_key_header = clean(body.api_key_header);
  if (body.oauth_client_id_env) authConfig.oauth_client_id_env = clean(body.oauth_client_id_env);
  if (body.oauth_client_secret_env) authConfig.oauth_client_secret_env = clean(body.oauth_client_secret_env);

  const apiUrl = endpointFromBody(body) || existing?.api_url || null;
  return {
    id: existing?.id || body.source_id || null,
    name: clean(body.name || existing?.name || 'Connector Wizard Source'),
    source_url: clean(body.source_url || existing?.source_url || apiUrl),
    api_url: apiUrl,
    country: clean(body.country || existing?.country || 'Worldwide'),
    region: clean(body.region || existing?.region || ''),
    source_type: clean(body.source_type || existing?.source_type || 'government'),
    parser_type: parserTypeFor(sourceFormat),
    parser_config_json: JSON.stringify(parserConfig),
    connector_key: clean(body.connector_key || existing?.connector_key || parserConfigTypeFor(sourceFormat) || 'json'),
    schedule: clean(body.schedule || existing?.schedule || 'daily'),
    metadata_json: JSON.stringify(metadataFor(existing, body)),
    source_format: sourceFormat,
    base_url: clean(body.base_url || existing?.base_url || ''),
    api_key_env: apiKeyEnv || null,
    headers_json: JSON.stringify(headers),
    auth_config_json: JSON.stringify(authConfig),
    pagination_config_json: JSON.stringify({
      ...parseJson(existing?.pagination_config_json, {}),
      ...parseMaybeJson(body.pagination_config, {})
    }),
    rate_limit_ms: Number(body.rate_limit_ms || existing?.rate_limit_ms || 0),
    is_active: Number(Boolean(body.enable))
  };
}

function authSummary(source = {}) {
  const auth = parseJson(source.auth_config_json, {});
  const parser = parseJson(source.parser_config_json, {});
  const keys = [source.api_key_env, auth.api_key_env, parser.api_key_env].filter(Boolean);
  const oauth = auth.oauth_client_id_env || auth.oauth_client_secret_env;
  if (oauth) return { type: 'OAuth', required: true, configured: Boolean(auth.oauth_client_id_env && auth.oauth_client_secret_env) };
  if (keys.length) return { type: 'API Key', required: true, configured: true, keys: [...new Set(keys)] };
  return { type: 'None detected', required: false, configured: true, keys: [] };
}

export function connectorWizardSnapshot() {
  const discovery = runSourceDiscovery();
  const sources = db.prepare('SELECT * FROM contract_sources ORDER BY name').all().map((source) => {
    const metadata = parseJson(source.metadata_json, {});
    const discoveryItem = discovery.items.find((item) => item.source_id === source.id);
    return {
      id: source.id,
      type: 'source',
      name: source.name,
      connector_key: source.connector_key || source.parser_type,
      country: source.country,
      region: source.region,
      source_type: source.source_type,
      source_url: source.source_url,
      api_url: source.api_url,
      source_format: source.source_format,
      schedule: source.schedule,
      base_url: source.base_url,
      api_key_env: source.api_key_env,
      rate_limit_ms: source.rate_limit_ms || 0,
      field_mapping: parseJson(source.parser_config_json, {}).field_map || parseJson(source.field_mapping_json, {}).mapping || {},
      status: discoveryItem?.status || 'requires_configuration',
      documentation_url: metadata.api_documentation_url || null,
      authentication: authSummary(source),
      last_sync: source.last_success_at || source.last_imported_at || null,
      last_failure: source.last_error || null,
      contracts_imported: source.contracts_imported || 0,
      health_score: discoveryItem?.health_score || 0,
      quality_score: discoveryItem?.quality_score || 0
    };
  });
  const existingNames = new Set(sources.map((source) => source.name.toLowerCase()));
  const templates = listConnectorTemplates()
    .filter((template) => !existingNames.has(template.name.toLowerCase()))
    .map((template) => ({
      id: template.id,
      type: 'template',
      name: template.name,
      connector_key: template.connector_key,
      country: template.country,
      region: template.region,
      source_type: template.source_type,
      source_url: null,
      api_url: null,
      source_format: template.source_format,
      schedule: 'hourly',
      base_url: null,
      api_key_env: null,
      rate_limit_ms: 0,
      field_mapping: {},
      status: 'requires_configuration',
      documentation_url: null,
      authentication: { type: 'Unknown', required: false, configured: false },
      last_sync: null,
      last_failure: template.failure_reason,
      contracts_imported: 0,
      health_score: 0,
      quality_score: 0
    }));
  return { connectors: listConnectors(), sources: [...sources, ...templates], summary: discovery.summary };
}

export function detectWizardSource(body = {}) {
  const source = sourceById(body.source_id);
  const template = body.template_id ? listConnectorTemplates().find((item) => item.id === body.template_id) : null;
  if (!source && !template) throw Object.assign(new Error('Connector not found'), { status: 404 });
  const metadata = source ? parseJson(source.metadata_json, {}) : template;
  return {
    source_id: source?.id || null,
    template_id: template?.id || null,
    name: source?.name || template?.name,
    connector_key: source?.connector_key || template?.connector_key || 'json',
    source_url: source?.source_url || template?.source_url || null,
    api_url: source?.api_url || template?.api_url || null,
    documentation_url: metadata.api_documentation_url || null,
    authentication: source ? authSummary(source) : { type: 'Unknown', required: false, configured: false },
    source_format: source?.source_format || template?.source_format || 'requires_configuration',
    pagination: source ? parseJson(source.pagination_config_json, {}) : {},
    message: source?.api_url
      ? 'Official endpoint is configured. You can test it now.'
      : 'No official endpoint is configured. Add only a documented API, RSS, XML, JSON, or CSV URL.'
  };
}

async function diagnoseUrl(source = {}) {
  const url = source.api_url || source.source_url;
  const result = {
    url: url || null,
    dns: { status: 'not_checked' },
    tls: { status: 'not_checked' },
    http_code: null,
    response_time_ms: null,
    response_size_bytes: 0,
    rate_limit: {},
    authentication_status: authSummary(source)
  };
  if (!url) return { ...result, error: 'No endpoint URL configured.' };

  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return { ...result, error: 'Endpoint URL is invalid.' };
  }

  try {
    const lookup = await dns.lookup(parsed.hostname);
    result.dns = { status: 'resolved', address: lookup.address, family: lookup.family };
  } catch (error) {
    result.dns = { status: 'failed', error: error.message };
  }

  const parser = parseJson(source.parser_config_json, {});
  const headers = {
    accept: source.source_format === 'rss' || source.source_format === 'xml' ? 'application/xml,text/xml,*/*' : source.source_format === 'csv' ? 'text/csv,*/*' : 'application/json,*/*',
    'user-agent': USER_AGENT,
    ...parseJson(source.headers_json, {})
  };
  const method = parser.request_method || (source.connector_key === 'ted' ? 'POST' : 'GET');
  const options = { method, headers };
  if (method === 'POST') {
    headers['content-type'] = headers['content-type'] || 'application/json';
    options.body = JSON.stringify(source.connector_key === 'ted' ? tedSearchRequest(source) : (parser.request_body || {}));
  }

  const started = Date.now();
  try {
    const response = await fetch(url, options);
    const buffer = await response.arrayBuffer();
    result.http_code = response.status;
    result.response_time_ms = Date.now() - started;
    result.response_size_bytes = buffer.byteLength;
    result.tls = parsed.protocol === 'https:' ? { status: 'verified', protocol: 'HTTPS' } : { status: 'not_applicable', protocol: parsed.protocol.replace(':', '').toUpperCase() };
    result.rate_limit = {
      retry_after: response.headers.get('retry-after'),
      limit: response.headers.get('x-ratelimit-limit') || response.headers.get('x-rate-limit-limit'),
      remaining: response.headers.get('x-ratelimit-remaining') || response.headers.get('x-rate-limit-remaining'),
      reset: response.headers.get('x-ratelimit-reset') || response.headers.get('x-rate-limit-reset')
    };
  } catch (error) {
    result.response_time_ms = Date.now() - started;
    result.tls = parsed.protocol === 'https:' ? { status: 'failed_or_unverified', protocol: 'HTTPS' } : { status: 'not_applicable' };
    result.error = error.message;
  }
  return result;
}

export async function testWizardConfiguration(body = {}) {
  const source = buildWizardSource(body);
  const connector = getConnector(source.connector_key || source.parser_type);
  const diagnostics = await diagnoseUrl(source);
  const test = await connector.testConnection(source);
  const samples = test.sample_contracts || [];
  const fieldMapping = inferFieldMappingFromSamples(samples, parseJson(source.parser_config_json, {}));
  return {
    source,
    diagnostics: {
      ...diagnostics,
      http_code: test.http_status || diagnostics.http_code || (test.ok ? 200 : null),
      authentication_status: diagnostics.authentication_status
    },
    test,
    field_mapping: fieldMapping,
    preview_contracts: samples
  };
}

function persistSource(source, enable = false) {
  if (source.id) {
    db.prepare(`UPDATE contract_sources SET name = ?, source_url = ?, api_url = ?, country = ?, region = ?,
      source_type = ?, parser_type = ?, parser_config_json = ?, connector_key = ?, schedule = ?, metadata_json = ?,
      source_format = ?, base_url = ?, api_key_env = ?, headers_json = ?, auth_config_json = ?,
      pagination_config_json = ?, rate_limit_ms = ?, is_active = ?,
      scheduler_status = CASE WHEN ? = 1 THEN 'scheduled' ELSE 'disabled' END,
      updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
      .run(source.name, source.source_url, source.api_url, source.country, source.region, source.source_type,
        source.parser_type, source.parser_config_json, source.connector_key, source.schedule, source.metadata_json,
        source.source_format, source.base_url, source.api_key_env, source.headers_json, source.auth_config_json,
        source.pagination_config_json, source.rate_limit_ms, Number(enable), Number(enable), source.id);
    return Number(source.id);
  }
  const result = db.prepare(`INSERT INTO contract_sources(name, source_url, api_url, country, source_type, parser_type,
    parser_config_json, is_active, connector_key, region, schedule, metadata_json, source_format, base_url,
    api_key_env, headers_json, auth_config_json, pagination_config_json, rate_limit_ms, scheduler_status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(source.name, source.source_url, source.api_url, source.country, source.source_type, source.parser_type,
      source.parser_config_json, Number(enable), source.connector_key, source.region, source.schedule,
      source.metadata_json, source.source_format, source.base_url, source.api_key_env, source.headers_json,
      source.auth_config_json, source.pagination_config_json, source.rate_limit_ms, enable ? 'scheduled' : 'disabled');
  return Number(result.lastInsertRowid);
}

export async function saveWizardConfiguration(body = {}) {
  const requestedEnable = Boolean(body.enable);
  const draft = buildWizardSource(body);
  const sourceId = persistSource(draft, false);
  let source = db.prepare('SELECT * FROM contract_sources WHERE id = ?').get(sourceId);
  const diagnostics = await diagnoseUrl(source);
  const test = await testSourceConnection(source);
  let importResult = null;
  let working = false;
  if (requestedEnable && test.ok && Number(diagnostics.http_code) === 200) {
    importResult = await importSource(source, { jobType: 'manual' });
    working = Number(importResult.imported || 0) + Number(importResult.updated || 0) > 0 && importResult.failures.length === 0;
  }
  db.prepare(`UPDATE contract_sources SET is_active = ?, scheduler_status = CASE WHEN ? = 1 THEN 'scheduled' ELSE 'disabled' END,
    availability_status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
    .run(Number(working), Number(working), working ? 'verified' : (test.ok ? 'ready_to_test' : 'requires_configuration'), sourceId);
  source = db.prepare('SELECT * FROM contract_sources WHERE id = ?').get(sourceId);
  const discovery = runSourceDiscovery();
  return { id: sourceId, working, diagnostics, test, import: importResult, source, discovery };
}
