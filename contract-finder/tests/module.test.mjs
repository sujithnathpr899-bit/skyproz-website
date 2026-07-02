import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'skyproz-contract-finder-'));
process.env.DATABASE_PATH = path.join(directory, 'test.db');
process.env.SESSION_SECRET = 'test-secret-with-more-than-thirty-two-characters';

const { migrate, db } = await import('../src/db.mjs');
const { createContract, searchContracts, updateContract, removeDuplicateContracts } = await import('../src/contracts.mjs');
const { hashPassword, verifyPassword } = await import('../src/auth.mjs');
const { analyzeOpportunity, listKeywords } = await import('../src/services/procurement-bot.mjs');
const { connectorLogs, connectorStatus, importSource, testSourceConnection } = await import('../src/services/importer.mjs');
const { inferFieldMappingFromSamples, marketplaceSnapshot, runSourceDiscovery } = await import('../src/services/source-discovery.mjs');
const { saveWizardConfiguration, testWizardConfiguration } = await import('../src/services/connector-wizard.mjs');
const { connectorExpansionTemplates } = await import('../src/connectors/template-catalog.mjs');
const privateRssConnector = (await import('../src/connectors/private-rss.mjs')).default;
const { buildPortalOpportunity } = await import('../src/connectors/enterprise-portal.mjs');

migrate();

test('migration creates required contract module tables', () => {
  const names = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((row) => row.name));
  for (const table of ['contracts','contract_sources','saved_searches','user_alerts','user_favorites','contract_categories','watchlists','source_discovery_results','duplicate_merge_runs']) assert.ok(names.has(table), `${table} should exist`);
});

test('password hashes verify without storing plaintext', async () => {
  const hash = await hashPassword('Strong-Test-Password!');
  assert.equal(await verifyPassword('Strong-Test-Password!', hash), true);
  assert.equal(await verifyPassword('wrong-password', hash), false);
  assert.equal(hash.includes('Strong-Test-Password!'), false);
});

test('contracts can be created, filtered, updated and paginated', () => {
  const created = createContract({
    title: 'Rope Access Maintenance Contract', description: 'Inspection and painting at height', source_name: 'Test Source',
    source_url: 'https://example.test/contract', country: 'India', industry: 'Industrial Services', contract_type: 'Services',
    buyer_type: 'government', work_mode: 'onsite', budget_value: 500000, currency: 'INR', deadline: '2026-09-01',
    posted_date: '2026-06-21', tags: ['rope access','painting']
  });
  assert.ok(created.id);
  const search = searchContracts({ keyword: 'rope access', country: 'India', min_budget: 100000, page_size: 10 });
  assert.equal(search.pagination.total, 1);
  assert.equal(search.items[0].title, created.title);
  const updated = updateContract(created.id, { verified: true, work_mode: 'hybrid' });
  assert.equal(updated.verified, true);
  assert.equal(updated.work_mode, 'hybrid');
});

test('duplicate cleanup retains one matching contract', () => {
  createContract({ title: 'Duplicate Notice', description: 'One', source_name: 'A', source_url: 'https://a.test', country: 'India', industry: 'Marine', contract_type: 'Services', deadline: '2026-10-01', posted_date: '2026-06-21' });
  createContract({ title: 'Duplicate Notice', description: 'Two', source_name: 'B', source_url: 'https://b.test', country: 'India', industry: 'Marine', contract_type: 'Services', deadline: '2026-10-01', posted_date: '2026-06-21' });
  assert.equal(removeDuplicateContracts(), 1);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM contracts WHERE title = 'Duplicate Notice'").get().count, 1);
});

test('AI procurement bot matches Skyproz service keywords', () => {
  const keywords = listKeywords({ activeOnly: true });
  assert.ok(keywords.length >= 40);
  const intelligence = analyzeOpportunity({
    title: 'Rope access industrial painting and marine maintenance tender',
    description: 'IRATA rope access, protective coating, ship repair and shutdown maintenance support.',
    source_url: 'https://example.test/tender',
    country: 'United Arab Emirates',
    industry: 'Marine Industrial Services',
    contract_type: 'Tender',
    budget_value: 250000,
    currency: 'USD',
    deadline: '2026-09-01',
    tags: []
  }, keywords);
  assert.ok(intelligence.ai_score >= 75);
  assert.ok(intelligence.matching_services.includes('Rope Access'));
  assert.equal(intelligence.ai_priority, 'High');
});

test('private RSS connector classifies opportunities and preserves source links', () => {
  const contract = privateRssConnector.normalize({
    title: 'RFQ for industrial painting and rope access maintenance',
    description: 'Request for quotation covering protective coating and work at height support.',
    link: '../productdetail.asp?s1=industrial+painting+tender&r=100&s=1&bdt=09012026',
    published: '2026-07-01'
  }, {
    id: 99,
    name: 'Private RSS Test',
    source_url: 'https://www.tendernews.com/rss/latest-tenders.xml',
    country: 'Worldwide',
    source_type: 'private'
  });
  assert.equal(contract.buyer_type, 'private');
  assert.equal(contract.contract_type, 'RFQ');
  assert.equal(contract.industry, 'Rope Access');
  assert.equal(contract.source_url, 'https://www.tendernews.com/productdetail.asp?s1=industrial+painting+tender&r=100&s=1&bdt=09012026');
  assert.equal(contract.deadline, '2026-09-01T23:59:59.000Z');
  assert.ok(contract.tags.includes('Private Procurement'));
});

test('enterprise portal connector creates private vendor registration opportunities', () => {
  const source = {
    id: 101,
    name: 'ADNOC Supplier Hub',
    source_url: 'https://supplierhub.adnoc.ae/landing',
    country: 'United Arab Emirates',
    region: 'Middle East',
    source_type: 'private',
    parser_config_json: JSON.stringify({
      company_name: 'ADNOC',
      industry: 'Oil & Gas',
      procurement_platform: 'ADNOC Supplier Hub',
      vendor_registration_url: 'https://supplierhub.adnoc.ae/landing',
      services: ['Rope Access', 'Industrial Maintenance', 'Offshore Maintenance']
    }),
    metadata_json: '{}'
  };
  const contract = buildPortalOpportunity(source);
  assert.equal(contract.buyer_type, 'private');
  assert.equal(contract.buyer_name, 'ADNOC');
  assert.equal(contract.contract_type, 'Vendor Registration');
  assert.equal(contract.industry, 'Oil & Gas');
  assert.equal(contract.source_url, 'https://supplierhub.adnoc.ae/landing');
  assert.ok(contract.tags.includes('Private Enterprise'));
  assert.equal(contract.metadata.procurement_platform, 'ADNOC Supplier Hub');
});

test('connector manager tests, imports and logs a live RSS source', async () => {
  const rss = `<?xml version="1.0" encoding="UTF-8"?>
    <rss version="2.0"><channel><title>Mock Procurement</title><item>
      <title>Rope access industrial maintenance tender</title>
      <description>IRATA rope access support for protective coating and shutdown maintenance.</description>
      <link>https://example.test/tender/100</link>
      <guid>mock-100</guid>
      <pubDate>Wed, 01 Jul 2026 10:00:00 GMT</pubDate>
    </item></channel></rss>`;
  const server = http.createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'application/rss+xml' });
    response.end(rss);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const port = server.address().port;
    const parserConfig = {
      parser_type: 'rss',
      field_map: { external_id: 'id', title: 'title', description: 'description', source_url: 'link', posted_date: 'published' }
    };
    const sourceId = db.prepare(`INSERT INTO contract_sources(name, source_url, api_url, country, source_type, parser_type, parser_config_json,
      connector_key, source_format, schedule, is_active)
      VALUES (?, ?, ?, ?, 'government', 'json', ?, 'rss', 'rss', 'hourly', 1)`)
      .run('Mock RSS Connector', `http://127.0.0.1:${port}/`, `http://127.0.0.1:${port}/feed.xml`, 'India', JSON.stringify(parserConfig)).lastInsertRowid;
    let source = db.prepare('SELECT * FROM contract_sources WHERE id = ?').get(sourceId);
    const testResult = await testSourceConnection(source);
    assert.equal(testResult.ok, true);
    assert.equal(testResult.sample_contracts.length, 1);
    source = db.prepare('SELECT * FROM contract_sources WHERE id = ?').get(sourceId);
    const importResult = await importSource(source);
    assert.equal(importResult.imported, 1);
    assert.equal(importResult.failures.length, 0);
    const imported = db.prepare("SELECT ai_score, opportunity_score, source_url FROM contracts WHERE external_id = 'mock-100'").get();
    assert.ok(imported.ai_score > 0);
    assert.ok(imported.opportunity_score > 0);
    assert.equal(imported.source_url, 'https://example.test/tender/100');
    const logs = connectorLogs(sourceId);
    assert.ok(logs.some((log) => log.action === 'test'));
    assert.ok(logs.some((log) => log.action === 'import.complete'));
    const status = connectorStatus();
    assert.ok(status.summary.healthy_connectors >= 1);
    assert.ok(status.summary.contracts_imported_today >= 1);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('connector wizard tests, imports and enables a configured official feed', async () => {
  const rss = `<?xml version="1.0" encoding="UTF-8"?>
    <rss version="2.0"><channel><title>Wizard Procurement</title><item>
      <title>Wizard rope access maintenance RFQ</title>
      <description>Industrial rope access maintenance and coating support.</description>
      <link>https://example.test/tender/wizard-100</link>
      <guid>wizard-100</guid>
      <pubDate>Thu, 02 Jul 2026 10:00:00 GMT</pubDate>
    </item></channel></rss>`;
  const server = http.createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'application/rss+xml' });
    response.end(rss);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const endpoint = `http://127.0.0.1:${server.address().port}/feed.xml`;
    const config = {
      name: 'Wizard RSS Connector',
      connector_key: 'rss',
      source_url: endpoint,
      rss_url: endpoint,
      source_format: 'rss',
      country: 'India',
      source_type: 'government',
      schedule: 'hourly',
      api_documentation_url: 'https://example.test/docs',
      field_mapping: { external_id: 'id', title: 'title', description: 'description', source_url: 'link', posted_date: 'published' }
    };
    const testResult = await testWizardConfiguration(config);
    assert.equal(testResult.diagnostics.http_code, 200);
    assert.equal(testResult.test.ok, true);
    assert.equal(testResult.preview_contracts.length, 1);
    assert.equal(testResult.field_mapping.mapping.title, 'title');

    const saved = await saveWizardConfiguration({ ...config, enable: true });
    assert.equal(saved.working, true);
    assert.equal(saved.import.imported, 1);
    assert.equal(saved.import.failures.length, 0);
    const source = db.prepare('SELECT is_active, availability_status, scheduler_status FROM contract_sources WHERE id = ?').get(saved.id);
    assert.equal(source.is_active, 1);
    assert.equal(source.availability_status, 'verified');
    assert.equal(source.scheduler_status, 'scheduled');
    const contract = db.prepare("SELECT title, source_url FROM contracts WHERE external_id = 'wizard-100'").get();
    assert.equal(contract.title, 'Wizard rope access maintenance RFQ');
    assert.equal(contract.source_url, 'https://example.test/tender/wizard-100');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('connector expansion pack contains only inactive requires-configuration templates', () => {
  const requiredNames = [
    'UNOPS', 'Inter-American Development Bank', 'OECD procurement', 'UK Find a Tender',
    'NATO public procurement', 'World Bank', 'ADB', 'AfDB', 'EIB',
    'ADNOC', 'Saudi Aramco', 'QatarEnergy', 'Shell', 'BP', 'Chevron', 'ExxonMobil',
    'TotalEnergies', 'Equinor', 'PETRONAS',
    'Bechtel', 'Fluor', 'Worley', 'Petrofac', 'Technip Energies', 'Saipem',
    'TechnipFMC', 'KBR', 'Larsen & Toubro',
    'Drydocks World', 'Damen', 'Keppel', 'Hyundai Heavy Industries',
    'Samsung Heavy Industries', 'Cochin Shipyard', 'Mazagon Dock',
    'GE Vernova', 'Vestas', 'Siemens Gamesa', 'Ørsted', 'Suzlon', 'ABB', 'Hitachi Energy',
    'CBRE', 'JLL', 'Cushman & Wakefield', 'ISS', 'Sodexo', 'Mitie', 'EMCOR', 'Emrill', 'Farnek'
  ];
  const names = new Set(connectorExpansionTemplates.map((template) => template.name));
  for (const name of requiredNames) assert.ok(names.has(name), `${name} template should exist`);
  assert.equal(connectorExpansionTemplates.length, requiredNames.length);
  for (const template of connectorExpansionTemplates) {
    assert.equal(template.is_active, false);
    assert.equal(template.template_status, 'requires_configuration');
    assert.equal(template.health_status, 'requires_configuration');
    assert.equal(template.source_url, null);
    assert.equal(template.api_url, null);
    assert.equal(template.import_statistics.imported, 0);
    assert.equal(template.import_statistics.failures, 0);
    assert.equal(template.capabilities.health_monitoring, true);
    assert.equal(template.capabilities.import_statistics, true);
    assert.equal(template.capabilities.ai_relevance_score, true);
    assert.equal(template.capabilities.duplicate_detection, true);
  }
});

test('source discovery infers field mappings and keeps unconfigured templates inactive', () => {
  const inferred = inferFieldMappingFromSamples([{
    notice_title: 'Industrial maintenance tender',
    notice_text: 'Rope access and coating support',
    contact_organization: 'Example Buyer',
    submission_deadline_date: '2026-09-01',
    detail_url: 'https://example.test/notice'
  }]);
  assert.equal(inferred.mapping.title, 'notice_title');
  assert.equal(inferred.mapping.description, 'notice_text');
  assert.equal(inferred.mapping.buyer, 'contact_organization');
  assert.equal(inferred.mapping.deadline, 'submission_deadline_date');
  assert.equal(inferred.mapping.source_url, 'detail_url');
  assert.ok(inferred.confidence > 30);

  const discovery = runSourceDiscovery();
  assert.ok(discovery.summary.total >= connectorExpansionTemplates.length);
  assert.ok(discovery.summary.requires_configuration >= connectorExpansionTemplates.length);
  const expansionItems = discovery.items.filter((item) => !item.source_id);
  assert.equal(expansionItems.length, connectorExpansionTemplates.length);
  for (const item of expansionItems) {
    assert.equal(item.status, 'requires_configuration');
    assert.equal(item.endpoint_availability.official_api_available, false);
    assert.equal(item.endpoint_availability.rss_available, false);
    assert.equal(item.endpoint_availability.json_available, false);
    assert.equal(item.endpoint_availability.xml_available, false);
    assert.equal(item.endpoint_availability.csv_available, false);
  }

  const marketplace = marketplaceSnapshot();
  assert.ok(marketplace.items.length >= connectorExpansionTemplates.length);
  const unsupportedInstalls = marketplace.items.filter((item) => !item.source_id && item.install_supported);
  assert.equal(unsupportedInstalls.length, 0);
});

test.after(() => {
  db.close();
  fs.rmSync(directory, { recursive: true, force: true });
});
