import { config } from './config.mjs';
import { escapeHtml } from './utils.mjs';

const pageMeta = {
  home: ['Contract Finder | Skyproz Services', 'Discover verified contract and tender opportunities across industries and countries.'],
  search: ['Search Contracts & Tenders | Skyproz', 'Filter contract opportunities by country, industry, budget, deadline and work mode.'],
  contracts: ['Contracts Database | Skyproz', 'Search, filter, sort and export Skyproz contract opportunities.'],
  dashboard: ['Contract Dashboard | Skyproz', 'Track saved contracts, deadlines, searches and alerts.'],
  favorites: ['Favorite Contracts | Skyproz', 'Review and track your saved contract opportunities.'],
  saved: ['Saved Searches | Skyproz', 'Manage saved contract searches and alerts.'],
  alerts: ['Contract Alerts | Skyproz', 'Manage email and WhatsApp contract notifications.'],
  admin: ['Contract Finder Admin | Skyproz', 'Manage contract sources, listings, subscribers and analytics.'],
  connectors: ['Connector Manager | Skyproz', 'Manage procurement connector health, configuration, imports and logs.'],
  sourceDiscovery: ['Source Discovery | Skyproz', 'Discover official procurement APIs, feeds, authentication and field mappings.'],
  connectorWizard: ['Connector Wizard | Skyproz', 'Guided setup for official procurement connector APIs and public feeds.'],
  marketplace: ['Connector Marketplace | Skyproz', 'Review procurement connector coverage and install supported official sources.'],
  privateOpportunities: ['Lead Finder | Skyproz', 'Admin-only private building maintenance lead and opportunity management.'],
  privateOpportunity: ['Private Opportunity Detail | Skyproz', 'Admin-only private opportunity intelligence and source details.'],
  erpModule: ['Business Portal | Skyproz', 'Admin-only ERP and business operations workspace.'],
  login: ['Sign In | Skyproz Contract Finder', 'Sign in to save contracts and create opportunity alerts.']
};

export function renderShell({ page = 'home', identifier = '', contract = null, privateView = false } = {}) {
  const [defaultTitle, defaultDescription] = pageMeta[page] || pageMeta.home;
  const title = contract ? `${contract.title} | Skyproz Contract Finder` : defaultTitle;
  const description = contract ? String(contract.description).slice(0, 155) : defaultDescription;
  const privatePage = privateView || ['dashboard','favorites','saved','alerts','watchlists','admin','connectors','sourceDiscovery','connectorWizard','marketplace','privateOpportunities','privateOpportunity','erpModule','login'].includes(page);
  const canonical = contract ? `${config.appOrigin}/contract-finder/contracts/${contract.slug}` : `${config.appOrigin}/contract-finder/${page === 'home' ? '' : page}`;
  const structuredData = contract ? {
    '@context': 'https://schema.org', '@type': 'GovernmentService', name: contract.title,
    description: contract.description, serviceType: contract.contract_type,
    areaServed: contract.country, provider: { '@type': 'Organization', name: contract.source_name, url: contract.source_url },
    validThrough: contract.deadline
  } : {
    '@context': 'https://schema.org', '@type': 'WebApplication', name: 'Skyproz Contract Finder',
    applicationCategory: 'BusinessApplication', url: `${config.appOrigin}/contract-finder/`
  };
  const fallback = contract ? `<article class="seo-contract"><h1>${escapeHtml(contract.title)}</h1><p>${escapeHtml(contract.description)}</p><dl><dt>Country</dt><dd>${escapeHtml(contract.country)}</dd><dt>Industry</dt><dd>${escapeHtml(contract.industry)}</dd><dt>Deadline</dt><dd>${escapeHtml(contract.deadline || 'Not stated')}</dd></dl></article>` : '';
  const publicSeo = privatePage ? '' : `
  <meta property="og:title" content="${escapeHtml(title)}">
  <meta property="og:description" content="${escapeHtml(description)}">
  <meta property="og:type" content="website">
  <link rel="canonical" href="${escapeHtml(canonical)}">
  <script type="application/ld+json">${JSON.stringify(structuredData).replace(/</g, '\\u003c')}</script>`;
  const navigation = privatePage && page !== 'login'
    ? '<a href="/">Company Site</a><a href="/admin/dashboard">Admin Dashboard</a><a href="/admin/contracts">Government Contracts</a><a href="/admin/lead-finder">Lead Finder</a><a href="/admin/connectors">Connectors</a><a href="/admin/crm">ERP</a>'
    : '<a href="/">Company Site</a><a href="/contract-finder/">Contract Finder</a><a href="/contract-finder/contracts">Contracts</a><a href="/contract-finder/search">Search</a><a href="/contract-finder/dashboard">Dashboard</a>';
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="description" content="${escapeHtml(description)}">
  <meta name="robots" content="${privatePage ? 'noindex,nofollow,noarchive' : 'index, follow'}">${publicSeo}
  <title>${escapeHtml(title)}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@600;700;800&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/contract-finder/assets/styles.css">
</head>
<body>
  <header class="site-header">
    <a class="brand" href="/"><span class="brand-mark">S</span><span><strong>SKYPROZ</strong><small>SERVICES</small></span></a>
    <button class="menu-toggle" type="button" aria-expanded="false">Menu</button>
    <nav class="nav-links">
      ${navigation}
    </nav>
    <div id="account-nav"></div>
  </header>
  <main id="app" data-page="${escapeHtml(page)}" data-identifier="${escapeHtml(identifier)}">
    <div class="loading-state">Loading Contract Finder...</div>
    <noscript>${fallback}<p>JavaScript is required for interactive search and account features.</p></noscript>
  </main>
  <footer><a class="brand" href="/"><span class="brand-mark">S</span><span><strong>SKYPROZ</strong><small>SERVICES</small></span></a><p>Contract and tender intelligence for ambitious businesses.</p><p>&copy; ${new Date().getFullYear()} Skyproz Services</p></footer>
  <div id="toast" role="status" aria-live="polite"></div>
  <script type="module" src="/contract-finder/assets/app.js"></script>
</body>
</html>`;
}
