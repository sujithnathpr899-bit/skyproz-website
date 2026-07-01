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
