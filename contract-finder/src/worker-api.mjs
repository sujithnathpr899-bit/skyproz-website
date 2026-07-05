import { clearWorkerCookie, createWorkerToken, currentWorker, requireWorker, workerCookie } from './worker-auth.mjs';
import { requireAdmin } from './auth.mjs';
import { readJson, sendBody, sendJson } from './utils.mjs';
import {
  adminListWorkers,
  adminUpdateDocument,
  adminUpdateWorker,
  applyToJob,
  authenticateWorker,
  createWorker,
  getJob,
  getWorker,
  listWorkerDocuments,
  saveJob,
  searchJobs,
  unsaveJob,
  updateWorkerProfile,
  uploadWorkerDocument,
  workerAdminExport,
  workerDashboard,
  workerFilterOptions,
  withdrawApplication
} from './workers.mjs';

const buckets = new Map();

function match(pathname, pattern) {
  const result = pathname.match(pattern);
  return result ? result.slice(1) : null;
}

function queryObject(searchParams) {
  return Object.fromEntries([...searchParams.entries()].filter(([, value]) => value !== ''));
}

function rateLimit(request, pathname) {
  const key = `${request.socket?.remoteAddress || 'local'}:${pathname}`;
  const now = Date.now();
  const bucket = buckets.get(key) || { count: 0, resetAt: now + 60000 };
  if (bucket.resetAt < now) { bucket.count = 0; bucket.resetAt = now + 60000; }
  bucket.count++;
  buckets.set(key, bucket);
  if (bucket.count > 180) throw Object.assign(new Error('Too many worker portal requests'), { status: 429 });
}

function csvCell(value) {
  return `"${String(value ?? '').replaceAll('"', '""')}"`;
}

function workerCsv(rows) {
  const headers = ['full_name', 'email', 'mobile_number', 'country', 'nationality', 'current_location', 'trade_profession', 'years_experience', 'highest_qualification', 'status', 'profile_verified', 'profile_completion', 'created_at'];
  return [headers.map(csvCell).join(','), ...rows.map((row) => headers.map((header) => csvCell(row[header])).join(','))].join('\n');
}

export async function handleWorkerApi(request, response, url) {
  const { pathname, searchParams } = url;
  if (!pathname.startsWith('/api/workers/')) return false;
  try {
    rateLimit(request, pathname);

    if (request.method === 'GET' && pathname === '/api/workers/health') {
      sendJson(response, 200, { ok: true, service: 'skyproz-worker-portal', time: new Date().toISOString() }); return true;
    }

    if (request.method === 'GET' && pathname === '/api/workers/options') {
      sendJson(response, 200, workerFilterOptions(), { 'cache-control': 'public, max-age=300' }); return true;
    }

    if (request.method === 'GET' && pathname === '/api/workers/auth/me') {
      const row = currentWorker(request);
      sendJson(response, 200, { worker: row ? getWorker(row.id) : null }); return true;
    }

    if (request.method === 'POST' && pathname === '/api/workers/auth/register') {
      const body = await readJson(request, 250_000);
      const worker = await createWorker(body);
      sendJson(response, 201, { worker }, { 'set-cookie': workerCookie(createWorkerToken(worker.id)) }); return true;
    }

    if (request.method === 'POST' && pathname === '/api/workers/auth/login') {
      const body = await readJson(request, 100_000);
      const worker = await authenticateWorker(body.email, body.password);
      sendJson(response, 200, { worker }, { 'set-cookie': workerCookie(createWorkerToken(worker.id)) }); return true;
    }

    if (request.method === 'POST' && pathname === '/api/workers/auth/logout') {
      sendJson(response, 200, { ok: true }, { 'set-cookie': clearWorkerCookie() }); return true;
    }

    if (request.method === 'GET' && pathname === '/api/workers/profile') {
      const worker = requireWorker(request);
      sendJson(response, 200, { worker: getWorker(worker.id) }); return true;
    }

    if (request.method === 'PATCH' && pathname === '/api/workers/profile') {
      const worker = requireWorker(request);
      sendJson(response, 200, { worker: updateWorkerProfile(worker.id, await readJson(request, 250_000)) }); return true;
    }

    if (request.method === 'GET' && pathname === '/api/workers/dashboard') {
      const worker = requireWorker(request);
      sendJson(response, 200, workerDashboard(worker.id)); return true;
    }

    if (request.method === 'GET' && pathname === '/api/workers/documents') {
      const worker = requireWorker(request);
      sendJson(response, 200, { items: listWorkerDocuments(worker.id) }); return true;
    }

    if (request.method === 'POST' && pathname === '/api/workers/documents') {
      const worker = requireWorker(request);
      sendJson(response, 201, { document: uploadWorkerDocument(worker.id, await readJson(request, 7_000_000)) }); return true;
    }

    if (request.method === 'GET' && pathname === '/api/workers/jobs') {
      const worker = currentWorker(request);
      sendJson(response, 200, searchJobs(queryObject(searchParams), worker?.id)); return true;
    }

    let route = match(pathname, /^\/api\/workers\/jobs\/([^/]+)$/);
    if (request.method === 'GET' && route) {
      const worker = currentWorker(request);
      const job = getJob(decodeURIComponent(route[0]), worker?.id);
      if (!job) throw Object.assign(new Error('Job not found'), { status: 404 });
      sendJson(response, 200, { job }, { 'cache-control': 'public, max-age=60' }); return true;
    }

    route = match(pathname, /^\/api\/workers\/jobs\/(\d+)\/save$/);
    if (route && request.method === 'POST') {
      const worker = requireWorker(request); saveJob(worker.id, Number(route[0])); sendJson(response, 200, { ok: true }); return true;
    }
    if (route && request.method === 'DELETE') {
      const worker = requireWorker(request); unsaveJob(worker.id, Number(route[0])); sendJson(response, 200, { ok: true }); return true;
    }

    route = match(pathname, /^\/api\/workers\/jobs\/(\d+)\/apply$/);
    if (route && request.method === 'POST') {
      const worker = requireWorker(request); const body = await readJson(request, 100_000);
      applyToJob(worker.id, Number(route[0]), body.cover_note || '');
      sendJson(response, 200, { ok: true }); return true;
    }

    route = match(pathname, /^\/api\/workers\/applications\/(\d+)\/withdraw$/);
    if (route && request.method === 'POST') {
      const worker = requireWorker(request); withdrawApplication(worker.id, Number(route[0])); sendJson(response, 200, { ok: true }); return true;
    }

    if (request.method === 'GET' && pathname === '/api/workers/admin/workers') {
      requireAdmin(request); sendJson(response, 200, { items: adminListWorkers(queryObject(searchParams)) }); return true;
    }

    if (request.method === 'GET' && pathname === '/api/workers/admin/export') {
      requireAdmin(request);
      sendBody(response, 200, workerCsv(workerAdminExport()), {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': 'attachment; filename="skyproz-workers.csv"'
      }, request); return true;
    }

    route = match(pathname, /^\/api\/workers\/admin\/workers\/(\d+)$/);
    if (route && request.method === 'PATCH') {
      requireAdmin(request); sendJson(response, 200, { worker: adminUpdateWorker(Number(route[0]), await readJson(request, 100_000)) }); return true;
    }

    route = match(pathname, /^\/api\/workers\/admin\/documents\/(\d+)$/);
    if (route && request.method === 'PATCH') {
      requireAdmin(request); sendJson(response, 200, { document: adminUpdateDocument(Number(route[0]), await readJson(request, 100_000)) }); return true;
    }

    sendJson(response, 404, { error: 'Worker endpoint not found' }); return true;
  } catch (error) {
    sendJson(response, error.status || 500, { error: error.message || 'Worker portal error', code: error.code || undefined }); return true;
  }
}
