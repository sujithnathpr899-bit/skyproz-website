import { config } from './config.mjs';
import { escapeHtml } from './utils.mjs';

const pages = {
  opportunities: ['Worker Opportunities | Skyproz Services', 'Find worldwide industrial jobs for rope access, offshore, wind, mechanical, electrical and specialist trades.'],
  login: ['Worker Login | Skyproz Services', 'Sign in to your Skyproz worker dashboard.'],
  signup: ['Join Our Workforce | Skyproz Services', 'Create your professional worker profile and connect with employers worldwide.'],
  dashboard: ['Worker Dashboard | Skyproz Services', 'Manage your profile, applications, documents and messages.'],
  profile: ['Worker Profile | Skyproz Services', 'Update worker skills, experience, certifications and preferred countries.'],
  job: ['Job Details | Skyproz Services', 'Review worker opportunity details and apply.'],
  admin: ['Worker Admin | Skyproz Services', 'Admin tools for worker verification, documents and exports.'],
  notFound: ['Worker Page Not Found | Skyproz Services', 'The requested worker portal page was not found.']
};

export function renderWorkerShell({ page = 'opportunities', identifier = '' } = {}) {
  const [title, description] = pages[page] || pages.notFound;
  const canonicalPath = page === 'opportunities' ? '/workers' : `/workers/${page}`;
  const canonical = `${config.appOrigin}${canonicalPath}`;
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
  <meta name="description" content="${escapeHtml(description)}">
  <meta name="theme-color" content="#08111d">
  <link rel="canonical" href="${escapeHtml(canonical)}">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@600;700;800&family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/workers/assets/styles.css">
  <script type="application/ld+json">${JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'WebApplication',
    name: 'Skyproz Worker Portal',
    url: `${config.appOrigin}/workers`,
    applicationCategory: 'BusinessApplication',
    provider: { '@type': 'Organization', name: 'Skyproz Services', url: config.appOrigin }
  })}</script>
</head>
<body>
  <a class="skip-link" href="#worker-app">Skip to worker portal</a>
  <div class="worker-ambient" aria-hidden="true"></div>
  <header class="worker-header">
    <a class="worker-brand" href="/"><span>S</span><strong>Skyproz</strong><small>Worker Portal</small></a>
    <button class="worker-menu" type="button" aria-label="Open worker navigation" aria-expanded="false">Menu</button>
    <nav class="worker-nav" aria-label="Worker portal navigation">
      <a href="/">Company Site</a>
      <a href="/workers">Find Opportunities</a>
      <div class="worker-nav-account" data-worker-account>
        <a class="button button-gold worker-account-cta" href="/workers/signup">Join Our Workforce</a>
      </div>
    </nav>
  </header>
  <main id="worker-app" data-page="${escapeHtml(page)}" data-identifier="${escapeHtml(identifier)}">
    <section class="worker-loading">Loading Worker Portal...</section>
  </main>
  <div id="worker-toast" role="status" aria-live="polite"></div>
  <script type="module" src="/workers/assets/app.js"></script>
</body>
</html>`;
}
