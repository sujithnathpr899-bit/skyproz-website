import assert from 'node:assert/strict';
import fs from 'node:fs';
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
const privateRssConnector = (await import('../src/connectors/private-rss.mjs')).default;
const { buildPortalOpportunity } = await import('../src/connectors/enterprise-portal.mjs');

migrate();

test('migration creates required contract module tables', () => {
  const names = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((row) => row.name));
  for (const table of ['contracts','contract_sources','saved_searches','user_alerts','user_favorites','contract_categories','watchlists']) assert.ok(names.has(table), `${table} should exist`);
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

test.after(() => {
  db.close();
  fs.rmSync(directory, { recursive: true, force: true });
});
