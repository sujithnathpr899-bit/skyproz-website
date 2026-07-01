const API = '/api/contract-finder';
const app = document.querySelector('#app');
const page = app.dataset.page;
const identifier = app.dataset.identifier;
let currentUser = null;

const escapeHtml = (value) => String(value ?? '').replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]);
const money = (value, currency = '') => value === null || value === undefined || Number.isNaN(Number(value)) ? 'Not disclosed' : `${currency || ''} ${Number(value).toLocaleString()}`.trim();
const date = (value) => value ? new Intl.DateTimeFormat('en', { dateStyle: 'medium' }).format(new Date(value)) : 'Not stated';
const boolText = (value) => value ? 'Active' : 'Disabled';
const statusText = (value) => String(value || 'not tested').replaceAll('_', ' ');

async function api(path, options = {}) {
  const response = await fetch(`${API}${path}`, {
    ...options,
    headers: { 'content-type': 'application/json', ...(options.headers || {}) }
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.error || `Request failed (${response.status})`);
    error.status = response.status; error.code = payload.code; throw error;
  }
  return payload;
}

function toast(message, isError = false) {
  const element = document.querySelector('#toast');
  element.textContent = message; element.className = isError ? 'show error-toast' : 'show';
  setTimeout(() => { element.className = ''; }, 3200);
}

function button(label, href, style = 'button-outline') {
  return `<a class="button ${style}" href="${href}">${escapeHtml(label)}</a>`;
}

function dashboardNav() {
  return `<nav class="dashboard-nav" aria-label="Contract Finder dashboard">
    ${button('Overview','/contract-finder/dashboard','button-ghost')}
    ${button('Favorites','/contract-finder/favorites','button-ghost')}
    ${button('Saved Searches','/contract-finder/saved-searches','button-ghost')}
    ${button('Alerts','/contract-finder/alerts','button-ghost')}
    ${button('Watchlists','/contract-finder/watchlists','button-ghost')}
    ${currentUser?.role === 'admin' ? button('Admin','/contract-finder/admin','button-ghost') : ''}
  </nav>`;
}

function contractCard(contract) {
  const excerpt = String(contract.description || '').slice(0, 150);
  const score = Number(contract.opportunity_score || 0);
  const sourceLabel = contract.configured_source_name || contract.source_name || 'Source';
  return `<article class="contract-card">
    <div class="card-top">
      <span class="status ${escapeHtml(contract.status)}">${escapeHtml(statusText(contract.status))}</span>
      <span class="score-badge" title="${escapeHtml(contract.opportunity_label || 'Opportunity score')}">${score}</span>
    </div>
    <h3><a href="/contract-finder/contracts/${encodeURIComponent(contract.slug)}">${escapeHtml(contract.title)}</a></h3>
    <p>${escapeHtml(excerpt)}${contract.description?.length > 150 ? '...' : ''}</p>
    <div class="chip-row">
      ${contract.verified ? '<span class="verified">Verified</span>' : ''}
      <span class="chip">${escapeHtml(contract.country || 'Worldwide')}</span>
      <span class="chip">${escapeHtml(contract.industry || 'General')}</span>
      <span class="chip">${escapeHtml(contract.work_mode || 'onsite')}</span>
      ${contract.ai_category ? `<span class="chip chip-gold">${escapeHtml(contract.ai_category)}</span>` : ''}
    </div>
    <div class="card-footer">
      <span>Deadline: <strong>${date(contract.deadline)}</strong></span>
      <span>${money(contract.budget_value, contract.currency)}</span>
      <small>${escapeHtml(sourceLabel)}</small>
    </div>
  </article>`;
}

async function renderHome() {
  const [{ items, pagination }, options] = await Promise.all([api('/contracts?page_size=6&sort=newest'), api('/filter-options')]);
  app.innerHTML = `<section class="hero">
    <div>
      <p class="eyebrow">Skyproz opportunity intelligence</p>
      <h1>Discover Contracts.<br><span>Win More Work.</span></h1>
      <p class="hero-copy">Search verified public and private opportunities, track deadlines, and turn complex tender notices into clear action plans.</p>
      <div class="toolbar">${button('Search contracts','/contract-finder/search','button-gold')}${button('Open dashboard','/contract-finder/dashboard')}</div>
    </div>
    <form class="search-hero" id="hero-search">
      <h3>Find an opportunity</h3>
      <div class="field"><label>Keyword</label><input name="keyword" placeholder="Rope access, maintenance, wind energy..."></div>
      <div class="field"><label>Country</label><select name="country"><option value="">All countries</option>${options.countries.map((v) => `<option>${escapeHtml(v)}</option>`).join('')}</select></div>
      <div class="field"><label>Industry</label><select name="industry"><option value="">All industries</option>${options.industries.map((v) => `<option>${escapeHtml(v)}</option>`).join('')}</select></div>
      <button class="button button-gold" type="submit">Search contracts</button>
    </form>
  </section>
  <section class="stats-strip">
    <div class="stat"><strong>${pagination.total}</strong><span>Active listings</span></div>
    <div class="stat"><strong>${options.countries.length}</strong><span>Countries</span></div>
    <div class="stat"><strong>${options.industries.length}</strong><span>Industries</span></div>
    <div class="stat"><strong>24/7</strong><span>Opportunity tracking</span></div>
  </section>
  <section class="page">
    <div class="section-heading"><div><p class="eyebrow">Recently added</p><h2>Latest Opportunities</h2></div><p>Fresh contract notices from configured sources, ordered by publication date.</p></div>
    <div class="card-grid">${items.map(contractCard).join('') || '<div class="empty">No contracts have been imported yet.</div>'}</div>
  </section>`;
  document.querySelector('#hero-search').addEventListener('submit', (event) => {
    event.preventDefault(); const query = new URLSearchParams(new FormData(event.currentTarget)); location.href = `/contract-finder/search?${query}`;
  });
}

function option(value, selected, label = value) {
  return `<option value="${escapeHtml(value)}" ${String(value) === String(selected || '') ? 'selected' : ''}>${escapeHtml(label)}</option>`;
}

function filterForm(options, params) {
  const selectOptions = (values, selected) => values.map((value) => option(value, selected)).join('');
  return `<form id="filters" class="filters">
    <h3>Filter contracts</h3>
    <div class="field"><label>Keyword</label><input name="keyword" value="${escapeHtml(params.get('keyword') || '')}" placeholder="Search title or description"></div>
    <div class="field"><label>Country</label><select name="country"><option value="">All</option>${selectOptions(options.countries, params.get('country'))}</select></div>
    <div class="field"><label>Region</label><select name="region"><option value="">All</option>${selectOptions(options.regions || [], params.get('region'))}</select></div>
    <div class="field"><label>Industry</label><select name="industry"><option value="">All</option>${selectOptions(options.industries, params.get('industry'))}</select></div>
    <div class="field"><label>AI category</label><select name="ai_category"><option value="">All</option>${selectOptions(options.ai_categories || [], params.get('ai_category'))}</select></div>
    <div class="field"><label>Buyer name</label><select name="buyer"><option value="">All</option>${selectOptions(options.buyers || [], params.get('buyer'))}</select></div>
    <div class="field"><label>Source</label><select name="source_name"><option value="">All</option>${(options.sources || []).map((source) => option(source.name, params.get('source_name'), `${source.name}${source.country ? ` - ${source.country}` : ''}`)).join('')}</select></div>
    <div class="field-row"><div class="field"><label>Minimum budget</label><input type="number" name="min_budget" value="${escapeHtml(params.get('min_budget') || '')}"></div><div class="field"><label>Maximum budget</label><input type="number" name="max_budget" value="${escapeHtml(params.get('max_budget') || '')}"></div></div>
    <div class="field-row"><div class="field"><label>Deadline after</label><input type="date" name="deadline_after" value="${escapeHtml(params.get('deadline_after') || '')}"></div><div class="field"><label>Deadline before</label><input type="date" name="deadline_before" value="${escapeHtml(params.get('deadline_before') || '')}"></div></div>
    <div class="field-row"><div class="field"><label>Posted after</label><input type="date" name="posted_after" value="${escapeHtml(params.get('posted_after') || '')}"></div><div class="field"><label>Posted before</label><input type="date" name="posted_before" value="${escapeHtml(params.get('posted_before') || '')}"></div></div>
    <div class="field"><label>Contract type</label><select name="contract_type"><option value="">All</option>${selectOptions(options.contract_types || [], params.get('contract_type'))}</select></div>
    <div class="field"><label>Government or Private</label><select name="buyer_type"><option value="">Government & private</option>${option('government', params.get('buyer_type'), 'Government')}${option('private', params.get('buyer_type'), 'Private')}</select></div>
    <div class="field"><label>Remote or Onsite</label><select name="work_mode"><option value="">Remote & onsite</option>${option('remote', params.get('work_mode'), 'Remote')}${option('onsite', params.get('work_mode'), 'Onsite')}${option('hybrid', params.get('work_mode'), 'Hybrid')}</select></div>
    <div class="field"><label>Minimum score</label><input type="number" name="min_score" min="0" max="100" value="${escapeHtml(params.get('min_score') || '')}" placeholder="0 - 100"></div>
    <div class="field"><label>Sort</label><select name="sort">${option('newest', params.get('sort') || 'newest', 'Newest')}${option('deadline', params.get('sort'), 'Deadline')}${option('budget_high', params.get('sort'), 'Budget high')}${option('budget_low', params.get('sort'), 'Budget low')}</select></div>
    <button class="button button-gold" type="submit">Apply filters</button>
  </form>`;
}

async function renderSearch() {
  const params = new URLSearchParams(location.search); params.set('page_size','12');
  const [results, options] = await Promise.all([api(`/contracts?${params}`), api('/filter-options')]);
  app.innerHTML = `<section class="page">
    <div class="section-heading"><div><p class="eyebrow">Contract database</p><h1>Search Opportunities</h1></div><p>Filter contracts by geography, source, buyer profile, budget, deadline and Skyproz match score.</p></div>
    <div class="search-layout">
      ${filterForm(options, params)}
      <div>
        <div class="results-header"><p><strong>${results.pagination.total}</strong> contracts found</p><div class="toolbar"><button class="button button-ghost" id="save-search">Save search</button></div></div>
        <div class="card-grid">${results.items.map(contractCard).join('') || '<div class="empty">No contracts match these filters.</div>'}</div>
        <div class="pagination"><button class="button button-ghost" id="prev" ${results.pagination.page <= 1 ? 'disabled' : ''}>Previous</button><span class="button button-ghost">Page ${results.pagination.page} of ${results.pagination.pages}</span><button class="button button-ghost" id="next" ${results.pagination.page >= results.pagination.pages ? 'disabled' : ''}>Next</button></div>
      </div>
    </div>
  </section>`;
  document.querySelector('#filters').addEventListener('submit',(event) => { event.preventDefault(); const q = new URLSearchParams(new FormData(event.currentTarget)); location.search = q; });
  document.querySelector('#prev').onclick = () => setPage(results.pagination.page - 1);
  document.querySelector('#next').onclick = () => setPage(results.pagination.page + 1);
  document.querySelector('#save-search').onclick = async () => {
    if (!currentUser) return location.href='/contract-finder/login';
    const name = prompt('Name this saved search'); if (!name) return;
    try { await api('/saved-searches',{method:'POST',body:JSON.stringify({name,filters:Object.fromEntries(params)})}); toast('Search saved'); } catch(error) { toast(error.message,true); }
  };
}

function setPage(value) { const params = new URLSearchParams(location.search); params.set('page',value); location.search=params; }

async function renderContract() {
  const { contract } = await api(`/contracts/${encodeURIComponent(identifier)}`);
  const tags = contract.tags.map((tag) => `<span class="chip">${escapeHtml(tag)}</span>`).join('');
  const score = Number(contract.opportunity_score || 0);
  const sourceButton = contract.source_url
    ? `<a class="button button-gold" href="${escapeHtml(contract.source_url)}" target="_blank" rel="noopener noreferrer">Open Original Tender</a>`
    : '<button class="button button-gold" type="button" disabled>Original Tender Unavailable</button>';
  app.innerHTML = `<section class="page detail-hero">
    <p class="eyebrow">${escapeHtml(contract.source_name)}</p>
    <h1>${escapeHtml(contract.title)}</h1>
    <div class="chip-row"><span class="status ${escapeHtml(contract.status)}">${escapeHtml(statusText(contract.status))}</span>${contract.verified?'<span class="verified">Verified</span>':''}<span class="chip">${escapeHtml(contract.country)}</span><span class="chip">${escapeHtml(contract.industry)}</span>${contract.ai_category ? `<span class="chip chip-gold">${escapeHtml(contract.ai_category)}</span>` : ''}${tags}</div>
  </section>
  <section class="page detail-grid">
    <div>
      <h2>Contract Overview</h2>
      <div class="prose">${escapeHtml(contract.description)}</div>
      <section class="ai-panel">
        <p class="eyebrow">Premium intelligence</p>
        <h2>AI Contract Assistant</h2>
        <p>Turn this notice into a practical bid plan. AI output must be checked against the original tender source.</p>
        <div class="toolbar" id="ai-actions">${['summary','requirements','checklist','deadlines','proposal'].map((task)=>`<button class="button button-ghost" data-ai="${task}">${task}</button>`).join('')}</div>
        <div id="ai-result"></div>
      </section>
    </div>
    <aside class="detail-sidebar">
      <div class="score-panel">
        <span class="score-ring">${score}</span>
        <div><strong>${escapeHtml(contract.opportunity_label || 'Opportunity score')}</strong><p>${escapeHtml(contract.ai_category || 'General opportunity')}</p></div>
      </div>
      <div class="info-panel bot-match-panel">
        <h3>AI Matching</h3>
        <dl class="info-list">
          <div><dt>Matched services</dt><dd>${escapeHtml((contract.matching_services || []).join(', ') || 'Not matched yet')}</dd></div>
          <div><dt>Business unit</dt><dd>${escapeHtml(contract.suggested_business_unit || 'Industrial Services')}</dd></div>
          <div><dt>Urgency</dt><dd>${escapeHtml(contract.submission_urgency || 'Unknown')}</dd></div>
          <div><dt>Country risk</dt><dd>${escapeHtml(contract.country_risk || 'Not assessed')}</dd></div>
          <div><dt>Recommended action</dt><dd>${escapeHtml(contract.recommended_action || 'Review source notice')}</dd></div>
          <div><dt>Language</dt><dd>${escapeHtml(contract.language || 'en')}</dd></div>
        </dl>
      </div>
      <div class="info-panel">
        <dl class="info-list">
          <div><dt>Budget</dt><dd>${money(contract.budget_value,contract.currency)}</dd></div>
          <div><dt>Deadline</dt><dd>${date(contract.deadline)}</dd></div>
          <div><dt>Posted</dt><dd>${date(contract.posted_date)}</dd></div>
          <div><dt>Contract type</dt><dd>${escapeHtml(contract.contract_type)}</dd></div>
          <div><dt>Buyer</dt><dd>${escapeHtml(contract.buyer_name || contract.buyer_type)}</dd></div>
          <div><dt>Region</dt><dd>${escapeHtml(contract.region || 'Not stated')}</dd></div>
          <div><dt>Work mode</dt><dd>${escapeHtml(contract.work_mode)}</dd></div>
        </dl>
        <div class="toolbar" style="margin-top:22px">${sourceButton}<button class="button button-outline" id="favorite">${contract.is_favorite?'Remove saved':'Save contract'}</button></div>
      </div>
    </aside>
  </section>`;
  document.querySelector('#favorite').onclick = async () => {
    if (!currentUser) return location.href='/contract-finder/login';
    try { await api(`/contracts/${contract.id}/favorite`,{method:contract.is_favorite?'DELETE':'POST',body:contract.is_favorite?undefined:'{}'}); contract.is_favorite=!contract.is_favorite; document.querySelector('#favorite').textContent=contract.is_favorite?'Remove saved':'Save contract'; toast(contract.is_favorite?'Contract saved':'Removed from favorites'); } catch(error){toast(error.message,true);}
  };
  document.querySelectorAll('[data-ai]').forEach((element)=>element.onclick=async()=>{
    if (!currentUser) return location.href='/contract-finder/login';
    const result=document.querySelector('#ai-result'); result.innerHTML='<div class="ai-result">Generating analysis...</div>';
    try { const payload=await api(`/contracts/${contract.id}/ai/${element.dataset.ai}`,{method:'POST',body:'{}'}); result.innerHTML=`<div class="ai-result">${escapeHtml(Array.isArray(payload.result)?payload.result.map((v)=>`- ${v}`).join('\n'):payload.result)}</div>`; } catch(error){ result.innerHTML=`<div class="ai-result error">${escapeHtml(error.message)}</div>`; }
  });
}

async function requireLogin() { if (!currentUser) { location.href='/contract-finder/login'; return false; } return true; }

async function renderDashboard() {
  if (!(await requireLogin())) return; const data=await api('/dashboard');
  app.innerHTML=`<section class="page"><div class="section-heading"><div><p class="eyebrow">Welcome back</p><h1>${escapeHtml(currentUser.display_name)}</h1></div><p>Monitor opportunities and keep upcoming deadlines under control.</p></div>${dashboardNav()}<div class="metric-grid">${Object.entries(data.counts).map(([label,value])=>`<div class="metric"><strong>${value}</strong><span>${escapeHtml(label.replaceAll('_',' '))}</span></div>`).join('')}</div><div class="panel"><h2>Upcoming Deadlines</h2><div class="list">${data.deadlines.map((item)=>`<a class="list-item" href="/contract-finder/contracts/${item.slug}"><div><h3>${escapeHtml(item.title)}</h3></div><strong>${date(item.deadline)}</strong></a>`).join('')||'<div class="empty">Save contracts to track deadlines here.</div>'}</div></div></section>`;
}

async function renderFavorites() {
  if (!(await requireLogin())) return; const {items}=await api('/favorites');
  app.innerHTML=`<section class="page"><div class="section-heading"><div><p class="eyebrow">Watch your pipeline</p><h1>Favorite Contracts</h1></div></div>${dashboardNav()}<div class="card-grid">${items.map(contractCard).join('')||'<div class="empty">No favorite contracts yet.</div>'}</div></section>`;
}

async function renderSaved() {
  if (!(await requireLogin())) return; const {items}=await api('/saved-searches');
  app.innerHTML=`<section class="page"><div class="section-heading"><div><p class="eyebrow">Reusable filters</p><h1>Saved Searches</h1></div></div>${dashboardNav()}<div class="list">${items.map((item)=>`<div class="list-item"><div><h3>${escapeHtml(item.name)}</h3><p>${escapeHtml(Object.entries(item.filters).filter(([,v])=>v).map(([k,v])=>`${k}: ${v}`).join(' | '))}</p></div><div class="toolbar"><a class="button button-ghost" href="/contract-finder/search?${new URLSearchParams(item.filters)}">Run search</a><button class="button button-danger" data-delete-search="${item.id}">Delete</button></div></div>`).join('')||'<div class="empty">Save filters from the search page.</div>'}</div></section>`;
  document.querySelectorAll('[data-delete-search]').forEach((el)=>el.onclick=async()=>{await api(`/saved-searches/${el.dataset.deleteSearch}`,{method:'DELETE'});el.closest('.list-item').remove();toast('Saved search deleted');});
}

async function renderAlerts() {
  if (!(await requireLogin())) return; const {items}=await api('/alerts');
  app.innerHTML=`<section class="page">
    <div class="section-heading"><div><p class="eyebrow">Never miss an opportunity</p><h1>Alerts Dashboard</h1></div></div>
    ${dashboardNav()}
    <div class="admin-grid">
      <form class="panel" id="alert-form">
        <h2>Create Alert</h2>
        <div class="field"><label>Name</label><input name="name" required></div>
        <div class="field-row"><div class="field"><label>Keyword</label><input name="keyword"></div><div class="field"><label>Country</label><input name="country"></div></div>
        <div class="field"><label>Frequency</label><select name="frequency"><option value="daily">Daily</option><option value="hourly">Hourly</option><option value="weekly">Weekly</option><option value="instant">Immediate</option></select></div>
        <div class="checkbox-row stacked">
          <label><input type="checkbox" name="email_enabled" checked> Email</label>
          <label><input type="checkbox" name="whatsapp_enabled"> WhatsApp (Premium)</label>
          <label><input type="checkbox" name="telegram_enabled"> Telegram</label>
          <label><input type="checkbox" name="browser_push_enabled"> Browser Push</label>
        </div>
        <button class="button button-gold" type="submit" style="margin-top:20px">Create alert</button>
      </form>
      <div>
        <div class="notice ${currentUser.plan==='premium'?'':'premium'}">${currentUser.plan==='premium'?'Premium alerts are active.':'Free plan includes one email alert. WhatsApp and unlimited alerts are reserved for premium accounts.'}</div>
        <div class="list" style="margin-top:15px">${items.map((item)=>`<div class="list-item"><div><h3>${escapeHtml(item.name)}</h3><p>${escapeHtml(statusText(item.frequency))} | ${item.email_enabled?'Email ':''}${item.whatsapp_enabled?'WhatsApp ':''}${item.telegram_enabled?'Telegram ':''}${item.browser_push_enabled?'Browser Push':''}</p></div><button class="button button-danger" data-delete-alert="${item.id}">Delete</button></div>`).join('')||'<div class="empty">No alerts configured.</div>'}</div>
      </div>
    </div>
  </section>`;
  document.querySelector('#alert-form').onsubmit=async(event)=>{
    event.preventDefault();const f=new FormData(event.currentTarget);
    try{await api('/alerts',{method:'POST',body:JSON.stringify({name:f.get('name'),frequency:f.get('frequency'),email_enabled:Boolean(f.get('email_enabled')),whatsapp_enabled:Boolean(f.get('whatsapp_enabled')),telegram_enabled:Boolean(f.get('telegram_enabled')),browser_push_enabled:Boolean(f.get('browser_push_enabled')),filters:{keyword:f.get('keyword'),country:f.get('country')}})});toast('Alert created');setTimeout(()=>location.reload(),400);}catch(error){toast(error.message,true);}
  };
  document.querySelectorAll('[data-delete-alert]').forEach((el)=>el.onclick=async()=>{await api(`/alerts/${el.dataset.deleteAlert}`,{method:'DELETE'});el.closest('.list-item').remove();toast('Alert deleted');});
}

async function renderWatchlists() {
  if (!(await requireLogin())) return; const {items}=await api('/watchlists');
  app.innerHTML=`<section class="page"><div class="section-heading"><div><p class="eyebrow">Organize opportunities</p><h1>Watchlists</h1></div></div>${dashboardNav()}<form id="watchlist-form" class="panel" style="margin-bottom:24px"><div class="field-row"><div class="field"><label>Name</label><input name="name" required></div><div class="field"><label>Description</label><input name="description"></div></div><button class="button button-gold">Create watchlist</button></form><div class="list">${items.map((item)=>`<div class="list-item"><div><h3>${escapeHtml(item.name)}</h3><p>${escapeHtml(item.description||'')} | ${item.contract_count} contracts</p></div></div>`).join('')||'<div class="empty">No watchlists yet.</div>'}</div></section>`;
  document.querySelector('#watchlist-form').onsubmit=async(event)=>{event.preventDefault();const values=Object.fromEntries(new FormData(event.currentTarget));await api('/watchlists',{method:'POST',body:JSON.stringify(values)});toast('Watchlist created');setTimeout(()=>location.reload(),350);};
}

function connectorCards(connectors = []) {
  return connectors.map((connector) => `<article class="connector-card">
    <div class="card-top"><strong>${escapeHtml(connector.name)}</strong><span class="status ${connector.statistics?.last_status === 'failed' ? 'expired' : ''}">${escapeHtml(statusText(connector.statistics?.last_status))}</span></div>
    <p>${escapeHtml(connector.documentation || 'Configurable procurement connector.')}</p>
    <dl class="mini-list">
      <div><dt>Key</dt><dd>${escapeHtml(connector.key)}</dd></div>
      <div><dt>Success</dt><dd>${connector.statistics?.success_count || 0}</dd></div>
      <div><dt>Imported</dt><dd>${connector.statistics?.total_imported || 0}</dd></div>
      <div><dt>Failures</dt><dd>${connector.statistics?.failure_count || 0}</dd></div>
    </dl>
  </article>`).join('');
}

function sourceRows(sources = []) {
  return sources.map((source)=>`<tr>
    <td><strong>${escapeHtml(source.name)}</strong><small>${escapeHtml(source.connector_key || source.parser_type || 'json')}</small></td>
    <td>${escapeHtml(source.country || '-')}</td>
    <td>${escapeHtml(source.region || '-')}</td>
    <td>${escapeHtml(source.schedule || 'daily')}</td>
    <td><span class="status ${source.last_status === 'failed' ? 'expired' : ''}">${escapeHtml(statusText(source.last_status))}</span></td>
    <td>${date(source.last_imported_at)}</td>
    <td>
      <div class="toolbar">
        <button class="button button-ghost" data-test-source="${source.id}">Test</button>
        <button class="button button-ghost" data-import-source="${source.id}">Import</button>
        <button class="button ${source.is_active ? 'button-danger' : 'button-outline'}" data-toggle-source="${source.id}" data-active="${source.is_active ? '1' : '0'}">${source.is_active ? 'Disable' : 'Enable'}</button>
      </div>
    </td>
  </tr>`).join('');
}

function keywordRows(keywords = []) {
  return keywords.map((keyword) => `<tr>
    <td><strong>${escapeHtml(keyword.keyword)}</strong></td>
    <td>${escapeHtml(keyword.service_category)}</td>
    <td>${escapeHtml(keyword.business_unit)}</td>
    <td>${keyword.weight}</td>
    <td>${boolText(keyword.is_active)}</td>
    <td><button class="button button-danger" data-delete-keyword="${keyword.id}">Delete</button></td>
  </tr>`).join('');
}

function botNotificationList(bot = {}) {
  return (bot.notifications || []).map((item) => `<div class="list-item">
    <div><h3>${escapeHtml(item.title)}</h3><p>${escapeHtml(item.message)}</p></div>
    <div class="toolbar"><a class="button button-ghost" href="/contract-finder/contracts/${item.slug || item.contract_id}">Open</a><button class="button button-ghost" data-read-notification="${item.id}">${item.is_read ? 'Read' : 'Mark read'}</button></div>
  </div>`).join('') || '<div class="empty">No bot notifications yet.</div>';
}

function matchDistribution(items = []) {
  return items.map((item) => `<div class="metric"><strong>${item.count}</strong><span>${escapeHtml(item.bucket)} AI matches</span></div>`).join('') || '<div class="empty">No AI match data yet.</div>';
}

async function renderAdmin() {
  if (!(await requireLogin())) return; if(currentUser.role!=='admin'){app.innerHTML='<section class="page"><div class="empty">Administrator access required.</div></section>';return;}
  const [analytics,sources,users,connectors,keywords]=await Promise.all([api('/admin/analytics'),api('/admin/sources'),api('/admin/users'),api('/admin/connectors'),api('/admin/bot/keywords')]);
  const bot = analytics.bot || {};
  app.innerHTML=`<section class="page">
    <div class="section-heading"><div><p class="eyebrow">Operations control</p><h1>Admin Panel</h1></div><div class="toolbar"><button class="button button-outline" id="snapshot">Save analytics</button><button class="button button-danger" id="dedupe">Remove duplicates</button></div></div>
    ${dashboardNav()}
    <div class="metric-grid">${['contracts','open_contracts','new_today','closing_soon','verified_contracts','users','premium_users','active_alerts','sources','countries','industries','import_success_rate'].map((key)=>`<div class="metric"><strong>${analytics[key] ?? 0}</strong><span>${key.replaceAll('_',' ')}</span></div>`).join('')}</div>
    <div class="panel" style="margin-bottom:20px">
      <div class="section-heading compact"><div><p class="eyebrow">Automation</p><h2>Scheduled Jobs</h2></div><p>Run imports, alerts, cleanup and analytics manually when needed.</p></div>
      <div class="toolbar"><button class="button button-gold" id="run-bot">Run AI Bot Now</button>${['hourly','daily','weekly','monthly'].map((job)=>`<button class="button button-ghost" data-run-job="${job}">Run ${job}</button>`).join('')}</div>
    </div>
    <div class="admin-grid" style="margin-bottom:20px">
      <div class="panel">
        <div class="section-heading compact"><div><p class="eyebrow">AI procurement bot</p><h2>Live Status</h2></div><p>${bot.latest_run ? `Last run: ${escapeHtml(bot.latest_run.status)} at ${date(bot.latest_run.started_at)}` : 'No bot run yet.'}</p></div>
        <div class="metric-grid compact-metrics">
          <div class="metric"><strong>${bot.keywords || 0}</strong><span>Active keywords</span></div>
          <div class="metric"><strong>${bot.unread_notifications || 0}</strong><span>Unread alerts</span></div>
          <div class="metric"><strong>${bot.latest_run?.sources_checked || 0}</strong><span>Sources checked</span></div>
          <div class="metric"><strong>${bot.latest_run?.high_value_matches || 0}</strong><span>High matches</span></div>
        </div>
        <h3>AI Match Distribution</h3>
        <div class="metric-grid compact-metrics">${matchDistribution(bot.ai_match_distribution)}</div>
      </div>
      <div class="panel">
        <h2>Dashboard Notifications</h2>
        <div class="list">${botNotificationList(bot)}</div>
      </div>
    </div>
    <div class="admin-grid">
      <form class="panel" id="source-form">
        <h2>Add Source</h2>
        <div class="field"><label>Name</label><input name="name" required></div>
        <div class="field"><label>Connector</label><select name="connector_key">${(sources.connectors || connectors.connectors || []).map((connector)=>option(connector.key,'',connector.name)).join('')}</select></div>
        <div class="field"><label>Source URL</label><input name="source_url" type="url" required></div>
        <div class="field"><label>API URL / Feed URL (optional)</label><input name="api_url" type="url"></div>
        <div class="field-row"><div class="field"><label>Country</label><input name="country"></div><div class="field"><label>Region</label><input name="region"></div></div>
        <div class="field-row"><div class="field"><label>Type</label><select name="source_type"><option value="government">Government</option><option value="private">Private</option></select></div><div class="field"><label>Schedule</label><select name="schedule"><option value="daily">Daily</option><option value="hourly">Hourly</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option></select></div></div>
        <button class="button button-gold">Add source</button>
      </form>
      <form class="panel" id="contract-form">
        <h2>Add Contract</h2>
        <div class="field"><label>Title</label><input name="title" required></div>
        <div class="field"><label>Description</label><textarea name="description" required></textarea></div>
        <div class="field-row"><div class="field"><label>Source name</label><input name="source_name" required></div><div class="field"><label>Source URL</label><input name="source_url" required></div></div>
        <div class="field-row"><div class="field"><label>Country</label><input name="country" required></div><div class="field"><label>Industry</label><input name="industry" required></div></div>
        <div class="field-row"><div class="field"><label>Buyer name</label><input name="buyer_name"></div><div class="field"><label>Region</label><input name="region"></div></div>
        <div class="field-row"><div class="field"><label>Contract type</label><input name="contract_type" required></div><div class="field"><label>Deadline</label><input name="deadline" type="date"></div></div>
        <button class="button button-gold">Add contract</button>
      </form>
    </div>
    <div class="panel" style="margin-top:20px">
      <div class="section-heading compact"><div><p class="eyebrow">Procurement portals</p><h2>Connector Status</h2></div><p>Named connectors are configurable. Add approved API/RSS/XML/CSV feeds in source settings.</p></div>
      <div class="connector-grid">${connectorCards(connectors.connectors)}</div>
    </div>
    <div class="panel" style="margin-top:20px">
      <div class="section-heading compact"><div><p class="eyebrow">AI matching</p><h2>Keyword Manager</h2></div><p>Add service keywords for rope access, painting, marine, shutdown, wind, NDT and other Skyproz services.</p></div>
      <form id="keyword-form" class="keyword-form">
        <div class="field"><label>Keyword</label><input name="keyword" required placeholder="Example: tank maintenance"></div>
        <div class="field"><label>Service category</label><input name="service_category" required placeholder="Tank Maintenance"></div>
        <div class="field"><label>Business unit</label><input name="business_unit" required placeholder="Industrial Services"></div>
        <div class="field"><label>Weight</label><input name="weight" type="number" min="1" max="25" value="8"></div>
        <button class="button button-gold">Add keyword</button>
      </form>
      <div class="table-wrap" style="margin-top:20px"><table><thead><tr><th>Keyword</th><th>Service</th><th>Business unit</th><th>Weight</th><th>Status</th><th></th></tr></thead><tbody>${keywordRows(keywords.items)}</tbody></table></div>
    </div>
    <div class="panel" style="margin-top:20px">
      <h2>Contract Sources</h2>
      <div class="table-wrap"><table><thead><tr><th>Name</th><th>Country</th><th>Region</th><th>Schedule</th><th>Status</th><th>Last import</th><th>Actions</th></tr></thead><tbody>${sourceRows(sources.items)}</tbody></table></div>
    </div>
    <div class="admin-grid" style="margin-top:20px">
      <div class="panel"><h2>Recent Imports</h2><div class="list">${(analytics.recent_imports || []).map((run)=>`<div class="list-item"><div><h3>${escapeHtml(run.connector_key || 'manual')}</h3><p>${escapeHtml(run.status)} | imported ${run.imported_count || 0}, updated ${run.updated_count || 0}, skipped ${run.skipped_count || 0}</p></div><span>${date(run.started_at)}</span></div>`).join('') || '<div class="empty">No import runs yet.</div>'}</div></div>
      <div class="panel"><h2>Newest AI Opportunities</h2><div class="list">${(analytics.newest_opportunities || []).map((item)=>`<a class="list-item" href="/contract-finder/contracts/${item.slug}"><div><h3>${escapeHtml(item.title)}</h3><p>${escapeHtml(item.country || 'Worldwide')} | Score ${item.ai_score || 0} | ${escapeHtml(item.ai_priority || 'Low')}</p></div><span>${date(item.created_at)}</span></a>`).join('') || '<div class="empty">No opportunities yet.</div>'}</div></div>
      <div class="panel"><h2>Subscribers</h2><div class="table-wrap"><table><thead><tr><th>Name</th><th>Email</th><th>Plan</th><th>Role</th><th>Status</th></tr></thead><tbody>${users.items.map((user)=>`<tr><td>${escapeHtml(user.display_name)}</td><td>${escapeHtml(user.email)}</td><td>${escapeHtml(user.plan)}</td><td>${escapeHtml(user.role)}</td><td>${boolText(user.is_active)}</td></tr>`).join('')}</tbody></table></div></div>
    </div>
  </section>`;
  document.querySelector('#dedupe').onclick=async()=>{const result=await api('/admin/contracts/deduplicate',{method:'POST',body:'{}'});toast(`${result.removed} duplicates removed`);};
  document.querySelector('#snapshot').onclick=async()=>{await api('/admin/analytics/snapshot',{method:'POST',body:'{}'});toast('Analytics snapshot saved');};
  document.querySelector('#run-bot').onclick=async()=>{try{const result=await api('/admin/bot/run',{method:'POST',body:JSON.stringify({schedule:'manual'})});toast(`AI bot done: ${result.high_value_matches} high matches`);setTimeout(()=>location.reload(),600);}catch(error){toast(error.message,true);}};
  document.querySelectorAll('[data-run-job]').forEach((el)=>el.onclick=async()=>{try{const result=await api(`/admin/jobs/${el.dataset.runJob}`,{method:'POST',body:'{}'});toast(`${result.job_type} job completed`);setTimeout(()=>location.reload(),500);}catch(error){toast(error.message,true);}});
  document.querySelectorAll('[data-read-notification]').forEach((el)=>el.onclick=async()=>{await api(`/admin/notifications/${el.dataset.readNotification}/read`,{method:'POST',body:'{}'});toast('Notification marked read');el.closest('.list-item').remove();});
  document.querySelectorAll('[data-delete-keyword]').forEach((el)=>el.onclick=async()=>{await api(`/admin/bot/keywords/${el.dataset.deleteKeyword}`,{method:'DELETE'});toast('Keyword deleted');el.closest('tr').remove();});
  document.querySelectorAll('[data-test-source]').forEach((el)=>el.onclick=async()=>{try{const result=await api(`/admin/sources/${el.dataset.testSource}/test`,{method:'POST',body:'{}'});toast(result.ok ? 'Connection test passed' : `Test failed: ${result.error || result.message || result.status}`);}catch(error){toast(error.message,true);}});
  document.querySelectorAll('[data-import-source]').forEach((el)=>el.onclick=async()=>{try{const result=await api(`/admin/sources/${el.dataset.importSource}/import`,{method:'POST',body:'{}'});toast(`Import done: ${result.imported} new, ${result.updated} updated`);setTimeout(()=>location.reload(),500);}catch(error){toast(error.message,true);}});
  document.querySelectorAll('[data-toggle-source]').forEach((el)=>el.onclick=async()=>{const active=el.dataset.active !== '1';await api(`/admin/sources/${el.dataset.toggleSource}`,{method:'PATCH',body:JSON.stringify({is_active:active})});toast(active?'Source enabled':'Source disabled');setTimeout(()=>location.reload(),350);});
  document.querySelector('#keyword-form').onsubmit=async(event)=>{event.preventDefault();const values=Object.fromEntries(new FormData(event.currentTarget));values.weight=Number(values.weight || 8);await api('/admin/bot/keywords',{method:'POST',body:JSON.stringify(values)});toast('Keyword added');setTimeout(()=>location.reload(),350);};
  document.querySelector('#source-form').onsubmit=async(event)=>{event.preventDefault();const values=Object.fromEntries(new FormData(event.currentTarget));values.parser_type='json';await api('/admin/sources',{method:'POST',body:JSON.stringify(values)});toast('Source added');setTimeout(()=>location.reload(),350);};
  document.querySelector('#contract-form').onsubmit=async(event)=>{event.preventDefault();const values=Object.fromEntries(new FormData(event.currentTarget));values.buyer_type='government';values.work_mode='onsite';values.posted_date=new Date().toISOString();await api('/admin/contracts',{method:'POST',body:JSON.stringify(values)});toast('Contract added');event.currentTarget.reset();};
}

function renderLogin() {
  app.innerHTML=`<section class="page-narrow"><div class="auth-card"><p class="eyebrow">Member access</p><h1 style="font-size:4rem">Contract Dashboard</h1><div class="auth-switch"><button class="button button-gold" data-mode="login">Sign in</button><button class="button button-ghost" data-mode="register">Create account</button></div><form id="auth-form"><input type="hidden" name="mode" value="login"><div class="field register-only" hidden><label>Name</label><input name="display_name"></div><div class="field"><label>Email</label><input name="email" type="email" required></div><div class="field register-only" hidden><label>Phone</label><input name="phone"></div><div class="field"><label>Password</label><input name="password" type="password" minlength="10" required></div><button class="button button-gold" type="submit">Continue</button><p class="error" id="auth-error"></p></form></div></section>`;
  document.querySelectorAll('[data-mode]').forEach((button)=>button.onclick=()=>{const mode=button.dataset.mode;document.querySelector('[name=mode]').value=mode;document.querySelectorAll('.register-only').forEach((el)=>el.hidden=mode!=='register');});
  document.querySelector('#auth-form').onsubmit=async(event)=>{event.preventDefault();const values=Object.fromEntries(new FormData(event.currentTarget));const mode=values.mode;delete values.mode;try{await api(`/auth/${mode}`,{method:'POST',body:JSON.stringify(values)});location.href='/contract-finder/dashboard';}catch(error){document.querySelector('#auth-error').textContent=error.message;}};
}

function renderNotFound(){app.innerHTML='<section class="page"><div class="empty"><h1>Page Not Found</h1><a class="button button-gold" href="/contract-finder/">Return home</a></div></section>';}

async function init() {
  try { currentUser=(await api('/auth/me')).user; } catch { currentUser=null; }
  document.querySelector('#account-nav').innerHTML=currentUser?`<a class="account-link" href="/contract-finder/dashboard"><span class="account-dot"></span>${escapeHtml(currentUser.display_name)}</a>`:`<a class="button button-ghost" href="/contract-finder/login">Sign in</a>`;
  const menu=document.querySelector('.menu-toggle');menu.onclick=()=>{const nav=document.querySelector('.nav-links');const open=nav.classList.toggle('open');menu.setAttribute('aria-expanded',String(open));};
  const routes={home:renderHome,search:renderSearch,contract:renderContract,dashboard:renderDashboard,favorites:renderFavorites,saved:renderSaved,alerts:renderAlerts,watchlists:renderWatchlists,admin:renderAdmin,login:renderLogin,'not-found':renderNotFound};
  try { await (routes[page]||renderNotFound)(); } catch(error){ console.error(error); app.innerHTML=`<section class="page"><div class="empty error"><h2>Unable to load this page</h2><p>${escapeHtml(error.message)}</p></div></section>`; }
}

init();
