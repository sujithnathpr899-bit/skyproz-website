import { db, parseJson } from './db.mjs';
import { config } from './config.mjs';
import { createSession, currentUser, destroySession, hashPassword, requireAdmin, requirePremium, requireUser, sessionCookie, clearSessionCookie, verifyPassword } from './auth.mjs';
import { createContract, getContract, listFilterOptions, removeDuplicateContracts, searchContracts, updateContract } from './contracts.mjs';
import { runAiTask } from './services/ai.mjs';
import { importSource } from './services/importer.mjs';
import { runDailyJobs } from './jobs.mjs';
import { readJson, sendJson, slugify } from './utils.mjs';

function match(pathname, pattern) {
  const result = pathname.match(pattern);
  return result ? result.slice(1) : null;
}

function queryObject(searchParams) {
  return Object.fromEntries([...searchParams.entries()].filter(([, value]) => value !== ''));
}

function publicUser(user) {
  if (!user) return null;
  return { id: user.id, email: user.email, display_name: user.display_name, phone: user.phone, role: user.role, plan: user.plan };
}

function requireFields(body, fields) {
  for (const field of fields) if (!String(body[field] || '').trim()) throw Object.assign(new Error(`${field} is required`), { status: 400 });
}

function verifyOwnership(table, id, userId) {
  const row = db.prepare(`SELECT * FROM ${table} WHERE id = ? AND user_id = ?`).get(id, userId);
  if (!row) throw Object.assign(new Error('Resource not found'), { status: 404 });
  return row;
}

export async function handleApi(request, response, url) {
  const { pathname, searchParams } = url;
  if (!pathname.startsWith('/api/contract-finder/')) return false;
  try {
    if (request.method === 'GET' && pathname === '/api/contract-finder/health') {
      sendJson(response, 200, { ok: true, service: 'skyproz-contract-finder', time: new Date().toISOString() }); return true;
    }

    if (request.method === 'GET' && pathname === '/api/contract-finder/auth/me') {
      sendJson(response, 200, { user: publicUser(currentUser(request)) }); return true;
    }
    if (request.method === 'POST' && pathname === '/api/contract-finder/auth/register') {
      const body = await readJson(request); requireFields(body, ['email', 'password', 'display_name']);
      if (String(body.password).length < 10) throw Object.assign(new Error('Password must be at least 10 characters'), { status: 400 });
      const passwordHash = await hashPassword(body.password);
      let result;
      try {
        result = db.prepare('INSERT INTO users(email, password_hash, display_name, phone) VALUES (?, ?, ?, ?)')
          .run(String(body.email).toLowerCase().trim(), passwordHash, String(body.display_name).trim(), body.phone || null);
      } catch (error) {
        if (String(error.message).includes('UNIQUE')) throw Object.assign(new Error('An account with this email already exists'), { status: 409 });
        throw error;
      }
      const session = createSession(Number(result.lastInsertRowid));
      sendJson(response, 201, { user: publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(result.lastInsertRowid)) }, { 'set-cookie': sessionCookie(session.value, session.expiresAt) }); return true;
    }
    if (request.method === 'POST' && pathname === '/api/contract-finder/auth/login') {
      const body = await readJson(request); requireFields(body, ['email', 'password']);
      const user = db.prepare('SELECT * FROM users WHERE email = ? COLLATE NOCASE AND is_active = 1').get(String(body.email).trim());
      if (!user || !(await verifyPassword(body.password, user.password_hash))) throw Object.assign(new Error('Invalid email or password'), { status: 401 });
      const session = createSession(user.id);
      sendJson(response, 200, { user: publicUser(user) }, { 'set-cookie': sessionCookie(session.value, session.expiresAt) }); return true;
    }
    if (request.method === 'POST' && pathname === '/api/contract-finder/auth/logout') {
      destroySession(request); sendJson(response, 200, { ok: true }, { 'set-cookie': clearSessionCookie() }); return true;
    }

    if (request.method === 'GET' && pathname === '/api/contract-finder/filter-options') {
      sendJson(response, 200, listFilterOptions(), { 'cache-control': 'public, max-age=300' }); return true;
    }
    if (request.method === 'GET' && pathname === '/api/contract-finder/contracts') {
      const user = currentUser(request); const filters = queryObject(searchParams);
      const advanced = ['source_id', 'verified', 'category', 'sort'].some((key) => filters[key] && !['newest', 'deadline'].includes(filters[key]));
      if (advanced && user?.plan !== 'premium' && user?.role !== 'admin') throw Object.assign(new Error('Advanced filters require premium'), { status: 403, code: 'PREMIUM_REQUIRED' });
      sendJson(response, 200, searchContracts(filters, user?.id), { 'cache-control': user ? 'private, max-age=30' : 'public, max-age=60' }); return true;
    }
    let route = match(pathname, /^\/api\/contract-finder\/contracts\/([^/]+)$/);
    if (request.method === 'GET' && route) {
      const user = currentUser(request); const contract = getContract(decodeURIComponent(route[0]), user?.id);
      if (!contract) throw Object.assign(new Error('Contract not found'), { status: 404 });
      sendJson(response, 200, { contract }, { 'cache-control': 'public, max-age=60' }); return true;
    }

    route = match(pathname, /^\/api\/contract-finder\/contracts\/(\d+)\/favorite$/);
    if (route && request.method === 'POST') {
      const user = requireUser(request); const body = await readJson(request);
      db.prepare(`INSERT INTO user_favorites(user_id, contract_id, notes, deadline_reminder_at) VALUES (?, ?, ?, ?)
        ON CONFLICT(user_id, contract_id) DO UPDATE SET notes = excluded.notes, deadline_reminder_at = excluded.deadline_reminder_at`)
        .run(user.id, Number(route[0]), body.notes || null, body.deadline_reminder_at || null);
      sendJson(response, 200, { ok: true }); return true;
    }
    if (route && request.method === 'DELETE') {
      const user = requireUser(request); db.prepare('DELETE FROM user_favorites WHERE user_id = ? AND contract_id = ?').run(user.id, Number(route[0]));
      sendJson(response, 200, { ok: true }); return true;
    }
    if (request.method === 'GET' && pathname === '/api/contract-finder/favorites') {
      const user = requireUser(request);
      const rows = db.prepare(`SELECT c.*, 1 AS is_favorite, uf.notes, uf.deadline_reminder_at FROM user_favorites uf
        JOIN contracts c ON c.id = uf.contract_id WHERE uf.user_id = ? ORDER BY uf.created_at DESC`).all(user.id);
      sendJson(response, 200, { items: rows.map((row) => ({ ...row, tags: parseJson(row.tags_json, []) })) }); return true;
    }

    if (request.method === 'GET' && pathname === '/api/contract-finder/saved-searches') {
      const user = requireUser(request); const rows = db.prepare('SELECT * FROM saved_searches WHERE user_id = ? ORDER BY created_at DESC').all(user.id)
        .map((row) => ({ ...row, filters: parseJson(row.filters_json, {}) }));
      sendJson(response, 200, { items: rows }); return true;
    }
    if (request.method === 'POST' && pathname === '/api/contract-finder/saved-searches') {
      const user = requireUser(request); const body = await readJson(request); requireFields(body, ['name']);
      const result = db.prepare('INSERT INTO saved_searches(user_id, name, filters_json) VALUES (?, ?, ?)').run(user.id, body.name, JSON.stringify(body.filters || {}));
      sendJson(response, 201, { id: Number(result.lastInsertRowid) }); return true;
    }
    route = match(pathname, /^\/api\/contract-finder\/saved-searches\/(\d+)$/);
    if (route && request.method === 'DELETE') {
      const user = requireUser(request); verifyOwnership('saved_searches', route[0], user.id);
      db.prepare('DELETE FROM saved_searches WHERE id = ?').run(route[0]); sendJson(response, 200, { ok: true }); return true;
    }

    if (request.method === 'GET' && pathname === '/api/contract-finder/alerts') {
      const user = requireUser(request); const rows = db.prepare('SELECT * FROM user_alerts WHERE user_id = ? ORDER BY created_at DESC').all(user.id)
        .map((row) => ({ ...row, filters: parseJson(row.filters_json, {}), email_enabled: Boolean(row.email_enabled), whatsapp_enabled: Boolean(row.whatsapp_enabled), is_active: Boolean(row.is_active) }));
      sendJson(response, 200, { items: rows }); return true;
    }
    if (request.method === 'POST' && pathname === '/api/contract-finder/alerts') {
      const user = requireUser(request); const body = await readJson(request); requireFields(body, ['name']);
      const existingCount = db.prepare('SELECT COUNT(*) AS count FROM user_alerts WHERE user_id = ? AND is_active = 1').get(user.id).count;
      if (user.plan !== 'premium' && existingCount >= 1) throw Object.assign(new Error('Free accounts can create one active alert'), { status: 403, code: 'PREMIUM_REQUIRED' });
      if (body.whatsapp_enabled && user.plan !== 'premium') throw Object.assign(new Error('WhatsApp alerts require premium'), { status: 403, code: 'PREMIUM_REQUIRED' });
      const result = db.prepare(`INSERT INTO user_alerts(user_id, saved_search_id, name, filters_json, frequency, email_enabled, whatsapp_enabled)
        VALUES (?, ?, ?, ?, ?, ?, ?)`).run(user.id, body.saved_search_id || null, body.name, JSON.stringify(body.filters || {}), body.frequency || 'daily', Number(body.email_enabled !== false), Number(Boolean(body.whatsapp_enabled)));
      sendJson(response, 201, { id: Number(result.lastInsertRowid) }); return true;
    }
    route = match(pathname, /^\/api\/contract-finder\/alerts\/(\d+)$/);
    if (route && request.method === 'DELETE') {
      const user = requireUser(request); verifyOwnership('user_alerts', route[0], user.id);
      db.prepare('DELETE FROM user_alerts WHERE id = ?').run(route[0]); sendJson(response, 200, { ok: true }); return true;
    }

    if (request.method === 'GET' && pathname === '/api/contract-finder/watchlists') {
      const user = requireUser(request);
      const items = db.prepare(`SELECT w.*, COUNT(wc.contract_id) AS contract_count FROM watchlists w
        LEFT JOIN watchlist_contracts wc ON wc.watchlist_id = w.id WHERE w.user_id = ? GROUP BY w.id ORDER BY w.created_at DESC`).all(user.id);
      sendJson(response, 200, { items }); return true;
    }
    if (request.method === 'POST' && pathname === '/api/contract-finder/watchlists') {
      const user = requireUser(request); const body = await readJson(request); requireFields(body, ['name']);
      const result = db.prepare('INSERT INTO watchlists(user_id, name, description) VALUES (?, ?, ?)').run(user.id, body.name, body.description || null);
      sendJson(response, 201, { id: Number(result.lastInsertRowid) }); return true;
    }
    route = match(pathname, /^\/api\/contract-finder\/watchlists\/(\d+)\/contracts\/(\d+)$/);
    if (route && request.method === 'POST') {
      const user = requireUser(request); verifyOwnership('watchlists', route[0], user.id);
      db.prepare('INSERT OR IGNORE INTO watchlist_contracts(watchlist_id, contract_id) VALUES (?, ?)').run(route[0], route[1]); sendJson(response, 200, { ok: true }); return true;
    }
    if (route && request.method === 'DELETE') {
      const user = requireUser(request); verifyOwnership('watchlists', route[0], user.id);
      db.prepare('DELETE FROM watchlist_contracts WHERE watchlist_id = ? AND contract_id = ?').run(route[0], route[1]); sendJson(response, 200, { ok: true }); return true;
    }

    route = match(pathname, /^\/api\/contract-finder\/contracts\/(\d+)\/ai\/(summary|requirements|checklist|deadlines|proposal)$/);
    if (route && request.method === 'POST') {
      requirePremium(request); sendJson(response, 200, await runAiTask(Number(route[0]), route[1])); return true;
    }

    if (request.method === 'GET' && pathname === '/api/contract-finder/dashboard') {
      const user = requireUser(request);
      const counts = {
        favorites: db.prepare('SELECT COUNT(*) AS count FROM user_favorites WHERE user_id = ?').get(user.id).count,
        saved_searches: db.prepare('SELECT COUNT(*) AS count FROM saved_searches WHERE user_id = ?').get(user.id).count,
        alerts: db.prepare('SELECT COUNT(*) AS count FROM user_alerts WHERE user_id = ? AND is_active = 1').get(user.id).count,
        deadlines: db.prepare(`SELECT COUNT(*) AS count FROM user_favorites uf JOIN contracts c ON c.id = uf.contract_id
          WHERE uf.user_id = ? AND c.deadline BETWEEN CURRENT_TIMESTAMP AND datetime('now', '+14 days')`).get(user.id).count
      };
      const deadlines = db.prepare(`SELECT c.id, c.slug, c.title, c.deadline FROM user_favorites uf JOIN contracts c ON c.id = uf.contract_id
        WHERE uf.user_id = ? AND c.deadline >= CURRENT_TIMESTAMP ORDER BY c.deadline LIMIT 10`).all(user.id);
      sendJson(response, 200, { counts, deadlines }); return true;
    }

    if (pathname.startsWith('/api/contract-finder/admin/')) {
      requireAdmin(request);
      if (request.method === 'GET' && pathname === '/api/contract-finder/admin/analytics') {
        const analytics = {
          contracts: db.prepare('SELECT COUNT(*) AS value FROM contracts').get().value,
          open_contracts: db.prepare("SELECT COUNT(*) AS value FROM contracts WHERE status IN ('open','closing_soon')").get().value,
          verified_contracts: db.prepare('SELECT COUNT(*) AS value FROM contracts WHERE verified = 1').get().value,
          users: db.prepare('SELECT COUNT(*) AS value FROM users').get().value,
          premium_users: db.prepare("SELECT COUNT(*) AS value FROM users WHERE plan = 'premium'").get().value,
          active_alerts: db.prepare('SELECT COUNT(*) AS value FROM user_alerts WHERE is_active = 1').get().value,
          sources: db.prepare('SELECT COUNT(*) AS value FROM contract_sources WHERE is_active = 1').get().value,
          recent_imports: db.prepare('SELECT * FROM import_runs ORDER BY started_at DESC LIMIT 10').all()
        };
        sendJson(response, 200, analytics); return true;
      }
      if (request.method === 'GET' && pathname === '/api/contract-finder/admin/users') {
        sendJson(response, 200, { items: db.prepare('SELECT id, email, display_name, phone, role, plan, is_active, created_at FROM users ORDER BY created_at DESC').all() }); return true;
      }
      if (request.method === 'GET' && pathname === '/api/contract-finder/admin/sources') {
        sendJson(response, 200, { items: db.prepare('SELECT * FROM contract_sources ORDER BY name').all().map((row) => ({ ...row, parser_config: parseJson(row.parser_config_json, {}) })) }); return true;
      }
      if (request.method === 'POST' && pathname === '/api/contract-finder/admin/sources') {
        const body = await readJson(request); requireFields(body, ['name', 'source_url']);
        const result = db.prepare(`INSERT INTO contract_sources(name, source_url, api_url, country, source_type, parser_type, parser_config_json, is_active)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(body.name, body.source_url, body.api_url || null, body.country || null, body.source_type || 'government', body.parser_type || 'json', JSON.stringify(body.parser_config || {}), Number(body.is_active !== false));
        sendJson(response, 201, { id: Number(result.lastInsertRowid) }); return true;
      }
      route = match(pathname, /^\/api\/contract-finder\/admin\/sources\/(\d+)\/import$/);
      if (route && request.method === 'POST') {
        const source = db.prepare('SELECT * FROM contract_sources WHERE id = ?').get(route[0]);
        if (!source) throw Object.assign(new Error('Source not found'), { status: 404 });
        sendJson(response, 200, await importSource(source)); return true;
      }
      if (request.method === 'POST' && pathname === '/api/contract-finder/admin/contracts') {
        sendJson(response, 201, { contract: createContract(await readJson(request)) }); return true;
      }
      route = match(pathname, /^\/api\/contract-finder\/admin\/contracts\/(\d+)$/);
      if (route && request.method === 'PATCH') {
        const contract = updateContract(Number(route[0]), await readJson(request));
        if (!contract) throw Object.assign(new Error('Contract not found'), { status: 404 });
        sendJson(response, 200, { contract }); return true;
      }
      if (route && request.method === 'DELETE') {
        db.prepare('DELETE FROM contracts WHERE id = ?').run(route[0]); sendJson(response, 200, { ok: true }); return true;
      }
      if (request.method === 'POST' && pathname === '/api/contract-finder/admin/contracts/deduplicate') {
        sendJson(response, 200, { removed: removeDuplicateContracts() }); return true;
      }
      route = match(pathname, /^\/api\/contract-finder\/admin\/users\/(\d+)$/);
      if (route && request.method === 'PATCH') {
        const body = await readJson(request);
        db.prepare(`UPDATE users SET role = COALESCE(?, role), plan = COALESCE(?, plan), is_active = COALESCE(?, is_active), updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
          .run(body.role ?? null, body.plan ?? null, body.is_active === undefined ? null : Number(Boolean(body.is_active)), route[0]);
        sendJson(response, 200, { ok: true }); return true;
      }
    }

    if (request.method === 'POST' && pathname === '/api/contract-finder/cron/daily') {
      if (request.headers.authorization !== `Bearer ${config.cronSecret}`) throw Object.assign(new Error('Invalid cron credentials'), { status: 401 });
      sendJson(response, 200, await runDailyJobs()); return true;
    }

    sendJson(response, 404, { error: 'API route not found' }); return true;
  } catch (error) {
    console.error(error);
    sendJson(response, error.status || 500, { error: error.message || 'Internal server error', code: error.code });
    return true;
  }
}
