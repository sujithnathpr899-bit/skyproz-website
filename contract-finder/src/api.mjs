import { db, parseJson } from './db.mjs';
import { config } from './config.mjs';
import { createSession, currentUser, destroySession, hashPassword, requireAdmin, requirePremium, requireUser, sessionCookie, clearSessionCookie, verifyPassword } from './auth.mjs';
import { createContract, getContract, listFilterOptions, removeDuplicateContracts, searchContracts, updateContract } from './contracts.mjs';
import { runAiTask } from './services/ai.mjs';
import { availableConnectors, connectorStatus, importSource, testSourceConnection } from './services/importer.mjs';
import { botStatus, createKeyword, deleteKeyword, listKeywords, runProcurementBot, updateKeyword } from './services/procurement-bot.mjs';
import { generateAnalyticsSnapshot, runSchedulerJob, schedulerHealth } from './jobs.mjs';
import { readJson, sendJson } from './utils.mjs';

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

const rateBuckets = new Map();
function rateLimit(request, pathname) {
  const key = `${request.socket?.remoteAddress || 'local'}:${pathname}`;
  const now = Date.now();
  const bucket = rateBuckets.get(key) || { count: 0, resetAt: now + 60000 };
  if (bucket.resetAt < now) { bucket.count = 0; bucket.resetAt = now + 60000; }
  bucket.count++;
  rateBuckets.set(key, bucket);
  if (bucket.count > 240) throw Object.assign(new Error('Too many requests'), { status: 429 });
}

function auditLog(user, request, action, entityType = null, entityId = null, metadata = {}) {
  db.prepare(`INSERT INTO audit_logs(user_id, action, entity_type, entity_id, metadata_json, ip_address)
    VALUES (?, ?, ?, ?, ?, ?)`).run(user?.id || null, action, entityType, entityId ? String(entityId) : null, JSON.stringify(metadata), request.socket?.remoteAddress || null);
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
    rateLimit(request, pathname);
    if (request.method === 'GET' && pathname === '/api/contract-finder/health') {
      sendJson(response, 200, {
        ok: true,
        service: 'skyproz-contract-finder',
        time: new Date().toISOString(),
        database: { ok: true, contracts: db.prepare('SELECT COUNT(*) AS count FROM contracts').get().count },
        scheduler: db.prepare('SELECT status, started_at, completed_at FROM scheduler_runs ORDER BY started_at DESC LIMIT 1').get() || null
      }); return true;
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
      const advanced = ['source_id', 'source_name', 'verified', 'category', 'ai_category', 'region', 'buyer', 'posted_before', 'posted_after', 'min_score', 'sort'].some((key) => filters[key] && !['newest', 'deadline'].includes(filters[key]));
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
        .map((row) => ({ ...row, filters: parseJson(row.filters_json, {}), email_enabled: Boolean(row.email_enabled), whatsapp_enabled: Boolean(row.whatsapp_enabled), telegram_enabled: Boolean(row.telegram_enabled), browser_push_enabled: Boolean(row.browser_push_enabled), is_active: Boolean(row.is_active) }));
      sendJson(response, 200, { items: rows }); return true;
    }
    if (request.method === 'POST' && pathname === '/api/contract-finder/alerts') {
      const user = requireUser(request); const body = await readJson(request); requireFields(body, ['name']);
      const existingCount = db.prepare('SELECT COUNT(*) AS count FROM user_alerts WHERE user_id = ? AND is_active = 1').get(user.id).count;
      if (user.plan !== 'premium' && existingCount >= 1) throw Object.assign(new Error('Free accounts can create one active alert'), { status: 403, code: 'PREMIUM_REQUIRED' });
      if (body.whatsapp_enabled && user.plan !== 'premium') throw Object.assign(new Error('WhatsApp alerts require premium'), { status: 403, code: 'PREMIUM_REQUIRED' });
      const frequency = body.frequency === 'instant' ? 'immediate' : body.frequency || 'daily';
      const result = db.prepare(`INSERT INTO user_alerts(user_id, saved_search_id, name, filters_json, frequency, email_enabled, whatsapp_enabled, telegram_enabled, browser_push_enabled)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(user.id, body.saved_search_id || null, body.name, JSON.stringify(body.filters || {}), frequency, Number(body.email_enabled !== false), Number(Boolean(body.whatsapp_enabled)), Number(Boolean(body.telegram_enabled)), Number(Boolean(body.browser_push_enabled)));
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
      const adminUser = requireAdmin(request);
      if (request.method === 'GET' && pathname === '/api/contract-finder/admin/analytics') {
        const analytics = {
          contracts: db.prepare('SELECT COUNT(*) AS value FROM contracts').get().value,
          open_contracts: db.prepare("SELECT COUNT(*) AS value FROM contracts WHERE status IN ('open','closing_soon')").get().value,
          new_today: db.prepare("SELECT COUNT(*) AS value FROM contracts WHERE date(created_at) = date('now')").get().value,
          closing_soon: db.prepare("SELECT COUNT(*) AS value FROM contracts WHERE status = 'closing_soon'").get().value,
          expired: db.prepare("SELECT COUNT(*) AS value FROM contracts WHERE status = 'expired'").get().value,
          verified_contracts: db.prepare('SELECT COUNT(*) AS value FROM contracts WHERE verified = 1').get().value,
          users: db.prepare('SELECT COUNT(*) AS value FROM users').get().value,
          premium_users: db.prepare("SELECT COUNT(*) AS value FROM users WHERE plan = 'premium'").get().value,
          active_alerts: db.prepare('SELECT COUNT(*) AS value FROM user_alerts WHERE is_active = 1').get().value,
          sources: db.prepare('SELECT COUNT(*) AS value FROM contract_sources WHERE is_active = 1').get().value,
          countries: db.prepare("SELECT COUNT(DISTINCT country) AS value FROM contracts WHERE country <> ''").get().value,
          industries: db.prepare("SELECT COUNT(DISTINCT industry) AS value FROM contracts WHERE industry <> ''").get().value,
          buyers: db.prepare("SELECT COUNT(DISTINCT buyer_name) AS value FROM contracts WHERE buyer_name <> ''").get().value,
          import_success_rate: db.prepare(`SELECT ROUND(100.0 * SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) / MAX(COUNT(*), 1), 2) AS value FROM import_runs`).get().value || 0,
          average_import_duration: db.prepare("SELECT ROUND(AVG(duration_ms), 0) AS value FROM import_runs WHERE status = 'completed'").get().value || 0,
          duplicate_rate: db.prepare(`SELECT ROUND(100.0 * SUM(CASE WHEN duplicate_key IS NOT NULL THEN 1 ELSE 0 END) / MAX(COUNT(*), 1), 2) AS value FROM contracts`).get().value || 0,
          top_countries: db.prepare('SELECT country, COUNT(*) AS count FROM contracts GROUP BY country ORDER BY count DESC LIMIT 8').all(),
          top_industries: db.prepare('SELECT industry, COUNT(*) AS count FROM contracts GROUP BY industry ORDER BY count DESC LIMIT 8').all(),
          top_buyers: db.prepare("SELECT buyer_name, COUNT(*) AS count FROM contracts WHERE buyer_name IS NOT NULL AND buyer_name <> '' GROUP BY buyer_name ORDER BY count DESC LIMIT 8").all(),
          newest_opportunities: db.prepare('SELECT id, slug, title, country, ai_score, ai_priority, created_at FROM contracts ORDER BY created_at DESC LIMIT 8').all(),
          ai_match_distribution: db.prepare(`SELECT CASE WHEN ai_score >= 85 THEN 'High' WHEN ai_score >= 70 THEN 'Medium' WHEN ai_score >= 50 THEN 'Potential' ELSE 'Low' END AS bucket, COUNT(*) AS count FROM contracts GROUP BY bucket ORDER BY count DESC`).all(),
          largest_contracts: db.prepare('SELECT id, slug, title, budget_value, currency FROM contracts WHERE budget_value IS NOT NULL ORDER BY budget_value DESC LIMIT 8').all(),
          recent_imports: db.prepare('SELECT * FROM import_runs ORDER BY started_at DESC LIMIT 10').all(),
          bot: botStatus(adminUser.id)
        };
        sendJson(response, 200, analytics); return true;
      }
      if (request.method === 'GET' && pathname === '/api/contract-finder/admin/connectors') {
        sendJson(response, 200, connectorStatus()); return true;
      }
      if (request.method === 'GET' && pathname === '/api/contract-finder/admin/bot/status') {
        sendJson(response, 200, botStatus(adminUser.id)); return true;
      }
      if (request.method === 'POST' && pathname === '/api/contract-finder/admin/bot/run') {
        const body = await readJson(request);
        const result = await runProcurementBot({ schedule: body.schedule || 'manual', jobType: 'manual' });
        auditLog(adminUser, request, 'bot.run', 'bot_runs', result.run_id, { schedule: body.schedule || 'manual' });
        sendJson(response, 200, result); return true;
      }
      if (request.method === 'GET' && pathname === '/api/contract-finder/admin/bot/keywords') {
        sendJson(response, 200, { items: listKeywords() }); return true;
      }
      if (request.method === 'POST' && pathname === '/api/contract-finder/admin/bot/keywords') {
        const keyword = createKeyword(await readJson(request), adminUser.id);
        auditLog(adminUser, request, 'bot.keyword.create', 'procurement_keywords', keyword.id, keyword);
        sendJson(response, 201, { keyword }); return true;
      }
      route = match(pathname, /^\/api\/contract-finder\/admin\/bot\/keywords\/(\d+)$/);
      if (route && request.method === 'PATCH') {
        const keyword = updateKeyword(route[0], await readJson(request));
        auditLog(adminUser, request, 'bot.keyword.update', 'procurement_keywords', route[0], keyword);
        sendJson(response, 200, { keyword }); return true;
      }
      if (route && request.method === 'DELETE') {
        const removed = deleteKeyword(route[0]);
        auditLog(adminUser, request, 'bot.keyword.delete', 'procurement_keywords', route[0], { removed });
        sendJson(response, 200, { removed }); return true;
      }
      route = match(pathname, /^\/api\/contract-finder\/admin\/notifications\/(\d+)\/read$/);
      if (route && request.method === 'POST') {
        db.prepare('UPDATE dashboard_notifications SET is_read = 1 WHERE id = ? AND user_id = ?').run(route[0], adminUser.id);
        sendJson(response, 200, { ok: true }); return true;
      }
      if (request.method === 'GET' && pathname === '/api/contract-finder/admin/monitoring') {
        sendJson(response, 200, { ...schedulerHealth(), connectors: connectorStatus(), bot: botStatus(adminUser.id) }); return true;
      }
      if (request.method === 'GET' && pathname === '/api/contract-finder/admin/users') {
        sendJson(response, 200, { items: db.prepare('SELECT id, email, display_name, phone, role, plan, is_active, created_at FROM users ORDER BY created_at DESC').all() }); return true;
      }
      if (request.method === 'GET' && pathname === '/api/contract-finder/admin/sources') {
        sendJson(response, 200, { connectors: availableConnectors(), items: db.prepare('SELECT * FROM contract_sources ORDER BY name').all().map((row) => ({ ...row, parser_config: parseJson(row.parser_config_json, {}), metadata: parseJson(row.metadata_json, {}) })) }); return true;
      }
      if (request.method === 'POST' && pathname === '/api/contract-finder/admin/sources') {
        const body = await readJson(request); requireFields(body, ['name', 'source_url']);
        const result = db.prepare(`INSERT INTO contract_sources(name, source_url, api_url, country, source_type, parser_type, parser_config_json, is_active)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(body.name, body.source_url, body.api_url || null, body.country || null, body.source_type || 'government', body.parser_type || 'json', JSON.stringify(body.parser_config || {}), Number(body.is_active !== false));
        db.prepare(`UPDATE contract_sources SET connector_key = ?, region = ?, schedule = ?, metadata_json = ? WHERE id = ?`)
          .run(body.connector_key || body.parser_type || 'json', body.region || null, body.schedule || 'daily', JSON.stringify(body.metadata || {}), result.lastInsertRowid);
        auditLog(adminUser, request, 'source.create', 'contract_sources', result.lastInsertRowid, { name: body.name });
        sendJson(response, 201, { id: Number(result.lastInsertRowid) }); return true;
      }
      route = match(pathname, /^\/api\/contract-finder\/admin\/sources\/(\d+)$/);
      if (route && request.method === 'PATCH') {
        const body = await readJson(request);
        db.prepare(`UPDATE contract_sources SET name = COALESCE(?, name), source_url = COALESCE(?, source_url), api_url = COALESCE(?, api_url),
          country = COALESCE(?, country), region = COALESCE(?, region), source_type = COALESCE(?, source_type),
          connector_key = COALESCE(?, connector_key), schedule = COALESCE(?, schedule), parser_config_json = COALESCE(?, parser_config_json),
          is_active = COALESCE(?, is_active), updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
          .run(body.name ?? null, body.source_url ?? null, body.api_url ?? null, body.country ?? null, body.region ?? null, body.source_type ?? null,
            body.connector_key ?? null, body.schedule ?? null, body.parser_config ? JSON.stringify(body.parser_config) : null,
            body.is_active === undefined ? null : Number(Boolean(body.is_active)), route[0]);
        auditLog(adminUser, request, 'source.update', 'contract_sources', route[0], body);
        sendJson(response, 200, { ok: true }); return true;
      }
      route = match(pathname, /^\/api\/contract-finder\/admin\/sources\/(\d+)\/test$/);
      if (route && request.method === 'POST') {
        const source = db.prepare('SELECT * FROM contract_sources WHERE id = ?').get(route[0]);
        if (!source) throw Object.assign(new Error('Source not found'), { status: 404 });
        const result = await testSourceConnection(source);
        auditLog(adminUser, request, 'source.test', 'contract_sources', route[0], result);
        sendJson(response, 200, result); return true;
      }
      route = match(pathname, /^\/api\/contract-finder\/admin\/sources\/(\d+)\/import$/);
      if (route && request.method === 'POST') {
        const source = db.prepare('SELECT * FROM contract_sources WHERE id = ?').get(route[0]);
        if (!source) throw Object.assign(new Error('Source not found'), { status: 404 });
        const result = await importSource(source);
        auditLog(adminUser, request, 'source.import', 'contract_sources', route[0], result);
        sendJson(response, 200, result); return true;
      }
      route = match(pathname, /^\/api\/contract-finder\/admin\/jobs\/(hourly|daily|weekly|monthly)$/);
      if (route && request.method === 'POST') {
        const result = await runSchedulerJob(route[0]);
        auditLog(adminUser, request, 'scheduler.run', 'scheduler_runs', result.run_id, { job_type: route[0] });
        sendJson(response, 200, result); return true;
      }
      if (request.method === 'POST' && pathname === '/api/contract-finder/admin/analytics/snapshot') {
        const result = generateAnalyticsSnapshot('manual');
        auditLog(adminUser, request, 'analytics.snapshot', 'analytics_snapshots', null, {});
        sendJson(response, 200, result); return true;
      }
      if (request.method === 'POST' && pathname === '/api/contract-finder/admin/contracts') {
        const contract = createContract(await readJson(request));
        auditLog(adminUser, request, 'contract.create', 'contracts', contract.id, {});
        sendJson(response, 201, { contract }); return true;
      }
      route = match(pathname, /^\/api\/contract-finder\/admin\/contracts\/(\d+)$/);
      if (route && request.method === 'PATCH') {
        const contract = updateContract(Number(route[0]), await readJson(request));
        if (!contract) throw Object.assign(new Error('Contract not found'), { status: 404 });
        auditLog(adminUser, request, 'contract.update', 'contracts', route[0], {});
        sendJson(response, 200, { contract }); return true;
      }
      if (route && request.method === 'DELETE') {
        db.prepare('DELETE FROM contracts WHERE id = ?').run(route[0]); auditLog(adminUser, request, 'contract.delete', 'contracts', route[0], {}); sendJson(response, 200, { ok: true }); return true;
      }
      if (request.method === 'POST' && pathname === '/api/contract-finder/admin/contracts/deduplicate') {
        const removed = removeDuplicateContracts(); auditLog(adminUser, request, 'contract.deduplicate', 'contracts', null, { removed }); sendJson(response, 200, { removed }); return true;
      }
      route = match(pathname, /^\/api\/contract-finder\/admin\/users\/(\d+)$/);
      if (route && request.method === 'PATCH') {
        const body = await readJson(request);
        db.prepare(`UPDATE users SET role = COALESCE(?, role), plan = COALESCE(?, plan), is_active = COALESCE(?, is_active), updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
          .run(body.role ?? null, body.plan ?? null, body.is_active === undefined ? null : Number(Boolean(body.is_active)), route[0]);
        auditLog(adminUser, request, 'user.update', 'users', route[0], body);
        sendJson(response, 200, { ok: true }); return true;
      }
    }

    if (request.method === 'POST' && pathname === '/api/contract-finder/cron/daily') {
      if (request.headers.authorization !== `Bearer ${config.cronSecret}`) throw Object.assign(new Error('Invalid cron credentials'), { status: 401 });
      sendJson(response, 200, await runSchedulerJob('daily')); return true;
    }
    route = match(pathname, /^\/api\/contract-finder\/cron\/(hourly|daily|weekly|monthly)$/);
    if (route && request.method === 'POST') {
      if (request.headers.authorization !== `Bearer ${config.cronSecret}`) throw Object.assign(new Error('Invalid cron credentials'), { status: 401 });
      sendJson(response, 200, await runSchedulerJob(route[0])); return true;
    }

    sendJson(response, 404, { error: 'API route not found' }); return true;
  } catch (error) {
    if (!error.status || error.status >= 500) console.error(error);
    sendJson(response, error.status || 500, { error: error.message || 'Internal server error', code: error.code });
    return true;
  }
}
