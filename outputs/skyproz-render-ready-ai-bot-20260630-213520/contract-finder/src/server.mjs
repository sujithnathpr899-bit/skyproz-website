import fs from 'node:fs';
import path from 'node:path';
import { createServer } from 'node:http';
import { config, rootDir } from './config.mjs';
import { db, migrate } from './db.mjs';
import { getContract } from './contracts.mjs';
import { handleApi } from './api.mjs';
import { runSchedulerJob } from './jobs.mjs';
import { renderShell } from './views.mjs';
import { escapeHtml, sendHtml } from './utils.mjs';

migrate();

const assets = new Map([
  ['/contract-finder/assets/styles.css', ['styles.css', 'text/css; charset=utf-8']],
  ['/contract-finder/assets/app.js', ['app.js', 'text/javascript; charset=utf-8']]
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

function serveAsset(response, pathname) {
  const asset = assets.get(pathname);
  if (!asset) return false;
  const [filename, type] = asset;
  const body = fs.readFileSync(path.join(rootDir, 'public', filename));
  response.writeHead(200, { 'content-type': type, 'content-length': body.length, 'cache-control': 'public, max-age=3600' });
  response.end(body); return true;
}

function serveCompanySite(response, pathname) {
  if (!fs.existsSync(config.companySiteDir)) return false;
  const relativePath = pathname === '/' ? 'index.html' : decodeURIComponent(pathname).replace(/^\/+/, '');
  if (!relativePath || relativePath.includes('\0')) return false;
  const filePath = path.resolve(config.companySiteDir, relativePath);
  if (!filePath.startsWith(config.companySiteDir + path.sep) && filePath !== config.companySiteDir) return false;
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return false;
  const body = fs.readFileSync(filePath);
  const contentType = companyMimeTypes.get(path.extname(filePath)) || 'application/octet-stream';
  const cacheControl = path.basename(filePath) === 'index.html' ? 'no-cache' : 'public, max-age=86400';
  response.writeHead(200, { 'content-type': contentType, 'content-length': body.length, 'cache-control': cacheControl });
  response.end(body); return true;
}

function renderSitemap(response) {
  const contracts = db.prepare("SELECT slug, updated_at FROM contracts WHERE status IN ('open','closing_soon') ORDER BY updated_at DESC").all();
  const urls = [
    `<url><loc>${config.appOrigin}/contract-finder/</loc><changefreq>daily</changefreq><priority>1.0</priority></url>`,
    `<url><loc>${config.appOrigin}/contract-finder/search</loc><changefreq>daily</changefreq><priority>0.9</priority></url>`,
    ...contracts.map((contract) => `<url><loc>${config.appOrigin}/contract-finder/contracts/${escapeHtml(contract.slug)}</loc><lastmod>${new Date(contract.updated_at).toISOString()}</lastmod><changefreq>weekly</changefreq><priority>0.8</priority></url>`)
  ].join('');
  const xml = `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`;
  response.writeHead(200, { 'content-type': 'application/xml; charset=utf-8', 'cache-control': 'public, max-age=3600' }); response.end(xml);
}

export const server = createServer(async (request, response) => {
  const url = new URL(request.url, config.appOrigin);
  try {
    if (serveAsset(response, url.pathname)) return;
    if (await handleApi(request, response, url)) return;
    if (url.pathname === '/contract-finder/sitemap.xml') return renderSitemap(response);
    if (url.pathname === '/contract-finder/robots.txt') {
      response.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
      response.end(`User-agent: *\nAllow: /contract-finder/\nSitemap: ${config.appOrigin}/contract-finder/sitemap.xml\n`); return;
    }
    if (!url.pathname.startsWith('/contract-finder') && serveCompanySite(response, url.pathname)) return;
    if (url.pathname === '/') { response.writeHead(302, { location: '/contract-finder/' }); response.end(); return; }
    const detail = url.pathname.match(/^\/contract-finder\/contracts\/([^/]+)$/);
    if (detail) {
      const contract = getContract(decodeURIComponent(detail[1]));
      if (!contract) return sendHtml(response, 404, renderShell({ page: 'not-found' }));
      return sendHtml(response, 200, renderShell({ page: 'contract', identifier: detail[1], contract }), { 'cache-control': 'public, max-age=60' });
    }
    const pages = new Map([
      ['/contract-finder/', 'home'], ['/contract-finder', 'home'], ['/contract-finder/search', 'search'],
      ['/contract-finder/dashboard', 'dashboard'], ['/contract-finder/favorites', 'favorites'],
      ['/contract-finder/saved-searches', 'saved'], ['/contract-finder/alerts', 'alerts'],
      ['/contract-finder/watchlists', 'watchlists'], ['/contract-finder/admin', 'admin'],
      ['/contract-finder/login', 'login']
    ]);
    const page = pages.get(url.pathname);
    if (page) return sendHtml(response, 200, renderShell({ page }));
    return sendHtml(response, 404, renderShell({ page: 'not-found' }));
  } catch (error) {
    console.error(error);
    sendHtml(response, 500, '<h1>Contract Finder error</h1><p>Please try again.</p>');
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
