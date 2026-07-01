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

test.after(() => {
  db.close();
  fs.rmSync(directory, { recursive: true, force: true });
});
