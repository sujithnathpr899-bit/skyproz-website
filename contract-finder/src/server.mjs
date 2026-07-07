import fs from 'node:fs';
import path from 'node:path';
import { createServer } from 'node:http';
import { config, rootDir, validateProductionConfig } from './config.mjs';
import { db, migrate } from './db.mjs';
import { currentUser, requireAdmin } from './auth.mjs';
import { getContract } from './contracts.mjs';
import { handleApi } from './api.mjs';
import { handleWorkerApi } from './worker-api.mjs';
import { runSchedulerJob } from './jobs.mjs';
import { renderShell } from './views.mjs';
import { renderWorkerShell } from './worker-views.mjs';
import { escapeHtml, sendBody, sendHtml, withSecurityHeaders } from './utils.mjs';

validateProductionConfig();
migrate();

const assets = new Map([
  ['/contract-finder/assets/styles.css', ['styles.css', 'text/css; charset=utf-8']],
  ['/contract-finder/assets/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/workers/assets/styles.css', ['worker-styles.css', 'text/css; charset=utf-8']],
  ['/workers/assets/app.js', ['worker-app.js', 'text/javascript; charset=utf-8']]
]);

const companyMimeTypes = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml'],
  ['.xml', 'application/xml; charset=utf-8'],
  ['.webmanifest', 'application/manifest+json; charset=utf-8'],
  ['.txt', 'text/plain; charset=utf-8']
]);

const adminHeaders = { 'cache-control': 'no-store', 'x-robots-tag': 'noindex, nofollow' };

const adminPages = new Map([
  ['/admin', { page: 'admin' }],
  ['/admin/', { page: 'admin' }],
  ['/admin/dashboard', { page: 'admin' }],
  ['/admin/contracts', { page: 'contracts' }],
  ['/admin/contracts/', { page: 'contracts' }],
  ['/admin/government-contracts', { page: 'admin' }],
  ['/admin/private-opportunities', { page: 'privateOpportunities' }],
  ['/admin/private-opportunities/', { page: 'privateOpportunities' }],
  ['/admin/lead-finder', { page: 'privateOpportunities' }],
  ['/admin/lead-finder/', { page: 'privateOpportunities' }],
  ['/admin/connectors', { page: 'connectors' }],
  ['/admin/connectors/', { page: 'connectors' }],
  ['/admin/connector-wizard', { page: 'connectorWizard' }],
  ['/admin/connector-wizard/', { page: 'connectorWizard' }],
  ['/admin/source-discovery', { page: 'sourceDiscovery' }],
  ['/admin/source-discovery/', { page: 'sourceDiscovery' }],
  ['/admin/marketplace', { page: 'marketplace' }],
  ['/admin/marketplace/', { page: 'marketplace' }]
]);

const erpModules = new Set([
  'crm',
  'customers',
  'companies',
  'quotations',
  'proforma-invoices',
  'gst-invoices',
  'invoices',
  'payment-receipts',
  'work-orders',
  'job-cards',
  'amc',
  'amc-management',
  'purchase-orders',
  'vendors',
  'inventory',
  'expenses',
  'financial-dashboard',
  'reports',
  'documents',
  'company-profile',
  'users',
  'user-management',
  'roles-permissions',
  'audit-logs',
  'email-templates',
  'whatsapp-templates',
  'settings'
]);

function isAdminPath(pathname) {
  return pathname === '/admin' || pathname.startsWith('/admin/') || pathname.startsWith('/contract-finder/admin') || pathname === '/workers/admin';
}

function logPermissionDenied(request, pathname, status) {
  try {
    const user = currentUser(request);
    db.prepare(`INSERT INTO audit_logs(user_id, action, entity_type, entity_id, metadata_json, ip_address)
      VALUES (?, ?, ?, ?, ?, ?)`).run(user?.id || null, 'permission.denied', 'route', pathname, JSON.stringify({ status, method: request.method }), request.socket?.remoteAddress || null);
  } catch {
    // Permission logging should never mask the original authentication response.
  }
}

function serveAsset(request, response, pathname) {
  const asset = assets.get(pathname);
  if (!asset) return false;
  const [filename, type] = asset;
  const body = fs.readFileSync(path.join(rootDir, 'public', filename));
  sendBody(response, 200, body, { 'content-type': type, 'cache-control': 'public, max-age=3600' }, request); return true;
}

function serveCompanySite(request, response, pathname) {
  if (!fs.existsSync(config.companySiteDir)) return false;
  const relativePath = pathname === '/' ? 'index.html' : decodeURIComponent(pathname).replace(/^\/+/, '');
  if (!relativePath || relativePath.includes('\0')) return false;
  const filePath = path.resolve(config.companySiteDir, relativePath);
  if (!filePath.startsWith(config.companySiteDir + path.sep) && filePath !== config.companySiteDir) return false;
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return false;
  const body = fs.readFileSync(filePath);
  const contentType = companyMimeTypes.get(path.extname(filePath)) || 'application/octet-stream';
  const cacheControl = path.basename(filePath) === 'index.html' ? 'no-cache' : 'public, max-age=86400';
  sendBody(response, 200, body, { 'content-type': contentType, 'cache-control': cacheControl }, request); return true;
}

function renderSitemap(request, response) {
  const contracts = db.prepare("SELECT slug, updated_at FROM contracts WHERE status IN ('open','closing_soon') ORDER BY updated_at DESC").all();
  const urls = [
    `<url><loc>${config.appOrigin}/contract-finder/</loc><changefreq>daily</changefreq><priority>1.0</priority></url>`,
    `<url><loc>${config.appOrigin}/contract-finder/search</loc><changefreq>daily</changefreq><priority>0.9</priority></url>`,
    `<url><loc>${config.appOrigin}/contract-finder/contracts</loc><changefreq>daily</changefreq><priority>0.9</priority></url>`,
    ...contracts.map((contract) => `<url><loc>${config.appOrigin}/contract-finder/contracts/${escapeHtml(contract.slug)}</loc><lastmod>${new Date(contract.updated_at).toISOString()}</lastmod><changefreq>weekly</changefreq><priority>0.8</priority></url>`)
  ].join('');
  const xml = `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`;
  sendBody(response, 200, xml, { 'content-type': 'application/xml; charset=utf-8', 'cache-control': 'public, max-age=3600' }, request);
}

export const server = createServer(async (request, response) => {
  const url = new URL(request.url, config.appOrigin);
  try {
    if (serveAsset(request, response, url.pathname)) return;
    if (await handleWorkerApi(request, response, url)) return;
    if (await handleApi(request, response, url)) return;
    if (url.pathname === '/contract-finder/sitemap.xml') return renderSitemap(request, response);
    if (url.pathname === '/contract-finder/robots.txt') {
      sendBody(response, 200, `User-agent: *\nAllow: /contract-finder/\nSitemap: ${config.appOrigin}/contract-finder/sitemap.xml\n`, { 'content-type': 'text/plain; charset=utf-8' }, request); return;
    }
    if (url.pathname === '/contact' || url.pathname === '/contact/') {
      response.writeHead(302, withSecurityHeaders({ location: '/#contact' }));
      response.end(); return;
    }
    if (!url.pathname.startsWith('/contract-finder') && !url.pathname.startsWith('/workers') && serveCompanySite(request, response, url.pathname)) return;
    if (url.pathname === '/') { response.writeHead(302, withSecurityHeaders({ location: '/contract-finder/' })); response.end(); return; }
    const workerJob = url.pathname.match(/^\/workers\/jobs\/([^/]+)$/);
    if (workerJob) {
      return sendHtml(response, 200, renderWorkerShell({ page: 'job', identifier: decodeURIComponent(workerJob[1]) }), { 'cache-control': 'public, max-age=60' }, request);
    }
    const workerPublicProfile = url.pathname.match(/^\/workers\/profile\/([^/]+)$/);
    if (workerPublicProfile) {
      return sendHtml(response, 200, renderWorkerShell({ page: 'publicProfile', identifier: decodeURIComponent(workerPublicProfile[1]) }), { 'cache-control': 'public, max-age=60' }, request);
    }
    const workerPages = new Map([
      ['/workers', 'opportunities'], ['/workers/', 'opportunities'], ['/workers/opportunities', 'opportunities'],
      ['/workers/login', 'login'], ['/workers/signup', 'signup'], ['/workers/dashboard', 'dashboard'],
      ['/workers/profile', 'profile'], ['/workers/certifications', 'certifications'], ['/workers/documents', 'documents'],
      ['/workers/applications', 'applications'], ['/workers/saved-jobs', 'savedJobs'], ['/workers/notifications', 'notifications'],
      ['/workers/resume', 'resume'], ['/workers/skills', 'skills'], ['/workers/job-alerts', 'jobAlerts'],
      ['/workers/interviews', 'interviews'], ['/workers/analytics', 'analytics'], ['/workers/subscription', 'subscription'],
      ['/workers/settings', 'settings'], ['/workers/admin', 'admin']
    ]);
    const workerPage = workerPages.get(url.pathname);
    if (workerPage) {
      if (workerPage === 'admin') {
        requireAdmin(request);
        return sendHtml(response, 200, renderWorkerShell({ page: workerPage }), adminHeaders, request);
      }
      return sendHtml(response, 200, renderWorkerShell({ page: workerPage }), {}, request);
    }
    const adminPage = adminPages.get(url.pathname);
    if (adminPage) {
      requireAdmin(request);
      return sendHtml(response, 200, renderShell(adminPage), adminHeaders, request);
    }
    const erpPage = url.pathname.match(/^\/admin\/([^/]+)\/?$/);
    if (erpPage && erpModules.has(erpPage[1])) {
      requireAdmin(request);
      return sendHtml(response, 200, renderShell({ page: 'erpModule', identifier: erpPage[1] }), adminHeaders, request);
    }
    const erpDetailPage = url.pathname.match(/^\/admin\/([^/]+)\/([^/]+)$/);
    if (erpDetailPage && erpModules.has(erpDetailPage[1])) {
      requireAdmin(request);
      return sendHtml(response, 200, renderShell({ page: 'erpModule', identifier: `${erpDetailPage[1]}/${erpDetailPage[2]}` }), adminHeaders, request);
    }
    const adminContractDetail = url.pathname.match(/^\/admin\/contracts\/([^/]+)$/);
    if (adminContractDetail) {
      requireAdmin(request);
      const contract = getContract(decodeURIComponent(adminContractDetail[1]));
      if (!contract) return sendHtml(response, 404, renderShell({ page: 'not-found' }), adminHeaders, request);
      return sendHtml(response, 200, renderShell({ page: 'contract', identifier: adminContractDetail[1], contract, privateView: true }), adminHeaders, request);
    }
    const detail = url.pathname.match(/^\/contract-finder\/contracts\/([^/]+)$/);
    if (detail) {
      const contract = getContract(decodeURIComponent(detail[1]));
      if (!contract) return sendHtml(response, 404, renderShell({ page: 'not-found' }), {}, request);
      return sendHtml(response, 200, renderShell({ page: 'contract', identifier: detail[1], contract }), { 'cache-control': 'public, max-age=60' }, request);
    }
    const privateOpportunityDetail = url.pathname.match(/^\/(?:contract-finder\/admin|admin)\/(?:private-opportunities|lead-finder)\/([^/]+)$/);
    if (privateOpportunityDetail) {
      requireAdmin(request);
      return sendHtml(response, 200, renderShell({ page: 'privateOpportunity', identifier: decodeURIComponent(privateOpportunityDetail[1]) }), adminHeaders, request);
    }
    const pages = new Map([
      ['/contract-finder/', 'home'], ['/contract-finder', 'home'], ['/contract-finder/search', 'search'],
      ['/contract-finder/contracts', 'contracts'], ['/contract-finder/contracts/', 'contracts'],
      ['/contract-finder/dashboard', 'dashboard'], ['/contract-finder/favorites', 'favorites'],
      ['/contract-finder/saved-searches', 'saved'], ['/contract-finder/alerts', 'alerts'],
      ['/contract-finder/watchlists', 'watchlists'], ['/contract-finder/admin', 'admin'],
      ['/contract-finder/admin/connectors', 'connectors'],
      ['/contract-finder/admin/source-discovery', 'sourceDiscovery'],
      ['/contract-finder/admin/connector-wizard', 'connectorWizard'],
      ['/contract-finder/admin/marketplace', 'marketplace'],
      ['/contract-finder/admin/private-opportunities', 'privateOpportunities'],
      ['/contract-finder/admin/private-opportunities/', 'privateOpportunities'],
      ['/contract-finder/admin/lead-finder', 'privateOpportunities'],
      ['/contract-finder/admin/lead-finder/', 'privateOpportunities'],
      ['/admin/connectors', 'connectors'],
      ['/admin/source-discovery', 'sourceDiscovery'],
      ['/admin/connector-wizard', 'connectorWizard'],
      ['/admin/marketplace', 'marketplace'],
      ['/contract-finder/login', 'login']
    ]);
    const page = pages.get(url.pathname);
    if (page) {
      if (isAdminPath(url.pathname)) requireAdmin(request);
      return sendHtml(response, 200, renderShell({ page }), isAdminPath(url.pathname) ? adminHeaders : {}, request);
    }
    return sendHtml(response, 404, renderShell({ page: 'not-found' }), {}, request);
  } catch (error) {
    console.error(error);
    if (error.status === 401 || error.status === 403) {
      if (isAdminPath(url.pathname)) logPermissionDenied(request, url.pathname, error.status);
      sendHtml(response, error.status, `<h1>${error.status === 401 ? 'Authentication Required' : 'Administrator Access Required'}</h1><p>${escapeHtml(error.message)}</p>`, isAdminPath(url.pathname) ? adminHeaders : { 'cache-control': 'no-store' }, request); return;
    }
    sendHtml(response, 500, '<h1>Contract Finder error</h1><p>Please try again.</p>', {}, request);
  }
});

server.listen(config.port, config.host, () => {
  console.log(`Skyproz Contract Finder running at ${config.appOrigin}`);
});

let schedulerRunning = false;
async function runInternalScheduler() {
  if (schedulerRunning) return;
  schedulerRunning = true;
  try {
    await runSchedulerJob('hourly');
  } catch (error) {
    console.error('Skyproz procurement bot scheduler failed:', error);
  } finally {
    schedulerRunning = false;
  }
}

if (config.bot.schedulerEnabled) {
  const intervalMs = Math.max(15, config.bot.schedulerIntervalMinutes) * 60000;
  setTimeout(runInternalScheduler, 60000);
  setInterval(runInternalScheduler, intervalMs);
}
