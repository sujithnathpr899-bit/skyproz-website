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

export const AVAILABILITY_OPTIONS = [
  'Available Immediately', 'Available in 2 Weeks', 'Available Next Month', 'Currently Employed',
  'Offshore Ready', 'Travel Ready'
];

export const APPLICATION_STATUSES = ['submitted', 'viewed', 'shortlisted', 'interview', 'offer', 'rejected', 'withdrawn'];

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

function validAvailability(value, fallback = 'Available Immediately') {
  const text = clean(value, fallback);
  return AVAILABILITY_OPTIONS.includes(text) ? text : text || fallback;
}

function jsonSettings(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [clean(key), typeof item === 'boolean' ? item : clean(item)]).filter(([key]) => key));
}

function documentDisplayStatus(row) {
  if (!row) return 'pending';
  if (row.expiry_date && new Date(row.expiry_date) < new Date() && row.status !== 'rejected') return 'expired';
  return row.status || 'pending';
}

function hasDocument(documents, matcher) {
  return documents.some((document) => matcher(document) && document.status !== 'rejected');
}

function serializeExperience(row) {
  if (!row) return null;
  return {
    id: row.id,
    worker_id: row.worker_id,
    company: row.company,
    position: row.position,
    country: row.country,
    start_date: row.start_date,
    end_date: row.end_date,
    description: row.description,
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

function completionDetails(worker, documents = [], experience = []) {
  const skills = stringList(worker.skills);
  const preferredCountries = stringList(worker.preferred_countries);
  const languages = stringList(worker.languages);
  const emergency = worker.emergency_contact || {};
  const sections = [
    { key: 'personal_details', label: 'Personal Details', complete: Boolean(clean(worker.full_name) && clean(worker.mobile_number) && clean(worker.email) && clean(worker.country) && clean(worker.current_location) && clean(worker.date_of_birth)) },
    { key: 'skills', label: 'Skills', complete: skills.length > 0 },
    { key: 'experience', label: 'Experience', complete: experience.length > 0 || Number(worker.years_experience) > 0 },
    { key: 'certifications', label: 'Certifications', complete: hasDocument(documents, (doc) => /certificate/i.test(doc.document_type)) },
    { key: 'passport', label: 'Passport', complete: Boolean(clean(worker.passport_number) || hasDocument(documents, (doc) => doc.document_type === 'Passport')) },
    { key: 'medical', label: 'Medical', complete: hasDocument(documents, (doc) => doc.document_type === 'Medical Certificate') },
    { key: 'emergency_contact', label: 'Emergency Contact', complete: Boolean(clean(emergency.name) && clean(emergency.phone)) },
    { key: 'availability', label: 'Availability', complete: Boolean(clean(worker.availability) && (preferredCountries.length > 0 || languages.length > 0 || clean(worker.preferred_salary))) }
  ];
  const completed = sections.filter((section) => section.complete).length;
  return {
    percent: Math.round((completed / sections.length) * 100),
    completed_sections: completed,
    total_sections: sections.length,
    sections,
    missing_sections: sections.filter((section) => !section.complete).map((section) => section.label),
    message: 'Complete your profile to improve your chances of getting hired.'
  };
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

function workerVerificationBadges(worker, documents = [], experience = []) {
  const approved = (type) => documents.some((doc) => doc.document_type === type && doc.status === 'approved');
  const approvedCertificate = (text) => documents.some((doc) => doc.status === 'approved' && doc.document_type.toLowerCase().includes(text));
  return [
    { label: 'Verified Profile', verified: Boolean(worker.profile_verified) },
    { label: 'Verified Passport', verified: approved('Passport') },
    { label: 'Verified Documents', verified: documents.some((doc) => doc.status === 'approved') },
    { label: 'Verified Experience', verified: experience.length > 0 },
    { label: 'IRATA Verified', verified: approvedCertificate('irata') || stringList(worker.skills).some((skill) => skill.startsWith('IRATA')) },
    { label: 'NDT Verified', verified: approvedCertificate('ndt') || stringList(worker.skills).includes('NDT') }
  ];
}

function serializeWorker(row) {
  if (!row) return null;
  const worker = {
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
    professional_title: row.professional_title || row.trade_profession,
    years_experience: row.years_experience,
    highest_qualification: row.highest_qualification,
    profile_photo_url: row.profile_photo_url,
    biography: row.biography,
    languages: parseJson(row.languages_json, []),
    skills: parseJson(row.skills_json, []),
    availability: row.availability,
    preferred_countries: parseJson(row.preferred_countries_json, []),
    preferred_salary: row.preferred_salary,
    emergency_contact: {
      name: row.emergency_contact_name,
      phone: row.emergency_contact_phone,
      relationship: row.emergency_contact_relationship
    },
    notification_settings: parseJson(row.notification_settings_json, {}),
    privacy_settings: parseJson(row.privacy_settings_json, {}),
    profile_verified: Boolean(row.profile_verified),
    status: row.status,
    last_login_at: row.last_login_at,
    created_at: row.created_at,
    updated_at: row.updated_at
  };
  const documents = listWorkerDocuments(row.id);
  const experience = listWorkerExperience(row.id);
  const details = completionDetails(worker, documents, experience);
  return {
    ...worker,
    profile_completion: details.percent,
    profile_completion_details: details,
    verification_badges: workerVerificationBadges(worker, documents, experience)
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
    document_name: row.document_name || row.document_type,
    original_filename: row.original_filename,
    content_type: row.content_type,
    size_bytes: row.size_bytes,
    status: documentDisplayStatus(row),
    stored_status: row.status,
    expiry_date: row.expiry_date,
    reviewer_note: row.reviewer_note,
    download_url: `/api/workers/documents/${row.id}/download`,
    uploaded_at: row.uploaded_at,
    reviewed_at: row.reviewed_at,
    updated_at: row.updated_at || row.uploaded_at,
    replaced_by_document_id: row.replaced_by_document_id
  };
}

function requireFields(input, fields) {
  for (const field of fields) {
    if (!clean(input[field])) throw Object.assign(new Error(`${field} is required`), { status: 400 });
  }
}

function refreshWorkerCompletion(workerId) {
  const worker = serializeWorker(db.prepare('SELECT * FROM workers WHERE id = ?').get(workerId));
  if (worker) db.prepare('UPDATE workers SET profile_completion = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(worker.profile_completion, workerId);
  return worker;
}

function applyWorkerProfileExtras(workerId, input = {}) {
  const current = db.prepare('SELECT * FROM workers WHERE id = ?').get(workerId);
  if (!current) throw Object.assign(new Error('Worker not found'), { status: 404 });
  const languages = input.languages === undefined ? parseJson(current.languages_json, []) : stringList(input.languages);
  const notificationSettings = input.notification_settings === undefined ? parseJson(current.notification_settings_json, {}) : jsonSettings(input.notification_settings);
  const privacySettings = input.privacy_settings === undefined ? parseJson(current.privacy_settings_json, {}) : jsonSettings(input.privacy_settings);
  db.prepare(`UPDATE workers SET
    profile_photo_url = ?, professional_title = ?, languages_json = ?, biography = ?,
    emergency_contact_name = ?, emergency_contact_phone = ?, emergency_contact_relationship = ?,
    notification_settings_json = ?, privacy_settings_json = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(
    input.profile_photo_url === undefined ? current.profile_photo_url : clean(input.profile_photo_url) || null,
    input.professional_title === undefined ? current.professional_title : clean(input.professional_title) || clean(input.trade_profession, current.trade_profession),
    JSON.stringify(languages),
    input.biography === undefined ? current.biography : clean(input.biography) || null,
    input.emergency_contact_name === undefined ? current.emergency_contact_name : clean(input.emergency_contact_name) || null,
    input.emergency_contact_phone === undefined ? current.emergency_contact_phone : clean(input.emergency_contact_phone) || null,
    input.emergency_contact_relationship === undefined ? current.emergency_contact_relationship : clean(input.emergency_contact_relationship) || null,
    JSON.stringify(notificationSettings), JSON.stringify(privacySettings), workerId
  );
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
  applyWorkerProfileExtras(result.lastInsertRowid, input);
  return refreshWorkerCompletion(result.lastInsertRowid);
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
  applyWorkerProfileExtras(workerId, input);
  return refreshWorkerCompletion(workerId);
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
  db.prepare('INSERT INTO worker_notifications(worker_id, title, message) VALUES (?, ?, ?)')
    .run(workerId, 'Job saved', 'The job has been added to your saved jobs list.');
}
export function unsaveJob(workerId, jobId) {
  db.prepare('DELETE FROM worker_saved_jobs WHERE worker_id = ? AND job_id = ?').run(workerId, jobId);
}

export function applyToJob(workerId, jobId, coverNote = '') {
  const job = getJob(jobId);
  if (!job) throw Object.assign(new Error('Job not found'), { status: 404 });
  const result = db.prepare(`INSERT INTO worker_applications(worker_id, job_id, cover_note)
    VALUES (?, ?, ?) ON CONFLICT(worker_id, job_id) DO UPDATE SET
    status = CASE WHEN worker_applications.status = 'withdrawn' THEN 'submitted' ELSE worker_applications.status END,
    cover_note = excluded.cover_note, updated_at = CURRENT_TIMESTAMP`).run(workerId, jobId, clean(coverNote) || null);
  db.prepare('INSERT INTO worker_notifications(worker_id, title, message) VALUES (?, ?, ?)')
    .run(workerId, 'Application submitted', `Your application for ${job.title} has been recorded.`);
  return result;
}
export function withdrawApplication(workerId, applicationId) {
  const result = db.prepare("UPDATE worker_applications SET status = 'withdrawn', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND worker_id = ?").run(applicationId, workerId);
  if (!result.changes) throw Object.assign(new Error('Application not found'), { status: 404 });
}

export function workerDashboard(workerId) {
  const worker = getWorker(workerId);
  const documents = listWorkerDocuments(workerId);
  const savedJobs = listSavedJobs(workerId).slice(0, 8);
  const applications = listWorkerApplications(workerId);
  const messages = db.prepare('SELECT * FROM worker_messages WHERE worker_id = ? ORDER BY created_at DESC LIMIT 8').all(workerId);
  const notifications = listWorkerNotifications(workerId).slice(0, 8);
  const experience = listWorkerExperience(workerId);
  return {
    worker,
    profile_completion: worker.profile_completion_details,
    verification_badges: worker.verification_badges,
    counts: {
      saved_jobs: savedJobs.length,
      applied_jobs: applications.length,
      interview_invitations: applications.filter((item) => item.status === 'interview').length,
      messages: messages.filter((item) => !item.is_read).length,
      notifications: notifications.filter((item) => !item.is_read).length,
      uploaded_documents: documents.length,
      documents: documents.length
    },
    documents,
    saved_jobs: savedJobs,
    applications,
    messages,
    notifications,
    experience
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
  db.prepare('UPDATE worker_documents SET document_name = ?, expiry_date = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
    .run(clean(input.document_name) || input.document_type, normalizeIsoDate(input.expiry_date) || null, result.lastInsertRowid);
  refreshWorkerCompletion(workerId);
  return serializeDocument(db.prepare('SELECT * FROM worker_documents WHERE id = ?').get(result.lastInsertRowid));
}

export function listWorkerDocuments(workerId) {
  return db.prepare('SELECT * FROM worker_documents WHERE worker_id = ? ORDER BY uploaded_at DESC').all(workerId).map(serializeDocument);
}

export function replaceWorkerDocument(workerId, documentId, input) {
  const existing = db.prepare('SELECT * FROM worker_documents WHERE id = ? AND worker_id = ?').get(documentId, workerId);
  if (!existing) throw Object.assign(new Error('Document not found'), { status: 404 });
  const replacement = uploadWorkerDocument(workerId, { ...input, document_type: input.document_type || existing.document_type, document_name: input.document_name || existing.document_name || existing.document_type });
  db.prepare('UPDATE worker_documents SET replaced_by_document_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND worker_id = ?').run(replacement.id, documentId, workerId);
  return replacement;
}

export function getWorkerDocumentDownload(workerId, documentId) {
  const row = db.prepare('SELECT * FROM worker_documents WHERE id = ? AND worker_id = ?').get(documentId, workerId);
  if (!row) throw Object.assign(new Error('Document not found'), { status: 404 });
  const filePath = path.join(documentDirectory(), row.stored_filename);
  if (!fs.existsSync(filePath)) throw Object.assign(new Error('Stored document is missing'), { status: 404 });
  return { body: fs.readFileSync(filePath), filename: row.original_filename, content_type: row.content_type };
}

export function listWorkerExperience(workerId) {
  return db.prepare('SELECT * FROM worker_experience WHERE worker_id = ? ORDER BY start_date DESC, id DESC').all(workerId).map(serializeExperience);
}

export function addWorkerExperience(workerId, input) {
  requireFields(input, ['company', 'position', 'country', 'start_date']);
  const result = db.prepare(`INSERT INTO worker_experience(worker_id, company, position, country, start_date, end_date, description)
    VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
    workerId, clean(input.company), clean(input.position), clean(input.country), normalizeIsoDate(input.start_date) || clean(input.start_date),
    normalizeIsoDate(input.end_date) || null, clean(input.description) || null
  );
  refreshWorkerCompletion(workerId);
  return serializeExperience(db.prepare('SELECT * FROM worker_experience WHERE id = ?').get(result.lastInsertRowid));
}

export function updateWorkerExperience(workerId, experienceId, input) {
  const current = db.prepare('SELECT * FROM worker_experience WHERE id = ? AND worker_id = ?').get(experienceId, workerId);
  if (!current) throw Object.assign(new Error('Experience not found'), { status: 404 });
  db.prepare(`UPDATE worker_experience SET company = ?, position = ?, country = ?, start_date = ?, end_date = ?, description = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND worker_id = ?`).run(
    clean(input.company, current.company), clean(input.position, current.position), clean(input.country, current.country),
    normalizeIsoDate(input.start_date) || current.start_date, input.end_date === undefined ? current.end_date : normalizeIsoDate(input.end_date) || null,
    input.description === undefined ? current.description : clean(input.description) || null, experienceId, workerId
  );
  refreshWorkerCompletion(workerId);
  return serializeExperience(db.prepare('SELECT * FROM worker_experience WHERE id = ?').get(experienceId));
}

export function deleteWorkerExperience(workerId, experienceId) {
  const result = db.prepare('DELETE FROM worker_experience WHERE id = ? AND worker_id = ?').run(experienceId, workerId);
  if (!result.changes) throw Object.assign(new Error('Experience not found'), { status: 404 });
  refreshWorkerCompletion(workerId);
}

function serializeApplication(row) {
  if (!row) return null;
  return {
    id: row.id,
    worker_id: row.worker_id,
    job_id: row.job_id,
    status: row.status,
    cover_note: row.cover_note,
    applied_at: row.applied_at,
    updated_at: row.updated_at,
    viewed_at: row.viewed_at,
    interview_at: row.interview_at,
    employer_note: row.employer_note,
    job: {
      slug: row.slug,
      title: row.title,
      company: row.company,
      country: row.country,
      industry: row.industry,
      trade: row.trade,
      job_type: row.job_type,
      deadline: row.deadline,
      salary_min: row.salary_min,
      salary_max: row.salary_max,
      currency: row.currency
    }
  };
}

function serializeNotification(row) {
  if (!row) return null;
  return { ...row, is_read: Boolean(row.is_read) };
}

export function listWorkerApplications(workerId) {
  return db.prepare(`SELECT a.*, j.slug, j.title, j.company, j.country, j.industry, j.trade, j.job_type, j.deadline, j.salary_min, j.salary_max, j.currency
    FROM worker_applications a JOIN worker_jobs j ON j.id = a.job_id
    WHERE a.worker_id = ? ORDER BY a.updated_at DESC`).all(workerId).map(serializeApplication);
}

export function listSavedJobs(workerId) {
  return db.prepare(`SELECT j.*, sj.created_at AS saved_at FROM worker_saved_jobs sj JOIN worker_jobs j ON j.id = sj.job_id
    WHERE sj.worker_id = ? ORDER BY sj.created_at DESC`).all(workerId).map((row) => ({ ...serializeJob(row), is_saved: true, saved_at: row.saved_at }));
}

export function listWorkerNotifications(workerId) {
  return db.prepare('SELECT * FROM worker_notifications WHERE worker_id = ? ORDER BY created_at DESC LIMIT 100').all(workerId).map(serializeNotification);
}

export function markWorkerNotification(workerId, notificationId) {
  const result = db.prepare('UPDATE worker_notifications SET is_read = 1 WHERE id = ? AND worker_id = ?').run(notificationId, workerId);
  if (!result.changes) throw Object.assign(new Error('Notification not found'), { status: 404 });
  return serializeNotification(db.prepare('SELECT * FROM worker_notifications WHERE id = ?').get(notificationId));
}

export function updateWorkerSettings(workerId, input) {
  applyWorkerProfileExtras(workerId, input);
  return refreshWorkerCompletion(workerId);
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
  const allowed = new Set(['pending', 'approved', 'rejected', 'expired']);
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
    availability_options: AVAILABILITY_OPTIONS,
    application_statuses: APPLICATION_STATUSES,
    countries: distinct('worker_jobs', 'country'),
    industries: distinct('worker_jobs', 'industry'),
    trades: distinct('worker_jobs', 'trade'),
    companies: distinct('worker_jobs', 'company'),
    job_types: distinct('worker_jobs', 'job_type')
  };
}
