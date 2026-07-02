import { parseJson } from '../db.mjs';
import { upsertImportedContract } from '../contracts.mjs';

const USER_AGENT = 'SkyprozContractFinder/2.0 (+https://skyproz.in)';
const TED_ENDPOINT = 'https://api.ted.europa.eu/v3/notices/search';
const DEFAULT_FIELDS = [
  'publication-number',
  'notice-title',
  'title-proc',
  'title-lot',
  'description-proc',
  'description-lot',
  'organisation-name-buyer',
  'buyer-name',
  'deadline-receipt-tender-date-lot',
  'place-of-performance-country-proc',
  'place-of-performance-country-lot',
  'notice-type',
  'estimated-value-proc',
  'estimated-value-cur-proc',
  'estimated-value-lot',
  'estimated-value-cur-lot',
  'publication-date'
];
const DEFAULT_TERMS = [
  'maintenance',
  'industrial',
  'rope access',
  'coating',
  'cleaning',
  'offshore',
  'marine',
  'wind turbine',
  'facility'
];

function parseConfig(source = {}) {
  return parseJson(source.parser_config_json, {});
}

function sourceUrl(source = {}) {
  return source.api_url || TED_ENDPOINT;
}

function yyyymmdd(date) {
  return date.toISOString().slice(0, 10).replaceAll('-', '');
}

function daysAgo(days) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - Number(days || 365));
  return yyyymmdd(date);
}

function escapeQueryTerm(value) {
  return String(value || '').replace(/"/g, '\\"').trim();
}

function defaultQuery(config = {}) {
  if (config.query) return String(config.query);
  const terms = Array.isArray(config.query_terms) && config.query_terms.length ? config.query_terms : DEFAULT_TERMS;
  const textQuery = terms
    .map(escapeQueryTerm)
    .filter(Boolean)
    .map((term) => `(notice-title ~ "${term}" OR title-proc ~ "${term}" OR description-proc ~ "${term}" OR description-lot ~ "${term}")`)
    .join(' OR ');
  return `(publication-date >= ${daysAgo(config.days_back || 365)}) AND (${textQuery})`;
}

export function tedSearchRequest(source = {}) {
  const config = parseConfig(source);
  return {
    query: defaultQuery(config),
    fields: Array.isArray(config.fields) && config.fields.length ? config.fields : DEFAULT_FIELDS,
    page: Number(config.page || 1),
    limit: Math.min(250, Math.max(1, Number(config.limit || 10))),
    scope: config.scope || 'ACTIVE',
    onlyLatestVersions: config.only_latest_versions !== false,
    paginationMode: config.pagination_mode || 'PAGE_NUMBER'
  };
}

function requestHeaders(source = {}) {
  const config = parseConfig(source);
  return {
    accept: 'application/json',
    'content-type': 'application/json',
    'user-agent': USER_AGENT,
    ...parseJson(source.headers_json, {}),
    ...(config.headers || {})
  };
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 20000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function searchTed(source = {}) {
  const config = parseConfig(source);
  const rateLimitMs = Number(config.rate_limit_ms || source.rate_limit_ms || 0);
  if (rateLimitMs > 0) await new Promise((resolve) => setTimeout(resolve, rateLimitMs));

  const url = sourceUrl(source);
  const body = tedSearchRequest(source);
  const started = Date.now();
  const response = await fetchWithTimeout(url, {
    method: 'POST',
    headers: requestHeaders(source),
    body: JSON.stringify(body)
  });
  const text = await response.text();
  if (!response.ok) {
    const message = text ? `${connector.name} returned HTTP ${response.status}: ${text.slice(0, 240)}` : `${connector.name} returned HTTP ${response.status}`;
    throw Object.assign(new Error(message), { httpStatus: response.status, responseBody: text });
  }
  const payload = JSON.parse(text);
  if (!payload || !Array.isArray(payload.notices)) throw new Error('TED payload did not contain a notices array.');
  return { payload, items: payload.notices, httpStatus: response.status, durationMs: Date.now() - started, requestBody: body, url };
}

function decodeText(value) {
  return String(value ?? '')
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function firstText(value) {
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) return value.map(firstText).filter(Boolean).join('; ');
  if (typeof value === 'object') {
    for (const lang of ['eng', 'ENG', 'en', 'EN']) {
      const text = firstText(value[lang]);
      if (text) return text;
    }
    for (const nested of Object.values(value)) {
      const text = firstText(nested);
      if (text) return text;
    }
    return '';
  }
  return decodeText(value);
}

function firstValue(...values) {
  for (const value of values) {
    const text = firstText(value);
    if (text) return text;
  }
  return '';
}

function firstArrayValue(value) {
  return Array.isArray(value) ? value.find(Boolean) || '' : firstText(value);
}

function parseTedDate(value) {
  const text = firstArrayValue(value);
  const match = String(text || '').match(/\d{4}-\d{2}-\d{2}/);
  return match ? `${match[0]}T00:00:00.000Z` : null;
}

function parseNumber(value) {
  const text = firstValue(value).replace(/[^\d.,-]/g, '').replace(',', '.');
  const parsed = Number.parseFloat(text);
  return Number.isFinite(parsed) ? parsed : null;
}

function sourceLink(item = {}) {
  const publicationNumber = item['publication-number'];
  return item.links?.html?.ENG
    || item.links?.htmlDirect?.ENG
    || item.links?.pdf?.ENG
    || (publicationNumber ? `https://ted.europa.eu/en/notice/-/detail/${publicationNumber}` : 'https://ted.europa.eu/en/');
}

function normalizeTedNotice(item = {}, source = {}) {
  const publicationNumber = firstValue(item['publication-number']);
  const title = firstValue(item['notice-title'], item['title-proc'], item['title-lot']) || `TED Notice ${publicationNumber}`;
  const description = firstValue(item['description-proc'], item['description-lot']);
  const country = firstArrayValue(item['place-of-performance-country-proc']) || firstArrayValue(item['place-of-performance-country-lot']) || source.country || 'European Union';
  const noticeType = firstValue(item['notice-type']) || 'Tender';
  const budgetValue = parseNumber(item['estimated-value-proc']) ?? parseNumber(item['estimated-value-lot']);
  const currency = firstArrayValue(item['estimated-value-cur-proc']) || firstArrayValue(item['estimated-value-cur-lot']) || null;

  return {
    source_id: source.id,
    external_id: publicationNumber,
    title,
    description,
    source_name: source.name || connector.name,
    source_url: sourceLink(item),
    country,
    region: source.region || 'Europe',
    buyer_name: firstValue(item['buyer-name'], item['organisation-name-buyer']),
    industry: 'Industrial Services',
    contract_type: noticeType,
    buyer_type: 'government',
    work_mode: 'onsite',
    budget_value: budgetValue,
    currency,
    deadline: parseTedDate(item['deadline-receipt-tender-date-lot']),
    posted_date: parseTedDate(item['publication-date']) || new Date().toISOString(),
    tags: ['TED', 'EU procurement', noticeType, country].filter(Boolean),
    status: 'open',
    verified: true,
    duplicate_key: publicationNumber ? `ted:${publicationNumber}` : undefined,
    metadata: {
      notice_type: noticeType,
      publication_number: publicationNumber,
      original_schema: 'TED Public API v3 NoticeResponse'
    },
    source_metadata: item
  };
}

const connector = {
  key: 'ted',
  name: 'TED Europe',
  category: 'government',
  documentation: 'Official TED Public API v3 connector using POST /v3/notices/search.',

  async testConnection(source = {}) {
    const url = sourceUrl(source);
    const body = tedSearchRequest(source);
    try {
      const result = await searchTed(source);
      const sampleContracts = result.items.slice(0, 5).map((item) => {
        const normalized = normalizeTedNotice(item, source);
        const validation = connector.validate(normalized);
        return {
          title: normalized.title,
          source_url: normalized.source_url,
          country: normalized.country,
          industry: normalized.industry,
          deadline: normalized.deadline,
          valid: validation.ok,
          warnings: validation.warnings,
          errors: validation.errors
        };
      });
      const validSamples = sampleContracts.filter((item) => item.valid).length;
      return {
        ok: result.items.length === 0 || validSamples > 0,
        status: validSamples > 0 ? 'ok' : result.items.length === 0 ? 'empty' : 'parser_failed',
        http_status: result.httpStatus,
        duration_ms: result.durationMs,
        url,
        method: 'POST',
        request_body: body,
        sample_count: result.items.length,
        sample_contracts: sampleContracts,
        response_schema: { root: 'notices', count: 'totalNoticeCount', item: 'NoticeResponse' },
        message: result.items.length === 0 ? 'TED API responded but no notices matched the query.' : `${validSamples} TED notice sample(s) validated.`
      };
    } catch (error) {
      return {
        ok: false,
        status: 'failed',
        http_status: error.httpStatus || null,
        duration_ms: 0,
        url,
        method: 'POST',
        request_body: body,
        error: error.message
      };
    }
  },

  async fetchContracts(source = {}) {
    const result = await searchTed(source);
    return result.items;
  },

  normalize(item, source = {}) {
    return normalizeTedNotice(item, source);
  },

  validate(contract) {
    const warnings = [];
    const errors = [];
    if (!String(contract.title || '').trim()) errors.push('Missing title');
    if (!String(contract.source_url || '').trim()) errors.push('Missing source_url');
    if (!String(contract.buyer_name || '').trim()) warnings.push('Missing buyer name');
    if (!String(contract.deadline || '').trim()) warnings.push('Missing tender deadline');
    return { ok: errors.length === 0, warnings, errors };
  },

  async import(source = {}, options = {}) {
    const started = Date.now();
    const rawItems = await connector.fetchContracts(source);
    const summary = { imported: 0, updated: 0, skipped: 0, warnings: [], failures: [], contract_ids: [], duration_ms: 0 };
    for (const item of rawItems) {
      try {
        const normalized = connector.normalize(item, source);
        const validation = connector.validate(normalized);
        if (!validation.ok) {
          summary.skipped++;
          summary.failures.push({ title: normalized.title || 'Untitled TED notice', errors: validation.errors });
          continue;
        }
        for (const warning of validation.warnings) summary.warnings.push({ title: normalized.title || 'Untitled TED notice', warning });
        const result = upsertImportedContract({ ...normalized, import_run_id: options.runId || null });
        if (result.contract?.id) summary.contract_ids.push(result.contract.id);
        if (result.action === 'created') summary.imported++; else summary.updated++;
      } catch (error) {
        summary.skipped++;
        summary.failures.push({ error: error.message });
      }
    }
    summary.duration_ms = Date.now() - started;
    return summary;
  }
};

export default connector;
