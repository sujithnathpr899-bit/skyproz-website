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
const { createSession, hashPassword, sessionCookie, verifyPassword } = await import('../src/auth.mjs');
const { handleApi } = await import('../src/api.mjs');
const { renderShell } = await import('../src/views.mjs');
const {
  createPrivateOpportunity,
  createPrivateSource,
  getPrivateOpportunity,
  importPrivateSource,
  privateOpportunityDashboard,
  searchPrivateOpportunities,
  testPrivateSource
} = await import('../src/private-opportunities.mjs');
const { analyzeOpportunity, listKeywords } = await import('../src/services/procurement-bot.mjs');
const { connectorLogs, connectorStatus, importSource, testSourceConnection } = await import('../src/services/importer.mjs');
const { inferFieldMappingFromSamples, marketplaceSnapshot, runSourceDiscovery } = await import('../src/services/source-discovery.mjs');
const { saveWizardConfiguration, testWizardConfiguration } = await import('../src/services/connector-wizard.mjs');
const { connectorExpansionTemplates } = await import('../src/connectors/template-catalog.mjs');
const privateRssConnector = (await import('../src/connectors/private-rss.mjs')).default;
const { buildPortalOpportunity } = await import('../src/connectors/enterprise-portal.mjs');
const {
  addWorkerExperience,
  adminUpdateDocument,
  adminUpdateWorker,
  applyToJob,
  authenticateWorker,
  createWorker,
  createWorkerJob,
  getWorkerDocumentDownload,
  listSavedJobs,
  listWorkerApplications,
  listWorkerExperience,
  listWorkerNotifications,
  markWorkerNotification,
  replaceWorkerDocument,
  saveJob,
  searchJobs,
  updateWorkerProfile,
  updateWorkerSettings,
  uploadWorkerDocument,
  workerDashboard
} = await import('../src/workers.mjs');
const {
  createErpRecord,
  erpDashboard,
  erpPdf,
  exportErpCsv,
  getErpRecord,
  listErpModules,
  listErpRecords,
  runErpAction,
  updateErpRecord
} = await import('../src/erp.mjs');

migrate();

test('migration creates required contract module tables', () => {
  const names = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((row) => row.name));
  for (const table of ['contracts','contract_sources','saved_searches','user_alerts','user_favorites','contract_categories','watchlists','source_discovery_results','duplicate_merge_runs','workers','worker_documents','worker_jobs','worker_saved_jobs','worker_applications','private_opportunities','private_opportunity_sources','private_opportunity_source_logs','erp_records','erp_line_items','erp_documents','erp_activity','erp_settings','erp_counters']) assert.ok(names.has(table), `${table} should exist`);
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
  const denseSearch = searchContracts({ status: 'open', page_size: 100, sort: 'score:desc,title:asc' });
  assert.equal(denseSearch.pagination.page_size, 100);
  assert.ok(denseSearch.items.some((item) => item.id === created.id));
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

test('private opportunities support admin-only building maintenance pipeline', async () => {
  const feed = {
    items: [
      {
        id: 'private-100',
        company: 'Metro Mall Facilities',
        title: 'AMC for high rise glass cleaning and facade maintenance',
        description: 'Public RFQ for rope access, glass cleaning, facade repairs, waterproofing and annual maintenance services.',
        url: 'https://example.test/private/rfq-100',
        country: 'India',
        state: 'Kerala',
        city: 'Kochi',
        industry: 'Shopping Malls',
        deadline: '2026-09-20',
        budget_value: 1200000,
        currency: 'INR'
      }
    ]
  };
  const server = http.createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify(feed));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const endpoint = `http://127.0.0.1:${server.address().port}/opportunities.json`;
    const source = createPrivateSource({
      name: 'Metro Mall Public RFQ Feed',
      source_type: 'json',
      source_url: 'https://example.test/private',
      endpoint_url: endpoint,
      country: 'India',
      state: 'Kerala',
      city: 'Kochi',
      industry: 'Shopping Malls',
      is_active: true,
      parser_config: {
        parser_type: 'json',
        items_path: 'items',
        field_map: {
          external_id: 'id',
          company: 'company',
          title: 'title',
          description: 'description',
          source_url: 'url',
          country: 'country',
          state: 'state',
          city: 'city',
          industry: 'industry',
          deadline: 'deadline',
          budget_value: 'budget_value',
          currency: 'currency'
        }
      }
    });
    const testResult = await testPrivateSource(source.id);
    assert.equal(testResult.ok, true);
    assert.equal(testResult.sample_opportunities.length, 1);
    const importResult = await importPrivateSource(source.id);
    assert.equal(importResult.imported, 1);
    assert.equal(importResult.failures.length, 0);
    const search = searchPrivateOpportunities({ service: 'Rope Access', page_size: 100 });
    assert.equal(search.pagination.total, 1);
    assert.ok(search.items[0].match_score >= 70);
    assert.ok(search.items[0].required_services.includes('Glass Cleaning'));
    const leadCategory = searchPrivateOpportunities({ lead_category: 'Shopping Malls', page_size: 100 });
    assert.equal(leadCategory.pagination.total, 1);
    const detail = getPrivateOpportunity(search.items[0].slug);
    assert.equal(detail.company, 'Metro Mall Facilities');
    assert.equal(detail.original_source_url, 'https://example.test/private/rfq-100');
    assert.ok(detail.required_certifications.includes('IRATA Rope Access Certification'));
    const dashboard = privateOpportunityDashboard();
    assert.ok(dashboard.total_opportunities >= 1);
    assert.ok(dashboard.amc_opportunities >= 1);
    assert.ok(dashboard.rope_access_opportunities >= 1);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('private opportunities API is admin only', async () => {
  const userId = db.prepare(`INSERT INTO users(email, password_hash, display_name, role, plan)
    VALUES (?, ?, ?, 'user', 'free')`).run('private-user@example.com', 'test', 'Private User').lastInsertRowid;
  const adminId = db.prepare(`INSERT INTO users(email, password_hash, display_name, role, plan)
    VALUES (?, ?, ?, 'admin', 'premium')`).run('private-admin@example.com', 'test', 'Private Admin').lastInsertRowid;
  const userSession = createSession(Number(userId));
  const adminSession = createSession(Number(adminId));
  const userCookie = sessionCookie(userSession.value, userSession.expiresAt).split(';')[0];
  const adminCookie = sessionCookie(adminSession.value, adminSession.expiresAt).split(';')[0];
  const server = http.createServer(async (request, response) => {
    const handled = await handleApi(request, response, new URL(request.url, 'http://127.0.0.1'));
    if (!handled) { response.writeHead(404); response.end(); }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const publicResponse = await fetch(`${base}/api/contract-finder/admin/private-opportunities`);
    assert.equal(publicResponse.status, 401);
    const userResponse = await fetch(`${base}/api/contract-finder/admin/private-opportunities`, { headers: { cookie: userCookie } });
    assert.equal(userResponse.status, 403);
    const adminResponse = await fetch(`${base}/api/contract-finder/admin/private-opportunities`, { headers: { cookie: adminCookie } });
    assert.equal(adminResponse.status, 200);
    assert.equal(adminResponse.headers.get('x-robots-tag'), 'noindex, nofollow');
    const payload = await adminResponse.json();
    assert.ok(payload.dashboard);
    assert.ok(payload.opportunities);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('admin pages are noindexed and do not emit public SEO metadata', () => {
  const html = renderShell({ page: 'admin' });
  assert.match(html, /<meta name="robots" content="noindex,nofollow,noarchive">/);
  assert.equal(html.includes('property="og:title"'), false);
  assert.equal(html.includes('application/ld+json'), false);
  assert.match(html, /href="\/admin\/dashboard"/);
});

test('ERP modules support database CRUD, GST calculations, exports and conversions', () => {
  const modules = listErpModules();
  for (const key of ['crm','customers','companies','quotations','proforma-invoices','invoices','payment-receipts','work-orders','job-cards','amc','purchase-orders','vendors','inventory','expenses','financial-dashboard','reports','documents','company-profile','users','roles-permissions','audit-logs','email-templates','whatsapp-templates','settings']) {
    assert.ok(modules.find((module) => module.key === key), `${key} module should be registered`);
  }
  const quotation = createErpRecord('quotations', {
    title: 'Rope access facade maintenance quote',
    status: 'sent',
    customer_name: 'Metro Mall Facilities',
    company_name: 'Metro Mall Pvt Ltd',
    issue_date: '2026-07-07',
    due_date: '2026-08-07',
    gst_type: 'cgst_sgst',
    line_items: [
      { description: 'High-rise glass cleaning', hsn_sac: '998533', quantity: 2, unit_price: 50000, gst_rate: 18 },
      { description: 'Facade inspection report', hsn_sac: '998346', quantity: 1, unit_price: 25000, gst_rate: 18 }
    ]
  }, { id: 1 });
  assert.match(quotation.record_number, /^SKY-QTN-/);
  assert.equal(quotation.amount, 125000);
  assert.equal(quotation.tax_amount, 22500);
  assert.equal(quotation.total_amount, 147500);
  assert.equal(quotation.line_items.length, 2);
  const updated = updateErpRecord('quotations', quotation.id, { status: 'accepted', notes: 'Customer approved by email.' }, { id: 1 });
  assert.equal(updated.status, 'accepted');
  const list = listErpRecords('quotations', { keyword: 'facade', page_size: 10 });
  assert.ok(list.pagination.total >= 1);
  const invoiceAction = runErpAction('quotations', quotation.id, 'convert-to-invoice', { id: 1 });
  assert.equal(invoiceAction.created.module_key, 'invoices');
  const workOrderAction = runErpAction('quotations', quotation.id, 'convert-to-work-order', { id: 1 });
  assert.equal(workOrderAction.created.module_key, 'work-orders');
  assert.match(exportErpCsv('quotations'), /Rope access facade maintenance quote/);
  assert.ok(erpPdf('quotations', quotation.id).length > 100);
  const detail = getErpRecord('quotations', quotation.id);
  assert.ok(detail.activity.length >= 1);
  const dashboard = erpDashboard();
  assert.ok(dashboard.total_records >= 3);
});

test('worker portal supports registration, jobs, applications and documents', async () => {
  const worker = await createWorker({
    full_name: 'Anoop Rope Tech',
    mobile_number: '+919400000001',
    email: 'anoop.worker@example.com',
    country: 'India',
    nationality: 'Indian',
    current_location: 'Kerala',
    date_of_birth: '1992-05-12',
    passport_number: 'Z1234567',
    trade_profession: 'Rope Access Technician',
    years_experience: 6,
    highest_qualification: 'Diploma',
    skills: ['Rope Access', 'IRATA Level 2', 'Painting'],
    password: 'Worker-Password-2026!',
    confirm_password: 'Worker-Password-2026!'
  });
  assert.ok(worker.id);
  const authenticated = await authenticateWorker('anoop.worker@example.com', 'Worker-Password-2026!');
  assert.equal(authenticated.id, worker.id);
  const updated = updateWorkerProfile(worker.id, {
    availability: 'Available in 2 Weeks',
    preferred_countries: ['UAE', 'Qatar'],
    preferred_salary: 'USD 2800',
    professional_title: 'IRATA Rope Access Painter',
    languages: ['English', 'Hindi'],
    biography: 'Industrial rope access technician available for shutdown and offshore projects.',
    emergency_contact_name: 'Emergency Contact',
    emergency_contact_phone: '+919400000002',
    emergency_contact_relationship: 'Brother'
  });
  assert.ok(updated.profile_completion >= worker.profile_completion);
  assert.equal(updated.professional_title, 'IRATA Rope Access Painter');
  addWorkerExperience(worker.id, { company: 'Skyproz Yard', position: 'Rope Access Painter', country: 'India', start_date: '2022-01-01', end_date: '2025-12-31', description: 'Painting and inspection at height.' });
  assert.equal(listWorkerExperience(worker.id).length, 1);
  const settings = updateWorkerSettings(worker.id, { notification_settings: { email_alerts: true, application_updates: true }, privacy_settings: { profile_visible: true } });
  assert.equal(settings.notification_settings.email_alerts, true);

  const job = createWorkerJob({
    title: 'Rope Access Painter',
    company: 'Skyproz Test Mobilisation',
    country: 'Qatar',
    industry: 'Oil & Gas',
    trade: 'Rope Access',
    job_type: 'Shutdown',
    salary_min: 2000,
    salary_max: 3200,
    currency: 'USD',
    experience_required: 3,
    description: 'Industrial rope access painting support.',
    requirements: ['IRATA certificate', 'Painting experience']
  });
  const jobs = searchJobs({ country: 'Qatar', trade: 'Rope Access' }, worker.id);
  assert.equal(jobs.pagination.total, 1);
  assert.equal(jobs.items[0].id, job.id);
  saveJob(worker.id, job.id);
  applyToJob(worker.id, job.id, 'Ready for mobilisation.');
  assert.equal(listSavedJobs(worker.id).length, 1);
  assert.equal(listWorkerApplications(worker.id).length, 1);
  const notifications = listWorkerNotifications(worker.id);
  assert.ok(notifications.length >= 2);
  assert.equal(markWorkerNotification(worker.id, notifications[0].id).is_read, true);

  const document = uploadWorkerDocument(worker.id, {
    document_type: 'CV / Resume',
    filename: 'anoop-cv.pdf',
    content_type: 'application/pdf',
    content_base64: Buffer.from('%PDF-1.4 worker cv').toString('base64')
  });
  assert.equal(document.status, 'pending');
  const download = getWorkerDocumentDownload(worker.id, document.id);
  assert.ok(download.body.length > 0);
  const replacement = replaceWorkerDocument(worker.id, document.id, {
    document_type: 'CV / Resume',
    document_name: 'Updated CV',
    filename: 'anoop-cv-updated.pdf',
    content_type: 'application/pdf',
    content_base64: Buffer.from('%PDF-1.4 updated worker cv').toString('base64')
  });
  assert.equal(replacement.document_name, 'Updated CV');
  const approved = adminUpdateDocument(replacement.id, { status: 'approved', reviewer_note: 'Verified sample document' });
  assert.equal(approved.status, 'approved');
  assert.equal(adminUpdateWorker(worker.id, { profile_verified: true }).profile_verified, true);
  const dashboard = workerDashboard(worker.id);
  assert.equal(dashboard.counts.saved_jobs, 1);
  assert.equal(dashboard.counts.applied_jobs, 1);
  assert.ok(dashboard.counts.uploaded_documents >= 1);
  assert.ok(dashboard.worker.verification_badges.some((badge) => badge.label === 'Documents Verified' && badge.verified));
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

test('first imports use initial limit and later imports skip unchanged duplicates', async () => {
  const items = Array.from({ length: 8 }, (_, index) => {
    const id = `volume-${index + 1}`;
    return `<item>
      <title>Volume test rope access contract ${index + 1}</title>
      <description>Official feed item for industrial rope access maintenance ${index + 1}.</description>
      <link>https://example.test/tender/${id}</link>
      <guid>${id}</guid>
      <pubDate>Thu, 02 Jul 2026 10:0${index}:00 GMT</pubDate>
    </item>`;
  }).join('');
  const rss = `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>Volume Procurement</title>${items}</channel></rss>`;
  const server = http.createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'application/rss+xml' });
    response.end(rss);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const endpoint = `http://127.0.0.1:${server.address().port}/feed.xml`;
    const parserConfig = {
      parser_type: 'rss',
      field_map: { external_id: 'id', title: 'title', description: 'description', source_url: 'link', posted_date: 'published' },
      limit: 1
    };
    const sourceId = db.prepare(`INSERT INTO contract_sources(name, source_url, api_url, country, source_type, parser_type, parser_config_json,
      connector_key, source_format, schedule, is_active, initial_import_limit, daily_import_limit)
      VALUES (?, ?, ?, ?, 'government', 'json', ?, 'rss', 'rss', 'hourly', 1, 7, 3)`)
      .run('Volume RSS Connector', endpoint, endpoint, 'India', JSON.stringify(parserConfig)).lastInsertRowid;
    let source = db.prepare('SELECT * FROM contract_sources WHERE id = ?').get(sourceId);
    const first = await importSource(source);
    assert.equal(first.import_mode, 'initial');
    assert.equal(first.applied_limit, 7);
    assert.equal(first.imported, 7);
    assert.equal(first.duplicate_skipped, 0);

    source = db.prepare('SELECT * FROM contract_sources WHERE id = ?').get(sourceId);
    const second = await importSource(source);
    assert.equal(second.import_mode, 'daily');
    assert.equal(second.applied_limit, 3);
    assert.equal(second.imported, 0);
    assert.equal(second.updated, 0);
    assert.equal(second.duplicate_skipped, 3);
    assert.equal(second.skipped, 3);
    const stored = db.prepare('SELECT contracts_imported, duplicates_skipped FROM contract_sources WHERE id = ?').get(sourceId);
    assert.equal(stored.contracts_imported, 7);
    assert.equal(stored.duplicates_skipped, 3);
    const lastRun = db.prepare('SELECT duplicate_skipped_count FROM import_runs WHERE source_id = ? ORDER BY id DESC LIMIT 1').get(sourceId);
    assert.equal(lastRun.duplicate_skipped_count, 3);
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
