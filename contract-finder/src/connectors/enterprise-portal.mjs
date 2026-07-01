import { parseJson } from '../db.mjs';
import { upsertImportedContract } from '../contracts.mjs';

const USER_AGENT = 'SkyprozContractFinder/2.0 (+https://skyproz.in)';

function parseConfig(source) {
  return {
    ...parseJson(source.metadata_json, {}),
    ...parseJson(source.parser_config_json, {})
  };
}

function compact(values) {
  return values.map((value) => String(value || '').trim()).filter(Boolean);
}

function unique(values) {
  return [...new Set(compact(values))];
}

function sourceUrl(source, config) {
  return config.opportunity_url || config.vendor_registration_url || source.api_url || source.source_url;
}

async function fetchWithTimeout(url, timeoutMs = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      signal: controller.signal,
      headers: {
        accept: 'text/html,application/json,*/*',
        'user-agent': USER_AGENT
      }
    });
  } finally {
    clearTimeout(timer);
  }
}

export function buildPortalOpportunity(source) {
  const config = parseConfig(source);
  const companyName = config.company_name || config.companyName || source.name;
  const platform = config.procurement_platform || config.platform || 'Official supplier portal';
  const industry = config.industry || source.industry || 'Industrial Services';
  const country = config.country || source.country || 'Worldwide';
  const registrationUrl = config.vendor_registration_url || sourceUrl(source, config);
  const opportunityUrl = sourceUrl(source, config);
  const services = unique(config.services || [
    'Rope Access',
    'Industrial Maintenance',
    'Marine Maintenance',
    'Offshore Maintenance',
    'Oil and Gas Maintenance',
    'Industrial Cleaning'
  ]);
  return {
    external_id: `enterprise-portal:${String(companyName).toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
    title: `${companyName} Supplier Portal - Vendor Registration`,
    description: [
      `${companyName} official supplier/vendor registration and procurement access point.`,
      `Procurement platform: ${platform}.`,
      `Relevant Skyproz service areas: ${services.join(', ')}.`,
      'Use the original source link to review supplier registration requirements and any public opportunity information published by the company.'
    ].join(' '),
    source_id: source.id,
    source_name: source.name,
    source_url: opportunityUrl,
    country,
    region: config.region || source.region || '',
    industry,
    contract_type: config.contract_type || 'Vendor Registration',
    buyer_type: 'private',
    work_mode: config.work_mode || 'onsite',
    buyer_name: companyName,
    budget_value: config.budget_value || null,
    currency: config.currency || null,
    deadline: config.deadline || null,
    posted_date: config.publication_date || config.publicationDate || new Date().toISOString(),
    tags: unique(['Private Enterprise', 'Vendor Registration', companyName, industry, platform, ...services]),
    status: config.status || 'open',
    duplicate_key: `enterprise-portal:${String(companyName).toLowerCase().replace(/[^a-z0-9]+/g, '-')}:${opportunityUrl}`,
    metadata: {
      company_name: companyName,
      procurement_source: config.procurement_source || source.name,
      procurement_platform: platform,
      vendor_registration_url: registrationUrl,
      opportunity_url: opportunityUrl,
      original_source_url: opportunityUrl,
      publication_date: config.publication_date || config.publicationDate || null,
      deadline: config.deadline || null,
      compliance_note: 'Configured official/public private enterprise supplier portal. No authenticated content is scraped.'
    },
    source_metadata: {
      connector: 'enterprise_portal',
      company_name: companyName,
      procurement_platform: platform,
      health_url: opportunityUrl
    }
  };
}

const connector = {
  key: 'enterprise_portal',
  name: 'Private Enterprise Portal',
  category: 'private_enterprise',
  documentation: 'Connector template for official public private-sector supplier portals, vendor registration pages and public enterprise procurement access points.',

  async testConnection(source = {}) {
    const config = parseConfig(source);
    const url = sourceUrl(source, config);
    if (!url) return { ok: false, status: 'missing_url', message: 'Connector requires a public source_url, opportunity_url or vendor_registration_url.' };
    const started = Date.now();
    try {
      const response = await fetchWithTimeout(url);
      return {
        ok: response.ok,
        status: response.status,
        duration_ms: Date.now() - started,
        url,
        content_type: response.headers.get('content-type')
      };
    } catch (error) {
      return { ok: false, status: 'failed', duration_ms: Date.now() - started, error: error.message, url };
    }
  },

  async fetchContracts(source = {}) {
    const health = await connector.testConnection(source);
    if (!health.ok) throw new Error(`Private enterprise portal health check failed: ${health.status || health.error}`);
    return [buildPortalOpportunity(source)];
  },

  normalize(item) {
    return item;
  },

  validate(contract) {
    const errors = [];
    const warnings = [];
    if (!contract.title) errors.push('Missing title');
    if (!contract.source_url) errors.push('Missing source_url');
    if (!contract.buyer_name) warnings.push('Missing company/buyer name');
    return { ok: errors.length === 0, warnings, errors };
  },

  async import(source = {}, options = {}) {
    const started = Date.now();
    const summary = { imported: 0, updated: 0, skipped: 0, warnings: [], failures: [], contract_ids: [], duration_ms: 0 };
    const items = await connector.fetchContracts(source);
    for (const item of items) {
      try {
        const normalized = connector.normalize(item, source);
        const validation = connector.validate(normalized);
        if (!validation.ok) {
          summary.skipped++;
          summary.failures.push({ title: normalized.title || 'Untitled', errors: validation.errors });
          continue;
        }
        for (const warning of validation.warnings) summary.warnings.push({ title: normalized.title || 'Untitled', warning });
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
