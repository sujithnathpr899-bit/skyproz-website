import { createConnector, connectorDefinition } from './base.mjs';

const OPPORTUNITY_TYPES = [
  ['Vendor Registration', /\b(vendor|supplier)\s+registration\b/i],
  ['Framework Agreement', /\bframework\s+(agreement|contract)\b/i],
  ['RFQ', /\brfq\b|request\s+for\s+quotation/i],
  ['RFP', /\brfp\b|request\s+for\s+proposal/i],
  ['EOI', /\beoi\b|expression\s+of\s+interest/i],
  ['Subcontract Opportunity', /\bsubcontract(ing|or)?\b/i],
  ['Shutdown Project', /\bshutdown\b/i],
  ['Turnaround Project', /\bturnaround\b/i],
  ['Maintenance Contract', /\bmaintenance\b/i],
  ['Service Contract', /\bservice\s+contract\b/i],
  ['Tender', /\btender\b|invitation\s+to\s+bid|\bbid\b/i]
];

const INDUSTRY_TYPES = [
  ['Rope Access', /\b(rope access|irata|work at height|height access)\b/i],
  ['Industrial Painting', /\b(industrial painting|protective coating|coating|painting|abrasive blasting|hydro blasting)\b/i],
  ['Industrial Cleaning', /\b(industrial cleaning|tank cleaning|pressure washing|high pressure water jetting)\b/i],
  ['Marine Maintenance', /\b(marine|offshore|ship repair|shipyard|vessel|port)\b/i],
  ['Wind Turbine Support', /\b(wind turbine|blade inspection|wind farm)\b/i],
  ['Facility Management', /\b(facility management|facilities management|housekeeping|building maintenance|facade|glass cleaning)\b/i],
  ['Shutdown Maintenance', /\b(shutdown|turnaround|plant outage)\b/i],
  ['Technical Inspection', /\b(ndt|non destructive|inspection|testing)\b/i]
];

function decodeEntities(value) {
  return String(value || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
}

function absoluteUrl(value, source) {
  const decoded = decodeEntities(value).trim();
  if (!decoded) return source.source_url || source.api_url || '';
  try {
    return new URL(decoded, source.source_url || source.api_url).href;
  } catch {
    return decoded;
  }
}

function detectOpportunityType(contract) {
  const text = `${contract.title || ''} ${contract.description || ''}`;
  return OPPORTUNITY_TYPES.find(([, pattern]) => pattern.test(text))?.[0] || 'Private Opportunity';
}

function detectIndustry(contract) {
  const text = `${contract.title || ''} ${contract.description || ''} ${contract.industry || ''}`;
  return INDUSTRY_TYPES.find(([, pattern]) => pattern.test(text))?.[0] || contract.industry || 'Industrial Services';
}

function parseTenderNewsDeadline(sourceUrl) {
  try {
    const value = new URL(sourceUrl).searchParams.get('bdt');
    if (!/^\d{8}$/.test(value || '')) return null;
    const month = Number(value.slice(0, 2));
    const day = Number(value.slice(2, 4));
    const year = Number(value.slice(4, 8));
    const date = new Date(Date.UTC(year, month - 1, day, 23, 59, 59));
    return Number.isNaN(date.valueOf()) ? null : date.toISOString();
  } catch {
    return null;
  }
}

function statusFromDeadline(deadline) {
  if (!deadline) return 'open';
  const remainingDays = Math.ceil((new Date(deadline).valueOf() - Date.now()) / 86400000);
  if (remainingDays < 0) return 'expired';
  if (remainingDays <= 7) return 'closing_soon';
  return 'open';
}

const connector = createConnector(connectorDefinition({
  key: 'private_rss',
  name: 'Private Opportunity RSS Feed',
  category: 'private',
  parserType: 'rss',
  sourceType: 'private',
  documentation: 'Classified RSS/XML connector for permitted public private-sector RFQ, RFP, tender and vendor opportunity feeds.',
  fieldMap: {
    external_id: 'id',
    title: 'title',
    description: 'description',
    source_url: 'link',
    posted_date: 'published'
  }
}));

const normalizeBase = connector.normalize.bind(connector);

connector.normalize = (item, source = {}) => {
  const normalized = normalizeBase(item, source);
  const sourceUrl = absoluteUrl(normalized.source_url || item.link, source);
  const deadline = normalized.deadline || parseTenderNewsDeadline(sourceUrl);
  const opportunityType = detectOpportunityType(normalized);
  const industry = detectIndustry(normalized);
  const tags = new Set([...(normalized.tags || []), opportunityType, industry, 'Private Procurement']);
  return {
    ...normalized,
    external_id: normalized.external_id || sourceUrl || `${normalized.title}:${normalized.posted_date || ''}`,
    source_url: sourceUrl,
    industry,
    contract_type: opportunityType,
    buyer_type: 'private',
    deadline,
    status: statusFromDeadline(deadline),
    duplicate_key: sourceUrl ? `private-rss:${sourceUrl.toLowerCase()}` : normalized.duplicate_key,
    metadata: {
      source_kind: 'private_rss',
      opportunity_type: opportunityType,
      compliance_note: 'Imported from a configured public RSS/XML opportunity feed.'
    },
    source_metadata: {
      ...normalized.source_metadata,
      normalized_by: 'private_rss'
    },
    tags: [...tags].filter(Boolean)
  };
};

export default connector;
