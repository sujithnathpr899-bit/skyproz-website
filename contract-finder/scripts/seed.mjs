import { migrate, db } from '../src/db.mjs';
import { hashPassword } from '../src/auth.mjs';
import { createContract } from '../src/contracts.mjs';

migrate();

const categories = [
  ['Rope Access', 'rope-access', 'Work-at-height inspection, access and maintenance'],
  ['Industrial Maintenance', 'industrial-maintenance', 'Plant and asset maintenance opportunities'],
  ['Marine & Offshore', 'marine-offshore', 'Marine, ship and offshore scopes'],
  ['Wind Energy', 'wind-energy', 'Wind turbine inspection and maintenance'],
  ['Manpower', 'manpower', 'Technical workforce and staffing contracts'],
  ['Technical Consultancy', 'technical-consultancy', 'Engineering and technical advisory work']
];
const categoryInsert = db.prepare('INSERT OR IGNORE INTO contract_categories(name, slug, description) VALUES (?, ?, ?)');
for (const category of categories) categoryInsert.run(...category);

const sourceInsert = db.prepare(`INSERT OR IGNORE INTO contract_sources(name, source_url, country, source_type, parser_type)
  VALUES (?, ?, ?, ?, 'manual')`);
sourceInsert.run('UK Contracts Finder', 'https://www.contractsfinder.service.gov.uk/Search', 'United Kingdom', 'government');
sourceInsert.run('Government e-Marketplace', 'https://bidplus.gem.gov.in/all-bids', 'India', 'government');
sourceInsert.run('Central Public Procurement Portal', 'https://eprocure.gov.in/eprocure/app', 'India', 'government');
db.prepare(`UPDATE contract_sources SET is_active = 0, scheduler_status = 'disabled', last_status = COALESCE(last_status, 'manual')
  WHERE parser_type = 'manual' AND name IN ('UK Contracts Finder', 'Government e-Marketplace', 'Central Public Procurement Portal')`).run();

const sourceTemplateUpsert = db.prepare(`INSERT INTO contract_sources(
  name, source_url, api_url, country, source_type, parser_type, parser_config_json, is_active,
  connector_key, region, schedule, metadata_json, source_format, base_url, api_key_env,
  headers_json, auth_config_json, pagination_config_json, rate_limit_ms, scheduler_status
) VALUES (?, ?, ?, ?, ?, 'json', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(name) DO UPDATE SET
  source_url = excluded.source_url,
  api_url = excluded.api_url,
  country = excluded.country,
  source_type = excluded.source_type,
  parser_config_json = excluded.parser_config_json,
  connector_key = excluded.connector_key,
  region = excluded.region,
  schedule = excluded.schedule,
  metadata_json = excluded.metadata_json,
  source_format = excluded.source_format,
  base_url = excluded.base_url,
  api_key_env = excluded.api_key_env,
  headers_json = excluded.headers_json,
  auth_config_json = excluded.auth_config_json,
  pagination_config_json = excluded.pagination_config_json,
  rate_limit_ms = excluded.rate_limit_ms,
  scheduler_status = CASE WHEN contract_sources.is_active = 1 THEN 'scheduled' ELSE 'disabled' END,
  updated_at = CURRENT_TIMESTAMP`);

const rssMap = { parser_type: 'rss', field_map: { external_id: 'id', title: 'title', description: 'description', source_url: 'link', posted_date: 'published' }, limit: 25, cache_ttl_seconds: 900 };
const jsonMap = { parser_type: 'json', field_map: { external_id: 'id', title: 'title', description: 'description', source_url: 'url', country: 'country', industry: 'industry', contract_type: 'contract_type', deadline: 'deadline', posted_date: 'posted_date', buyer_name: 'buyer_name', tags: 'tags' }, limit: 25, cache_ttl_seconds: 900 };
const tedMap = {
  parser_type: 'json',
  request_method: 'POST',
  items_path: 'notices',
  fields: [
    'publication-number', 'notice-title', 'title-proc', 'title-lot', 'description-proc', 'description-lot',
    'organisation-name-buyer', 'buyer-name', 'deadline-receipt-tender-date-lot',
    'place-of-performance-country-proc', 'place-of-performance-country-lot', 'notice-type',
    'estimated-value-proc', 'estimated-value-cur-proc', 'estimated-value-lot', 'estimated-value-cur-lot',
    'publication-date'
  ],
  field_map: {
    external_id: 'publication-number',
    title: 'notice-title',
    description: 'description-proc',
    buyer: 'buyer-name',
    source_url: 'links.html.ENG',
    country: 'place-of-performance-country-proc',
    industry: 'Industrial Services',
    contract_type: 'notice-type',
    notice_type: 'notice-type',
    category: 'notice-type',
    budget: 'estimated-value-proc',
    budget_value: 'estimated-value-proc',
    currency: 'estimated-value-cur-proc',
    deadline: 'deadline-receipt-tender-date-lot',
    published_date: 'publication-date',
    posted_date: 'publication-date',
    buyer_name: 'buyer-name'
  },
  query_terms: ['maintenance', 'industrial', 'rope access', 'coating', 'cleaning', 'offshore', 'marine', 'wind turbine', 'facility'],
  days_back: 365,
  limit: 10,
  scope: 'ACTIVE',
  only_latest_versions: true,
  pagination_mode: 'PAGE_NUMBER',
  cache_ttl_seconds: 900
};
const worldBankMap = {
  ...jsonMap,
  items_path: 'procnotices',
  limit: 10,
  field_map: {
    external_id: 'id',
    title: 'bid_description',
    description: 'notice_text',
    country: 'project_ctry_name',
    industry: 'procurement_group',
    contract_type: 'procurement_method_name',
    deadline: 'submission_deadline_date',
    posted_date: 'submission_date',
    buyer_name: 'contact_organization',
    tags: 'notice_type'
  }
};
const canadaBuysMap = {
  parser_type: 'csv',
  field_map: {
    external_id: 'referenceNumber-numeroReference',
    title: 'title-titre-eng',
    description: 'tenderDescription-descriptionAppelOffres-eng',
    source_url: 'noticeURL-URLavis-eng',
    country: 'contractingEntityAddressCountry-entiteContractanteAdressePays-eng',
    industry: 'procurementCategory-categorieApprovisionnement',
    contract_type: 'noticeType-avisType-eng',
    deadline: 'tenderClosingDate-appelOffresDateCloture',
    posted_date: 'publicationDate-datePublication',
    buyer_name: 'contractingEntityName-nomEntitContractante-eng',
    tags: 'unspscDescription-eng'
  },
  limit: 10,
  cache_ttl_seconds: 900
};
const ukFindTenderMap = {
  parser_type: 'json',
  items_path: 'releases',
  limit: 10,
  cache_ttl_seconds: 900,
  field_map: {
    external_id: 'id',
    title: 'tender.title',
    description: 'tender.description',
    buyer_name: 'buyer.name',
    posted_date: 'date'
  }
};
const templateOnly = (note) => ({ ...jsonMap, template_only: true, note });
const templates = [
  ['World Bank Procurement Notices', 'https://projects.worldbank.org/en/projects-operations/procurement', 'https://search.worldbank.org/api/v2/procnotices?format=json&rows=10', 'Worldwide', 'government', worldBankMap, 1, 'worldbank', 'Global', 'hourly', { provider: 'World Bank', api_documentation_url: 'https://search.worldbank.org/api/v2/procnotices', compliance: 'Official public World Bank procurement notices API.' }, 'rest', 'https://search.worldbank.org', '', { accept: 'application/json' }, {}, { rows: 10 }, 1000, 'scheduled'],
  ['TED Europe', 'https://ted.europa.eu/en/', 'https://api.ted.europa.eu/v3/notices/search', 'European Union', 'government', tedMap, 1, 'ted', 'Europe', 'hourly', { provider: 'TED', api_documentation_url: 'https://api.ted.europa.eu/swagger-ui/index.html', compliance: 'Official TED Public API v3. Uses POST /v3/notices/search.' }, 'rest', 'https://api.ted.europa.eu', '', { accept: 'application/json', 'content-type': 'application/json' }, {}, { mode: 'PAGE_NUMBER', limit: 10 }, 1000, 'scheduled'],
  ['SAM.gov Opportunities', 'https://sam.gov/content/opportunities', 'https://api.sam.gov/prod/opportunities/v2/search?limit=25&api_key={api_key}', 'United States', 'government', { ...jsonMap, items_path: 'opportunitiesData' }, 0, 'sam', 'North America', 'daily', { provider: 'SAM.gov', api_documentation_url: 'https://open.gsa.gov/api/get-opportunities-public-api/', compliance: 'Official SAM.gov API requires SAM_API_KEY.' }, 'rest', 'https://api.sam.gov', 'SAM_API_KEY', {}, { api_key_env: 'SAM_API_KEY' }, {}, 1000, 'disabled'],
  ['UNGM Tender Notices RSS', 'https://www.ungm.org/Public/Notice', null, 'Worldwide', 'government', templateOnly('Configure a verified official UNGM API/RSS/feed endpoint before enabling import.'), 0, 'ungm', 'Global', 'daily', { provider: 'UNGM', compliance: 'Official public procurement template' }, 'rss', 'https://www.ungm.org', '', {}, {}, {}, 1000, 'disabled'],
  ['GeM India', 'https://bidplus.gem.gov.in/all-bids', null, 'India', 'government', templateOnly('No official public machine feed configured. Enable only after adding a permitted GeM API/feed.'), 0, 'gem', 'Asia', 'daily', { provider: 'GeM', compliance: 'Official public portal template' }, 'rest', 'https://bidplus.gem.gov.in', '', {}, {}, {}, 1000, 'disabled'],
  ['CPPP India', 'https://eprocure.gov.in/eprocure/app', null, 'India', 'government', templateOnly('No official public machine feed configured. Enable only after adding a permitted CPPP API/feed.'), 0, 'cppp', 'Asia', 'daily', { provider: 'CPPP', compliance: 'Official public portal template' }, 'rest', 'https://eprocure.gov.in', '', {}, {}, {}, 1000, 'disabled'],
  ['CanadaBuys', 'https://canadabuys.canada.ca/en/tender-opportunities', 'https://canadabuys.canada.ca/opendata/pub/openTenderNotice-ouvertAvisAppelOffres.csv', 'Canada', 'government', canadaBuysMap, 1, 'canadabuys', 'North America', 'hourly', { provider: 'CanadaBuys', api_documentation_url: 'https://open.canada.ca/data/en/dataset/6abd20d4-7a1c-4b38-baa2-9525d0bb2fd2', compliance: 'Official Government of Canada open-data CSV for open CanadaBuys tender notices.' }, 'csv', 'https://canadabuys.canada.ca', '', { accept: 'text/csv,*/*' }, {}, { file: 'openTenderNotice-ouvertAvisAppelOffres.csv' }, 1000, 'scheduled'],
  ['AusTender ATM RSS', 'https://www.tenders.gov.au/', null, 'Australia', 'government', templateOnly('Configure a verified official AusTender API/RSS/feed endpoint before enabling import.'), 0, 'austender', 'Oceania', 'daily', { provider: 'AusTender', compliance: 'Official public procurement template' }, 'rss', 'https://www.tenders.gov.au', '', {}, {}, {}, 1000, 'disabled'],
  ['GETS New Zealand', 'https://www.gets.govt.nz/', 'https://www.gets.govt.nz/ExternalRSSFeed.htm', 'New Zealand', 'government', { ...rssMap, limit: 10 }, 1, 'gets', 'Oceania', 'hourly', { provider: 'GETS New Zealand', api_documentation_url: 'https://www.gets.govt.nz/ExternalIndex.htm', compliance: 'Official GETS public RSS feed linked from the public tender page.' }, 'rss', 'https://www.gets.govt.nz', '', { accept: 'application/rss+xml,application/xml,text/xml,*/*' }, {}, { feed: 'ExternalRSSFeed.htm' }, 1000, 'scheduled'],
  ['GeBIZ Singapore', 'https://www.gebiz.gov.sg/', null, 'Singapore', 'government', templateOnly('Configure an official GeBIZ permitted feed/API before enabling import.'), 0, 'gebiz', 'Asia', 'daily', { provider: 'GeBIZ', compliance: 'Official public procurement template' }, 'rest', 'https://www.gebiz.gov.sg', '', {}, {}, {}, 1000, 'disabled'],
  ['UAE Procurement', 'https://mof.gov.ae/', null, 'United Arab Emirates', 'government', templateOnly('Configure an official UAE procurement API/feed before enabling import.'), 0, 'uae', 'Middle East', 'daily', { provider: 'UAE Procurement', compliance: 'Official public procurement template' }, 'rest', 'https://mof.gov.ae', '', {}, {}, {}, 1000, 'disabled'],
  ['Qatar Procurement', 'https://monaqasat.mof.gov.qa/', null, 'Qatar', 'government', templateOnly('Configure an official Qatar procurement API/feed before enabling import.'), 0, 'qatar', 'Middle East', 'daily', { provider: 'Qatar Procurement', compliance: 'Official public procurement template' }, 'rest', 'https://monaqasat.mof.gov.qa', '', {}, {}, {}, 1000, 'disabled'],
  ['ADB Procurement Notices', 'https://www.adb.org/projects/tenders', null, 'Worldwide', 'government', templateOnly('Configure an official ADB RSS/API endpoint before enabling import.'), 0, 'adb', 'Asia Pacific', 'daily', { provider: 'ADB', compliance: 'Official procurement notices template' }, 'rss', 'https://www.adb.org', '', {}, {}, {}, 1000, 'disabled'],
  ['AfDB Procurement Notices', 'https://www.afdb.org/en/projects-and-operations/procurement', null, 'Africa', 'government', templateOnly('Configure an official AfDB RSS/API endpoint before enabling import.'), 0, 'afdb', 'Africa', 'daily', { provider: 'AfDB', compliance: 'Official procurement notices template' }, 'rss', 'https://www.afdb.org', '', {}, {}, {}, 1000, 'disabled'],
  ['EIB Procurement Notices', 'https://www.eib.org/en/about/procurement/index.htm', null, 'European Union', 'government', templateOnly('Configure an official EIB RSS/API endpoint before enabling import.'), 0, 'eib', 'Europe', 'daily', { provider: 'EIB', compliance: 'Official procurement notices template' }, 'rss', 'https://www.eib.org', '', {}, {}, {}, 1000, 'disabled'],
  ['Inter-American Development Bank Procurement', 'https://projectprocurement.iadb.org/en/procurement-notices', null, 'Americas', 'government', templateOnly('Configure an official IDB public API/feed endpoint before enabling import. Current public site was not live-verifiable from this environment.'), 0, 'json', 'Americas', 'daily', { provider: 'Inter-American Development Bank', compliance: 'Requires official public endpoint configuration.' }, 'rest', 'https://projectprocurement.iadb.org', '', {}, {}, {}, 1000, 'disabled'],
  ['UNDP Procurement Notices', 'https://procurement-notices.undp.org/', null, 'Worldwide', 'government', templateOnly('UNDP robots.txt disallows automated access. Configure only an officially permitted UNDP API/feed if provided.'), 0, 'undp', 'Global', 'daily', { provider: 'UNDP', compliance: 'Requires official permitted API/feed; do not scrape procurement-notices.undp.org.' }, 'rest', 'https://procurement-notices.undp.org', '', {}, {}, {}, 1000, 'disabled'],
  ['UNICEF Supply Tender Notices', 'https://www.unicef.org/supply/', null, 'Worldwide', 'government', templateOnly('Configure an official UNICEF permitted API/feed before enabling import.'), 0, 'unicef', 'Global', 'daily', { provider: 'UNICEF', compliance: 'Official supply template only; no public machine feed verified.' }, 'rest', 'https://www.unicef.org', '', {}, {}, {}, 1000, 'disabled'],
  ['UNOPS eSourcing', 'https://apps.unops.org/apps/esourcing/', null, 'Worldwide', 'government', templateOnly('UNOPS eSourcing requires authenticated access. Configure only an official permitted API/feed if provided.'), 0, 'json', 'Global', 'daily', { provider: 'UNOPS', compliance: 'Requires configuration; do not bypass authentication.' }, 'rest', 'https://apps.unops.org', '', {}, {}, {}, 1000, 'disabled'],
  ['UNIDO Procurement Opportunities', 'https://www.unido.org/procurement-opportunities', null, 'Worldwide', 'government', templateOnly('Configure an official UNIDO permitted API/feed before enabling import. The public page was protected by Cloudflare in this environment.'), 0, 'json', 'Global', 'daily', { provider: 'UNIDO', compliance: 'Requires official public endpoint configuration; do not bypass access protections.' }, 'rest', 'https://www.unido.org', '', {}, {}, {}, 1000, 'disabled'],
  ['UK Find a Tender', 'https://www.find-tender.service.gov.uk/', 'https://www.find-tender.service.gov.uk/api/1.0/ocdsReleasePackages?limit=10', 'United Kingdom', 'government', ukFindTenderMap, 1, 'uk', 'Europe', 'hourly', { provider: 'UK Find a Tender', api_documentation_url: 'https://www.find-tender.service.gov.uk/api/1.0/ocdsReleasePackages', compliance: 'Official Find a Tender OCDS API.' }, 'rest', 'https://www.find-tender.service.gov.uk', '', { accept: 'application/json' }, {}, { limit: 10 }, 1000, 'scheduled']
];
for (const template of templates) {
  const [name, sourceUrl, apiUrl, country, sourceType, parserConfig, active, connectorKey, region, schedule, metadata, sourceFormat, baseUrl, apiKeyEnv, headers, auth, pagination, rateLimitMs, schedulerStatus] = template;
  sourceTemplateUpsert.run(
    name, sourceUrl, apiUrl, country, sourceType, JSON.stringify(parserConfig), Number(active), connectorKey, region, schedule,
    JSON.stringify(metadata), sourceFormat, baseUrl, apiKeyEnv, JSON.stringify(headers), JSON.stringify(auth),
    JSON.stringify(pagination), Number(rateLimitMs), schedulerStatus
  );
}
db.prepare("UPDATE contract_sources SET scheduler_status = 'disabled' WHERE is_active = 0").run();
db.prepare("UPDATE contract_sources SET scheduler_status = 'scheduled' WHERE is_active = 1 AND scheduler_status = 'disabled'").run();
db.prepare(`UPDATE contract_sources SET is_active = 1, scheduler_status = 'scheduled'
  WHERE name IN ('World Bank Procurement Notices', 'TED Europe', 'CanadaBuys', 'UK Find a Tender', 'GETS New Zealand')
    AND (last_status = 'ok' OR contracts_imported > 0)`).run();
db.prepare(`UPDATE contract_sources SET is_active = 0, scheduler_status = 'disabled'
  WHERE name IN ('UNGM Tender Notices RSS', 'AusTender ATM RSS') AND (last_status = 'failed' OR api_url IS NULL OR api_url = '')`).run();

const users = [
  ['admin@skyproz.in', 'Skyproz Admin', 'admin', 'premium', 'ChangeMe-Admin-2026!'],
  ['premium@example.com', 'Premium Demo', 'user', 'premium', 'ChangeMe-Premium-2026!'],
  ['user@example.com', 'Free Demo', 'user', 'free', 'ChangeMe-Free-2026!']
];
for (const [email, name, role, plan, password] of users) {
  if (!db.prepare('SELECT id FROM users WHERE email = ?').get(email)) {
    db.prepare('INSERT INTO users(email, password_hash, display_name, role, plan) VALUES (?, ?, ?, ?, ?)')
      .run(email, await hashPassword(password), name, role, plan);
  }
}

if (!db.prepare('SELECT id FROM contracts LIMIT 1').get()) {
  const source = db.prepare("SELECT id FROM contract_sources WHERE name = 'Central Public Procurement Portal'").get();
  const categoryIds = Object.fromEntries(db.prepare('SELECT slug, id FROM contract_categories').all().map((row) => [row.slug, row.id]));
  createContract({
    source_id: source.id,
    external_id: 'DEMO-RA-001',
    title: 'Industrial Rope Access Inspection and Maintenance Services',
    description: 'Demonstration listing for inspection, maintenance and minor repair work at elevated industrial structures. Suppliers should review the original procurement notice before acting.',
    source_name: 'Demo Procurement Source',
    source_url: 'https://eprocure.gov.in/eprocure/app',
    country: 'India', industry: 'Industrial Services', contract_type: 'Services', buyer_type: 'government', work_mode: 'onsite',
    budget_value: 7500000, currency: 'INR', deadline: '2026-08-15T12:00:00.000Z', posted_date: '2026-06-20T09:00:00.000Z',
    tags: ['rope access', 'inspection', 'maintenance'], verified: false, category_ids: [categoryIds['rope-access'], categoryIds['industrial-maintenance']]
  });
  createContract({
    source_id: source.id,
    external_id: 'DEMO-WIND-002',
    title: 'Wind Turbine Blade Inspection Support',
    description: 'Demonstration listing for specialist access teams supporting blade inspection, documentation and preventive maintenance activities across a wind farm portfolio.',
    source_name: 'Demo Procurement Source',
    source_url: 'https://bidplus.gem.gov.in/all-bids',
    country: 'India', industry: 'Renewable Energy', contract_type: 'Framework', buyer_type: 'private', work_mode: 'onsite',
    budget_value: 12500000, currency: 'INR', deadline: '2026-09-01T12:00:00.000Z', posted_date: '2026-06-19T09:00:00.000Z',
    tags: ['wind turbine', 'blade inspection', 'preventive maintenance'], verified: false, category_ids: [categoryIds['wind-energy']]
  });
  createContract({
    source_id: source.id,
    external_id: 'DEMO-CONSULT-003',
    title: 'Remote Technical Safety Consultancy Framework',
    description: 'Demonstration listing for qualified consultants to support access planning, risk review, method statements and technical safety documentation.',
    source_name: 'Demo Procurement Source',
    source_url: 'https://www.contractsfinder.service.gov.uk/Search',
    country: 'United Kingdom', industry: 'Professional Services', contract_type: 'Framework', buyer_type: 'government', work_mode: 'remote',
    budget_value: 150000, currency: 'GBP', deadline: '2026-07-30T16:00:00.000Z', posted_date: '2026-06-18T09:00:00.000Z',
    tags: ['safety consultancy', 'remote', 'risk assessment'], verified: false, category_ids: [categoryIds['technical-consultancy']]
  });
}

console.log('Seed complete. Demo credentials are documented in README.md; change them before any public deployment.');
