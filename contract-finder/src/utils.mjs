import crypto from 'node:crypto';
import { brotliCompressSync, gzipSync } from 'node:zlib';

export function slugify(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[^a-zA-Z0-9\s-]/g, '')
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '') || crypto.randomUUID();
}

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  })[character]);
}

export const securityHeaders = {
  'content-security-policy': [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: https:",
    "connect-src 'self'",
    "form-action 'self' mailto:",
    "manifest-src 'self'"
  ].join('; '),
  'x-frame-options': 'DENY',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'permissions-policy': 'geolocation=(), microphone=(), camera=(), payment=(), usb=()'
};

export function withSecurityHeaders(headers = {}) {
  return { ...securityHeaders, ...headers };
}

function compressible(contentType = '') {
  return /text\/|application\/(json|javascript|xml|manifest\+json)|image\/svg\+xml/.test(contentType);
}

export function sendBody(response, status, body, headers = {}, request = null) {
  let payload = Buffer.isBuffer(body) ? body : Buffer.from(String(body));
  const responseHeaders = withSecurityHeaders({ ...headers });
  const acceptEncoding = String(request?.headers?.['accept-encoding'] || '');
  const contentType = String(responseHeaders['content-type'] || '');
  if (payload.length >= 1024 && compressible(contentType)) {
    if (/\bbr\b/.test(acceptEncoding)) {
      payload = brotliCompressSync(payload);
      responseHeaders['content-encoding'] = 'br';
      responseHeaders.vary = 'Accept-Encoding';
    } else if (/\bgzip\b/.test(acceptEncoding)) {
      payload = gzipSync(payload);
      responseHeaders['content-encoding'] = 'gzip';
      responseHeaders.vary = 'Accept-Encoding';
    }
  }
  responseHeaders['content-length'] = payload.length;
  response.writeHead(status, responseHeaders);
  response.end(payload);
}

export function sendJson(response, status, payload, headers = {}) {
  const body = JSON.stringify(payload);
  sendBody(response, status, body, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    ...headers
  });
}

export function sendHtml(response, status, body, headers = {}, request = null) {
  sendBody(response, status, body, {
    'content-type': 'text/html; charset=utf-8',
    ...headers
  }, request);
}

export async function readJson(request, maxBytes = 1_000_000) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBytes) throw Object.assign(new Error('Request body is too large'), { status: 413 });
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw Object.assign(new Error('Invalid JSON body'), { status: 400 }); }
}

export function parseCookies(request) {
  const result = {};
  for (const part of String(request.headers.cookie || '').split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    result[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim());
  }
  return result;
}

export function normalizeIsoDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? null : date.toISOString();
}

export function clampInt(value, fallback, min, max) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}

export function uniqueSlug(db, title, existingId = null) {
  const base = slugify(title);
  let candidate = base;
  let counter = 2;
  while (true) {
    const row = db.prepare('SELECT id FROM contracts WHERE slug = ?').get(candidate);
    if (!row || row.id === existingId) return candidate;
    candidate = `${base}-${counter++}`;
  }
}
