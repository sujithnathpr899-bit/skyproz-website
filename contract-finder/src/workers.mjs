import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { db, parseJson, activeDatabasePath } from './db.mjs';
import { hashPassword, verifyPassword } from './auth.mjs';
import { normalizeIsoDate, slugify } from './utils.mjs';

export const WORKER_SKILLS = [
  'Rope Access', 'IRATA Level 1', 'IRATA Level 2', 'IRATA Level 3', 'NDT', 'Welding',
  'Painting', 'Scaffolding', 'Electrical', 'Mechanical', 'Rigging', 'Crane Operations',
  'Offshore', 'Wind Turbine', 'Inspection', 'Fabrication', 'Other'
];

export const DOCUMENT_TYPES = [
  'CV / Resume', 'Passport', 'IRATA Certificate', 'NDT Certificate', 'Trade Certificate',
  'Medical Certificate', 'Experience Certificates'
];

const ALLOWED_EXTENSIONS = new Set(['.pdf', '.doc', '.docx', '.jpg', '.jpeg', '.png']);
const ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'image/jpeg',
  'image/png'
]);
const MAX_DOCUMENT_BYTES = 5 * 1024 * 1024;

function clean(value, fallback = '') {
  return String(value ?? fallback).trim();
}

function numberValue(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.round(number)) : fallback;
}

function stringList(value) {
  if (Array.isArray(value)) return value.map((item) => clean(item)).filter(Boolean);
  if (typeof value === 'string') return value.split(',').map((item) => clean(item)).filter(Boolean);
  return [];
}

function validSkills(value) {
  return stringList(value).filter((skill) => WORKER_SKILLS.includes(skill));
}

function profileCompletion(worker) {
  const fields = [
    worker.full_name, worker.mobile_number, worker.email, worker.country, worker.nationality,
    worker.current_location, worker.date_of_birth, worker.trade_profession,
    worker.highest_qualification, worker.availability, worker.preferred_salary
  ];
  const skills = stringList(worker.skills || worker.skills_json);
  const preferredCountries = stringList(worker.preferred_countries || worker.preferred_countries_json);
  const complete = fields.filter((value) => clean(value)).length + (skills.length ? 1 : 0) + (preferredCountries.length ? 1 : 0);
  return Math.round((complete / 13) * 100);
}

function serializeWorker(row) {
  if (!row) return null;
  return {
    id: row.id,
    full_name: row.full_name,
    mobile_number: row.mobile_number,
    email: row.email,
    country: row.country,
    nationality: row.nationality,
    current_location: row.current_location,
    date_of_birth: row.date_of_birth,
    passport_number: row.passport_number,
    trade_profession: row.trade_profession,
    years_experience: row.years_experience,
    highest_qualification: row.highest_qualification,
    skills: parseJson(row.skills_json, []),
    availability: row.availability,
    preferred_countries: parseJson(row.preferred_countries_json, []),
    preferred_salary: row.preferred_salary,
    profile_completion: row.profile_completion,
    profile_verified: Boolean(row.profile_verified),
    status: row.status,
    last_login_at: row.last_login_at,
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

function serializeJob(row) {
  if (!row) return null;
  return {
    ...row,
    requirements: parseJson(row.requirements_json, []),
    is_saved: row.is_saved === undefined ? undefined : Boolean(row.is_saved),
    application_status: row.application_status || null
  };
}

function serializeDocument(row) {
  if (!row) return null;
  return {
    id: row.id,
    worker_id: row.worker_id,
    document_type: row.document_type,
    original_filename: row.original_filename,
    content_type: row.content_type,
    size_bytes: row.size_bytes,
    status: row.status,
    reviewer_note: row.reviewer_note,
    uploaded_at: row.uploaded_at,
    reviewed_at: row.reviewed_at
  };
}

function requireFields(input, fields) {
  for (const field of fields) {
    if (!clean(input[field])) throw Object.assign(new Error(`${field} is required`), { status: 400 });
  }
}

export async function createWorker(input) {
  requireFields(input, ['full_name', 'mobile_number', 'email', 'country', 'nationality', 'current_location', 'date_of_birth', 'trade_profession', 'highest_qualification', 'password']);
  if (String(input.password).length < 10) throw Object.assign(new Error('Password must be at least 10 characters'), { status: 400 });
  if (input.confirm_password !== undefined && input.password !== input.confirm_password) throw Object.assign(new Error('Passwords do not match'), { status: 400 });
  const worker = {
    full_name: clean(input.full_name),
    mobile_number: clean(input.mobile_number),
    email: clean(input.email).toLowerCase(),
    country: clean(input.country),
    nationality: clean(input.nationality),
    current_location: clean(input.current_location),
    date_of_birth: clean(input.date_of_birth),
    passport_number: clean(input.passport_number) || null,
    trade_profession: clean(input.trade_profession),
    years_experience: numberValue(input.years_experience),
    highest_qualification: clean(input.highest_qualification),
    skills: validSkills(input.skills),
    availability: clean(input.availability, 'available'),
    preferred_countries: stringList(input.preferred_countries),
    preferred_salary: clean(input.preferred_salary) || null
  };
  worker.profile_completion = profileCompletion(worker);
  const passwordHash = await hashPassword(input.password);
  let result;
  try {
    result = db.prepare(`INSERT INTO workers(
      full_name, mobile_number, email, country, nationality, current_location, date_of_birth,
      passport_number, trade_profession, years_experience, highest_qualification, password_hash,
      skills_json, availability, preferred_countries_json, preferred_salary, profile_completion
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      worker.full_name, worker.mobile_number, worker.email, worker.country, worker.nationality,
      worker.current_location, worker.date_of_birth, worker.passport_number, worker.trade_profession,
      worker.years_experience, worker.highest_qualification, passwordHash, JSON.stringify(worker.skills),
      worker.availability, JSON.stringify(worker.preferred_countries), worker.preferred_salary,
      worker.profile_completion
    );
  } catch (error) {
    if (String(error.message).includes('UNIQUE')) throw Object.assign(new Error('A worker account with this email already exists'), { status: 409 });
    throw error;
  }
  return getWorker(result.lastInsertRowid);
}

export async function authenticateWorker(email, password) {
  const row = db.prepare("SELECT * FROM workers WHERE email = ? COLLATE NOCASE AND status <> 'suspended'").get(clean(email));
  if (!row || !(await verifyPassword(password, row.password_hash))) throw Object.assign(new Error('Invalid email or password'), { status: 401 });
  db.prepare('UPDATE workers SET last_login_at = CURRENT_TIMESTAMP WHERE id = ?').run(row.id);
  return getWorker(row.id);
}

export function getWorker(id) {
  return serializeWorker(db.prepare('SELECT * FROM workers WHERE id = ?').get(id));
}

export function updateWorkerProfile(workerId, input) {
  const current = db.prepare('SELECT * FROM workers WHERE id = ?').get(workerId);
  if (!current) throw Object.assign(new Error('Worker not found'), { status: 404 });
  const next = {
    ...serializeWorker(current),
    full_name: clean(input.full_name, current.full_name),
    mobile_number: clean(input.mobile_number, current.mobile_number),
    country: clean(input.country, current.country),
    nationality: clean(input.nationality, current.nationality),
    current_location: clean(input.current_location, current.current_location),
    date_of_birth: clean(input.date_of_birth, current.date_of_birth),
    passport_number: input.passport_number === undefined ? current.passport_number : clean(input.passport_number) || null,
    trade_profession: clean(input.trade_profession, current.trade_profession),
    years_experience: input.years_experience === undefined ? current.years_experience : numberValue(input.years_experience),
    highest_qualification: clean(input.highest_qualification, current.highest_qualification),
    skills: input.skills === undefined ? parseJson(current.skills_json, []) : validSkills(input.skills),
    availability: clean(input.availability, current.availability),
    preferred_countries: input.preferred_countries === undefined ? parseJson(current.preferred_countries_json, []) : stringList(input.preferred_countries),
    preferred_salary: input.preferred_salary === undefined ? current.preferred_salary : clean(input.preferred_salary) || null
  };
  next.profile_completion = profileCompletion(next);
  db.prepare(`UPDATE workers SET
    full_name = ?, mobile_number = ?, country = ?, nationality = ?, current_location = ?,
    date_of_birth = ?, passport_number = ?, trade_profession = ?, years_experience = ?,
    highest_qualification = ?, skills_json = ?, availability = ?, preferred_countries_json = ?,
    preferred_salary = ?, profile_completion = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(
    next.full_name, next.mobile_number, next.country, next.nationality, next.current_location,
    next.date_of_birth, next.passport_number, next.trade_profession, next.years_experience,
    next.highest_qualification, JSON.stringify(next.skills), next.availability,
    JSON.stringify(next.preferred_countries), next.preferred_salary, next.profile_completion, workerId
  );
  return getWorker(workerId);
}

function uniqueJobSlug(title, country) {
  const base = slugify(`${title} ${country}`);
  let candidate = base;
  let counter = 2;
  while (db.prepare('SELECT id FROM worker_jobs WHERE slug = ?').get(candidate)) candidate = `${base}-${counter++}`;
  return candidate;
}

export function createWorkerJob(input) {
  requireFields(input, ['title', 'company', 'country', 'industry', 'trade', 'job_type', 'description']);
  const slug = uniqueJobSlug(input.title, input.country);
  const result = db.prepare(`INSERT INTO worker_jobs(
    slug, title, company, country, industry, trade, job_type, salary_min, salary_max,
    currency, experience_required, description, requirements_json, status, source_url, deadline
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    slug, clean(input.title), clean(input.company), clean(input.country), clean(input.industry),
    clean(input.trade), clean(input.job_type), input.salary_min ? numberValue(input.salary_min) : null,
    input.salary_max ? numberValue(input.salary_max) : null, clean(input.currency, 'USD'),
    numberValue(input.experience_required), clean(input.description), JSON.stringify(stringList(input.requirements)),
    clean(input.status, 'open'), clean(input.source_url) || null, normalizeIsoDate(input.deadline) || null
  );
  return getJob(result.lastInsertRowid);
}

export function searchJobs(filters = {}, workerId = null) {
  const page = Math.max(1, numberValue(filters.page, 1));
  const pageSize = Math.min(50, Math.max(10, numberValue(filters.page_size, 12)));
  const where = ["j.status = 'open'"];
  const values = [];
  if (filters.keyword) {
    const value = `%${clean(filters.keyword)}%`;
    where.push('(j.title LIKE ? OR j.description LIKE ? OR j.company LIKE ?)');
    values.push(value, value, value);
  }
  if (filters.company) { where.push('j.company LIKE ?'); values.push(`%${clean(filters.company)}%`); }
  for (const [key, column] of [['country', 'j.country'], ['industry', 'j.industry'], ['trade', 'j.trade'], ['job_type', 'j.job_type']]) {
    if (filters[key]) { where.push(`${column} = ?`); values.push(clean(filters[key])); }
  }
  if (filters.salary) { where.push('(j.salary_max IS NULL OR j.salary_max >= ?)'); values.push(numberValue(filters.salary)); }
  if (filters.experience) { where.push('j.experience_required <= ?'); values.push(numberValue(filters.experience)); }
  const whereSql = `WHERE ${where.join(' AND ')}`;
  const count = db.prepare(`SELECT COUNT(*) AS total FROM worker_jobs j ${whereSql}`).get(...values).total;
  const workerSelect = workerId
    ? ', EXISTS(SELECT 1 FROM worker_saved_jobs sj WHERE sj.worker_id = ? AND sj.job_id = j.id) AS is_saved, (SELECT status FROM worker_applications a WHERE a.worker_id = ? AND a.job_id = j.id) AS application_status'
    : '';
  const dataValues = workerId ? [workerId, workerId, ...values] : [...values];
  const rows = db.prepare(`SELECT j.* ${workerSelect} FROM worker_jobs j ${whereSql} ORDER BY j.posted_at DESC, j.id DESC LIMIT ? OFFSET ?`)
    .all(...dataValues, pageSize, (page - 1) * pageSize);
  return { items: rows.map(serializeJob), pagination: { page, page_size: pageSize, total: count, pages: Math.max(1, Math.ceil(count / pageSize)) } };
}

export function getJob(identifier, workerId = null) {
  const selector = /^\d+$/.test(String(identifier)) ? 'j.id = ?' : 'j.slug = ?';
  const workerSelect = workerId
    ? ', EXISTS(SELECT 1 FROM worker_saved_jobs sj WHERE sj.worker_id = ? AND sj.job_id = j.id) AS is_saved, (SELECT status FROM worker_applications a WHERE a.worker_id = ? AND a.job_id = j.id) AS application_status'
    : '';
  const args = workerId ? [workerId, workerId, identifier] : [identifier];
  return serializeJob(db.prepare(`SELECT j.* ${workerSelect} FROM worker_jobs j WHERE ${selector}`).get(...args));
}

export function saveJob(workerId, jobId) {
  if (!getJob(jobId)) throw Object.assign(new Error('Job not found'), { status: 404 });
  db.prepare('INSERT OR IGNORE INTO worker_saved_jobs(worker_id, job_id) VALUES (?, ?)').run(workerId, jobId);
}

export function unsaveJob(workerId, jobId) {
  db.prepare('DELETE FROM worker_saved_jobs WHERE worker_id = ? AND job_id = ?').run(workerId, jobId);
}

export function applyToJob(workerId, jobId, coverNote = '') {
  if (!getJob(jobId)) throw Object.assign(new Error('Job not found'), { status: 404 });
  return db.prepare(`INSERT INTO worker_applications(worker_id, job_id, cover_note)
    VALUES (?, ?, ?) ON CONFLICT(worker_id, job_id) DO UPDATE SET
    status = CASE WHEN worker_applications.status = 'withdrawn' THEN 'submitted' ELSE worker_applications.status END,
    cover_note = excluded.cover_note, updated_at = CURRENT_TIMESTAMP`).run(workerId, jobId, clean(coverNote) || null);
}

export function withdrawApplication(workerId, applicationId) {
  const result = db.prepare("UPDATE worker_applications SET status = 'withdrawn', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND worker_id = ?").run(applicationId, workerId);
  if (!result.changes) throw Object.assign(new Error('Application not found'), { status: 404 });
}

export function workerDashboard(workerId) {
  const worker = getWorker(workerId);
  const documents = listWorkerDocuments(workerId);
  const savedJobs = db.prepare(`SELECT j.* FROM worker_saved_jobs sj JOIN worker_jobs j ON j.id = sj.job_id WHERE sj.worker_id = ? ORDER BY sj.created_at DESC LIMIT 8`).all(workerId).map(serializeJob);
  const applications = db.prepare(`SELECT a.*, j.title, j.company, j.country FROM worker_applications a JOIN worker_jobs j ON j.id = a.job_id WHERE a.worker_id = ? ORDER BY a.updated_at DESC`).all(workerId);
  const messages = db.prepare('SELECT * FROM worker_messages WHERE worker_id = ? ORDER BY created_at DESC LIMIT 8').all(workerId);
  const notifications = db.prepare('SELECT * FROM worker_notifications WHERE worker_id = ? ORDER BY created_at DESC LIMIT 8').all(workerId);
  return {
    worker,
    counts: {
      saved_jobs: savedJobs.length,
      applied_jobs: applications.length,
      interview_invitations: applications.filter((item) => item.status === 'interview').length,
      messages: messages.filter((item) => !item.is_read).length,
      notifications: notifications.filter((item) => !item.is_read).length,
      uploaded_documents: documents.length
    },
    documents,
    saved_jobs: savedJobs,
    applications,
    messages,
    notifications
  };
}

function documentDirectory() {
  const directory = path.join(path.dirname(activeDatabasePath), 'worker-documents');
  fs.mkdirSync(directory, { recursive: true });
  return directory;
}

export function uploadWorkerDocument(workerId, input) {
  requireFields(input, ['document_type', 'filename', 'content_type', 'content_base64']);
  if (!DOCUMENT_TYPES.includes(input.document_type)) throw Object.assign(new Error('Unsupported document type'), { status: 400 });
  const extension = path.extname(clean(input.filename)).toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(extension) || !ALLOWED_MIME_TYPES.has(clean(input.content_type))) throw Object.assign(new Error('Unsupported file type'), { status: 400 });
  const buffer = Buffer.from(String(input.content_base64).replace(/^data:[^,]+,/, ''), 'base64');
  if (!buffer.length || buffer.length > MAX_DOCUMENT_BYTES) throw Object.assign(new Error('File must be between 1 byte and 5 MB'), { status: 400 });
  const stored = `${workerId}-${Date.now()}-${crypto.randomUUID()}${extension}`;
  fs.writeFileSync(path.join(documentDirectory(), stored), buffer, { flag: 'wx' });
  const result = db.prepare(`INSERT INTO worker_documents(worker_id, document_type, original_filename, stored_filename, content_type, size_bytes)
    VALUES (?, ?, ?, ?, ?, ?)`).run(workerId, input.document_type, clean(input.filename), stored, clean(input.content_type), buffer.length);
  return serializeDocument(db.prepare('SELECT * FROM worker_documents WHERE id = ?').get(result.lastInsertRowid));
}

export function listWorkerDocuments(workerId) {
  return db.prepare('SELECT * FROM worker_documents WHERE worker_id = ? ORDER BY uploaded_at DESC').all(workerId).map(serializeDocument);
}

export function adminListWorkers(filters = {}) {
  const where = [];
  const values = [];
  if (filters.keyword) {
    const value = `%${clean(filters.keyword)}%`;
    where.push('(full_name LIKE ? OR email LIKE ? OR trade_profession LIKE ? OR country LIKE ?)');
    values.push(value, value, value, value);
  }
  if (filters.status) { where.push('status = ?'); values.push(clean(filters.status)); }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  return db.prepare(`SELECT * FROM workers ${whereSql} ORDER BY created_at DESC LIMIT 200`).all(...values).map(serializeWorker);
}

export function adminUpdateWorker(workerId, input) {
  const allowedStatus = new Set(['active', 'suspended']);
  const status = allowedStatus.has(input.status) ? input.status : null;
  const verified = input.profile_verified === undefined ? null : Number(Boolean(input.profile_verified));
  if (status === null && verified === null) return getWorker(workerId);
  const current = db.prepare('SELECT * FROM workers WHERE id = ?').get(workerId);
  if (!current) throw Object.assign(new Error('Worker not found'), { status: 404 });
  db.prepare(`UPDATE workers SET status = COALESCE(?, status), profile_verified = COALESCE(?, profile_verified), updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
    .run(status, verified, workerId);
  return getWorker(workerId);
}

export function adminUpdateDocument(documentId, input) {
  const allowed = new Set(['pending', 'approved', 'rejected']);
  if (!allowed.has(input.status)) throw Object.assign(new Error('Invalid document status'), { status: 400 });
  const result = db.prepare('UPDATE worker_documents SET status = ?, reviewer_note = ?, reviewed_at = CURRENT_TIMESTAMP WHERE id = ?')
    .run(input.status, clean(input.reviewer_note) || null, documentId);
  if (!result.changes) throw Object.assign(new Error('Document not found'), { status: 404 });
  return serializeDocument(db.prepare('SELECT * FROM worker_documents WHERE id = ?').get(documentId));
}

export function workerAdminExport() {
  return db.prepare(`SELECT full_name, email, mobile_number, country, nationality, current_location,
    trade_profession, years_experience, highest_qualification, status, profile_verified, profile_completion, created_at
    FROM workers ORDER BY created_at DESC`).all();
}

export function workerFilterOptions() {
  const distinct = (table, column) => db.prepare(`SELECT DISTINCT ${column} AS value FROM ${table} WHERE ${column} IS NOT NULL AND ${column} <> '' ORDER BY value`).all().map((row) => row.value);
  return {
    skills: WORKER_SKILLS,
    document_types: DOCUMENT_TYPES,
    countries: distinct('worker_jobs', 'country'),
    industries: distinct('worker_jobs', 'industry'),
    trades: distinct('worker_jobs', 'trade'),
    companies: distinct('worker_jobs', 'company'),
    job_types: distinct('worker_jobs', 'job_type')
  };
}
