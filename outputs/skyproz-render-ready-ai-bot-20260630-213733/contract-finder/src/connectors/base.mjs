import { parseJson } from '../db.mjs';
import { upsertImportedContract } from '../contracts.mjs';

const USER_AGENT = 'SkyprozContractFinder/2.0 (+https://skyproz.in)';
const responseCache = new Map();

export function getPath(value, path) {
  return String(path || '').split('.').filter(Boolean).reduce((current, key) => current?.[key], value);
}

function stripTags(value) {
  return String(value ?? '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

function xmlValue(xml, tag) {
  const match = String(xml).match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'));
  return match ? stripTags(match[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')) : '';
}

function parseXmlItems(xml) {
  const text = String(xml || '');
  const blocks = [...text.matchAll(/<(item|entry)\b[\s\S]*?<\/\1>/gi)].map((match) => match[0]);
  return blocks.map((block) => ({
    title: xmlValue(block, 'title'),
    description: xmlValue(block, 'description') || xmlValue(block, 'summary') || xmlValue(block, 'content'),
    link: xmlValue(block, 'link') || (block.match(/<link[^>]+href=["']([^"']+)/i)?.[1] || ''),
    published: xmlValue(block, 'pubDate') || xmlValue(block, 'published') || xmlValue(block, 'updated'),
    id: xmlValue(block, 'guid') || xmlValue(block, 'id')
  }));
}

function parseCsv(text) {
  const rows = [];
  let row = []; let field = ''; let quoted = false;
  for (let index = 0; index < text.length; index++) {
    const character = text[index];
    if (character === '"' && text[index + 1] === '"') { field += '"'; index++; continue; }
    if (character === '"') { quoted = !quoted; continue; }
    if (character === ',' && !quoted) { row.push(field); field = ''; continue; }
    if ((character === '\n' || character === '\r') && !quoted) {
      if (character === '\r' && text[index + 1] === '\n') index++;
      row.push(field); field = '';
      if (row.some((value) => value.trim())) rows.push(row);
      row = []; continue;
    }
    field += character;
  }
  row.push(field);
  if (row.some((value) => value.trim())) rows.push(row);
  const headers = rows.shift()?.map((value) => value.trim()) || [];
  return rows.map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] || ''])));
}

function normalizeTags(value) {
  if (Array.isArray(value)) return value.map(String).map((item) => item.trim()).filter(Boolean);
  return String(value || '').split(/[;,|]/).map((item) => item.trim()).filter(Boolean);
}

function defaultMapping(source, item, definition) {
  const config = parseJson(source.parser_config_json, {});
  const fieldMap = { ...(definition.fieldMap || {}), ...(config.field_map || {}) };
  const mapped = {};
  for (const [target, sourcePath] of Object.entries(fieldMap)) mapped[target] = getPath(item, sourcePath);
  const sourceType = mapped.buyer_type || source.source_type || definition.sourceType || 'government';
  return {
    ...mapped,
    source_id: source.id,
    source_name: source.name || definition.name,
    source_url: mapped.source_url || source.source_url || definition.sourceUrl || '',
    country: mapped.country || source.country || definition.country || 'Worldwide',
    region: mapped.region || source.region || definition.region || '',
    industry: mapped.industry || definition.industry || 'Industrial Services',
    contract_type: mapped.contract_type || 'Tender',
    buyer_type: sourceType === 'private' ? 'private' : 'government',
    work_mode: mapped.work_mode || 'onsite',
    buyer_name: mapped.buyer_name || mapped.buyer || '',
    currency: mapped.currency || definition.currency || null,
    tags: normalizeTags(mapped.tags || definition.tags || []),
    source_metadata: item
  };
}

function cacheKey(url, parserType) {
  return `${parserType || 'json'}:${url}`;
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

async function parseResponse(response, parserType) {
  const type = String(parserType || '').toLowerCase();
  if (type === 'csv') return parseCsv(await response.text());
  if (type === 'xml' || type === 'rss') return parseXmlItems(await response.text());
  return await response.json();
}

export function createConnector(definition) {
  const connector = {
    key: definition.key,
    name: definition.name,
    category: definition.category || 'government',
    documentation: definition.documentation || '',

    async testConnection(source = {}) {
      const url = source.api_url || definition.apiUrl || source.source_url || definition.sourceUrl;
      if (!url) return { ok: false, status: 'missing_url', message: 'Connector requires source_url or api_url.' };
      const started = Date.now();
      try {
        const response = await fetchWithTimeout(url, { method: 'GET', headers: { accept: '*/*', 'user-agent': USER_AGENT } }, 15000);
        return { ok: response.ok, status: response.status, duration_ms: Date.now() - started, url };
      } catch (error) {
        return { ok: false, status: 'failed', duration_ms: Date.now() - started, error: error.message, url };
      }
    },

    async fetchContracts(source = {}) {
      const url = source.api_url || definition.apiUrl || source.source_url || definition.sourceUrl;
      if (!url) return [];
      const config = parseJson(source.parser_config_json, {});
      const parserType = config.parser_type || definition.parserType || source.parser_type || 'json';
      const cacheTtlMs = Number(config.cache_ttl_seconds || source.cache_ttl_seconds || 0) * 1000;
      const key = cacheKey(url, parserType);
      const cached = responseCache.get(key);
      if (cacheTtlMs > 0 && cached && cached.expiresAt > Date.now()) return cached.items;
      const rateLimitMs = Number(config.rate_limit_ms || source.rate_limit_ms || 0);
      if (rateLimitMs > 0) await new Promise((resolve) => setTimeout(resolve, rateLimitMs));
      const response = await fetchWithTimeout(url, { headers: { accept: parserType === 'json' ? 'application/json' : '*/*', 'user-agent': USER_AGENT } });
      if (!response.ok) throw new Error(`${connector.name} returned HTTP ${response.status}`);
      const payload = await parseResponse(response, parserType);
      const items = getPath(payload, config.items_path || definition.itemsPath) || payload;
      if (!Array.isArray(items)) throw new Error('Connector payload did not resolve to an array.');
      if (cacheTtlMs > 0) responseCache.set(key, { items, expiresAt: Date.now() + cacheTtlMs });
      return items;
    },

    normalize(item, source = {}) {
      return defaultMapping(source, item, definition);
    },

    validate(contract) {
      const warnings = [];
      const errors = [];
      if (!String(contract.title || '').trim()) errors.push('Missing title');
      if (!String(contract.description || '').trim()) warnings.push('Missing description');
      if (!String(contract.source_url || '').trim()) warnings.push('Missing source_url; original tender button will be disabled.');
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
          if (!validation.ok) { summary.skipped++; summary.failures.push({ title: normalized.title || 'Untitled', errors: validation.errors }); continue; }
          for (const warning of validation.warnings) summary.warnings.push({ title: normalized.title || 'Untitled', warning });
          const result = upsertImportedContract({ ...normalized, import_run_id: options.runId || null });
          if (result.contract?.id) summary.contract_ids.push(result.contract.id);
          if (result.action === 'created') summary.imported++; else summary.updated++;
        } catch (error) {
          summary.skipped++; summary.failures.push({ error: error.message });
        }
      }
      summary.duration_ms = Date.now() - started;
      return summary;
    }
  };
  return connector;
}

export function connectorDefinition(input) {
  return {
    parserType: 'json',
    fieldMap: {
      external_id: 'id',
      title: 'title',
      description: 'description',
      source_url: 'url',
      country: 'country',
      region: 'region',
      industry: 'industry',
      contract_type: 'contract_type',
      budget_value: 'budget_value',
      currency: 'currency',
      deadline: 'deadline',
      posted_date: 'posted_date',
      buyer_name: 'buyer_name',
      tags: 'tags'
    },
    ...input
  };
}
