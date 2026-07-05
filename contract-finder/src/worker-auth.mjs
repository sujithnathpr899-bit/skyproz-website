import crypto from 'node:crypto';
import { db } from './db.mjs';
import { config } from './config.mjs';
import { parseCookies } from './utils.mjs';

const WORKER_COOKIE = 'skyproz_worker_token';
const SESSION_SECONDS = 30 * 24 * 60 * 60;

function base64urlJson(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function sign(value) {
  return crypto.createHmac('sha256', config.sessionSecret).update(value).digest('base64url');
}

function timingSafeEqualText(left, right) {
  const a = Buffer.from(String(left || ''));
  const b = Buffer.from(String(right || ''));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function createWorkerToken(workerId) {
  const now = Math.floor(Date.now() / 1000);
  const header = base64urlJson({ alg: 'HS256', typ: 'JWT' });
  const payload = base64urlJson({ sub: String(workerId), typ: 'worker', iat: now, exp: now + SESSION_SECONDS });
  const unsigned = `${header}.${payload}`;
  return `${unsigned}.${sign(unsigned)}`;
}

export function verifyWorkerToken(token) {
  const [header, payload, signature] = String(token || '').split('.');
  if (!header || !payload || !signature) return null;
  const unsigned = `${header}.${payload}`;
  if (!timingSafeEqualText(signature, sign(unsigned))) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (data.typ !== 'worker' || Number(data.exp || 0) < Math.floor(Date.now() / 1000)) return null;
    return Number(data.sub);
  } catch {
    return null;
  }
}

export function workerCookie(token) {
  const secure = config.cookieSecure ? '; Secure' : '';
  return `${WORKER_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_SECONDS}${secure}`;
}

export function clearWorkerCookie() {
  return `${WORKER_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

export function currentWorker(request) {
  const workerId = verifyWorkerToken(parseCookies(request)[WORKER_COOKIE]);
  if (!workerId) return null;
  return db.prepare("SELECT * FROM workers WHERE id = ? AND status <> 'suspended'").get(workerId) || null;
}

export function requireWorker(request) {
  const worker = currentWorker(request);
  if (!worker) throw Object.assign(new Error('Worker authentication required'), { status: 401 });
  return worker;
}
