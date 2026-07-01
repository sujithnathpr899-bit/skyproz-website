import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { db } from './db.mjs';
import { config } from './config.mjs';
import { parseCookies } from './utils.mjs';

const scrypt = promisify(crypto.scrypt);
const SESSION_COOKIE = 'skyproz_cf_session';

export async function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = await scrypt(password, salt, 64);
  return `scrypt:${salt}:${Buffer.from(derived).toString('hex')}`;
}

export async function verifyPassword(password, stored) {
  const [scheme, salt, expectedHex] = String(stored).split(':');
  if (scheme !== 'scrypt' || !salt || !expectedHex) return false;
  const actual = Buffer.from(await scrypt(password, salt, 64));
  const expected = Buffer.from(expectedHex, 'hex');
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

function signSession(id) {
  const signature = crypto.createHmac('sha256', config.sessionSecret).update(id).digest('base64url');
  return `${id}.${signature}`;
}

function verifySignedSession(value) {
  const [id, signature] = String(value || '').split('.');
  if (!id || !signature) return null;
  const expected = crypto.createHmac('sha256', config.sessionSecret).update(id).digest('base64url');
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b) ? id : null;
}

export function createSession(userId) {
  const id = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  db.prepare('INSERT INTO sessions(id, user_id, expires_at) VALUES (?, ?, ?)').run(id, userId, expiresAt);
  return { value: signSession(id), expiresAt };
}

export function sessionCookie(value, expiresAt) {
  const secure = config.cookieSecure ? '; Secure' : '';
  return `${SESSION_COOKIE}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Expires=${new Date(expiresAt).toUTCString()}${secure}`;
}

export function clearSessionCookie() {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

export function currentUser(request) {
  const signed = parseCookies(request)[SESSION_COOKIE];
  const sessionId = verifySignedSession(signed);
  if (!sessionId) return null;
  return db.prepare(`SELECT u.id, u.email, u.display_name, u.phone, u.role, u.plan
    FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.id = ? AND s.expires_at > CURRENT_TIMESTAMP AND u.is_active = 1`).get(sessionId) || null;
}

export function destroySession(request) {
  const signed = parseCookies(request)[SESSION_COOKIE];
  const sessionId = verifySignedSession(signed);
  if (sessionId) db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);
}

export function requireUser(request) {
  const user = currentUser(request);
  if (!user) throw Object.assign(new Error('Authentication required'), { status: 401 });
  return user;
}

export function requirePremium(request) {
  const user = requireUser(request);
  if (user.plan !== 'premium' && user.role !== 'admin') {
    throw Object.assign(new Error('Premium subscription required'), { status: 403, code: 'PREMIUM_REQUIRED' });
  }
  return user;
}

export function requireAdmin(request) {
  const user = requireUser(request);
  if (user.role !== 'admin') throw Object.assign(new Error('Administrator access required'), { status: 403 });
  return user;
}
