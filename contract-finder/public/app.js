const API = '/api/contract-finder';
const app = document.querySelector('#app');
const page = app.dataset.page;
const identifier = app.dataset.identifier;
let currentUser = null;

const escapeHtml = (value) => String(value ?? '').replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]);
const money = (value, currency = '') => value === null || value === undefined || Number.isNaN(Number(value)) ? 'Not disclosed' : `${currency || ''} ${Number(value).toLocaleString()}`.trim();
const date = (value) => value ? new Intl.DateTimeFormat('en', { dateStyle: 'medium' }).format(new Date(value)) : 'Not stated';
const shortDate = (value) => value ? new Intl.DateTimeFormat('en', { month: 'short', day: '2-digit', year: '2-digit' }).format(new Date(value)) : '-';
const boolText = (value) => value ? 'Active' : 'Disabled';
const statusText = (value) => String(value || 'not tested').replaceAll('_', ' ');
const compactText = (value, length = 58) => String(value || '-').length > length ? `${String(value).slice(0, length - 1)}...` : String(value || '-');

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

const contractColumns = [
  ['select', '<input type="checkbox" data-select-all aria-label="Select all contracts">'],
  ['score', 'Match Score'],
  ['title', 'Title'],
  ['country', 'Country'],
  ['industry', 'Industry'],
  ['source', 'Source'],
  ['budget', 'Budget'],
  ['deadline', 'Deadline'],
  ['status', 'Status'],
  ['posted', 'Posted'],
  ['actions', 'Actions']
];

const privateOpportunityColumns = [
  ['score', 'Match Score'],
  ['company', 'Company'],
  ['opportunity', 'Opportunity'],
  ['service', 'Service'],
  ['industry', 'Industry'],
  ['country', 'Country'],
  ['state', 'State'],
  ['city', 'City'],
  ['deadline', 'Deadline'],
  ['status', 'Status'],
  ['source', 'Source'],
  ['updated', 'Last Updated'],
  ['actions', 'Actions']
];

function columnSelector(columns, key = 'contracts') {
  return `<details class="column-menu"><summary class="button button-ghost">Columns</summary><div class="column-menu-panel">${columns.filter(([id]) => id !== 'select' && id !== 'actions').map(([id, label]) => `<label><input type="checkbox" data-column-toggle="${escapeHtml(id)}" data-table-key="${escapeHtml(key)}" checked> ${escapeHtml(label)}</label>`).join('')}</div></details>`;
}

function contractTableRows(items = []) {
  return items.map((contract) => {
    const score = Number(contract.opportunity_score || contract.ai_score || 0);
    const sourceLabel = contract.configured_source_name || contract.source_name || 'Source';
    return `<tr tabindex="0" data-contract-id="${contract.id}" data-contract-slug="${escapeHtml(contract.slug)}" data-contract-link="${contract.id}">
      <td class="select-col" data-col="select"><input type="checkbox" data-row-select value="${contract.id}" aria-label="Select ${escapeHtml(contract.title)}"></td>
      <td class="score-cell sticky-score" data-col="score" data-sort-value="${score}"><span class="score-pill">${score}</span></td>
      <td class="title-cell" data-col="title" data-sort-value="${escapeHtml(contract.title)}"><a href="/contract-finder/contracts/${encodeURIComponent(contract.id)}">${escapeHtml(compactText(contract.title, 86))}</a><small>${escapeHtml(compactText(contract.buyer_name || contract.contract_type || '', 48))}</small></td>
      <td data-col="country" data-sort-value="${escapeHtml(contract.country || '')}">${escapeHtml(compactText(contract.country || 'Worldwide', 24))}</td>
      <td data-col="industry" data-sort-value="${escapeHtml(contract.industry || '')}">${escapeHtml(compactText(contract.industry || 'General', 28))}</td>
      <td data-col="source" data-sort-value="${escapeHtml(sourceLabel)}">${escapeHtml(compactText(sourceLabel, 28))}</td>
      <td data-col="budget" data-sort-value="${Number(contract.budget_value || 0)}">${money(contract.budget_value, contract.currency)}</td>
      <td data-col="deadline" data-sort-value="${escapeHtml(contract.deadline || '')}">${shortDate(contract.deadline)}</td>
      <td data-col="status" data-sort-value="${escapeHtml(contract.status || '')}"><span class="status ${escapeHtml(contract.status)}">${escapeHtml(statusText(contract.status))}</span></td>
      <td data-col="posted" data-sort-value="${escapeHtml(contract.posted_date || '')}">${shortDate(contract.posted_date)}</td>
      <td class="actions-cell" data-col="actions"><a class="button button-ghost" href="/contract-finder/contracts/${encodeURIComponent(contract.id)}">Open</a></td>
    </tr>`;
  }).join('');
}

function contractDataTable(items = []) {
  return `<div class="dense-table-wrap virtual-table" tabindex="0">
    <table class="dense-table contract-table">
      <thead><tr>${contractColumns.map(([id, label]) => `<th data-col="${escapeHtml(id)}" class="${id === 'score' ? 'sticky-score' : ''}" ${id !== 'select' && id !== 'actions' ? `data-sort-column="${escapeHtml(id)}"` : ''}>${label}</th>`).join('')}</tr></thead>
      <tbody>${contractTableRows(items) || '<tr><td colspan="11" class="empty-row">No contracts match these filters.</td></tr>'}</tbody>
    </table>
  </div>`;
}

function tableSortValue(row, column) {
  const cell = row.querySelector(`[data-col="${column}"]`);
  const value = cell?.dataset.sortValue ?? cell?.textContent ?? '';
  const numeric = Number(String(value).replace(/[^0-9.-]/g, ''));
  return Number.isFinite(numeric) && String(value).match(/\d/) ? numeric : String(value).toLowerCase();
}

function bindDenseTableControls(root = document) {
  root.querySelectorAll('[data-select-all]').forEach((checkbox) => {
    checkbox.onchange = () => {
      const table = checkbox.closest('table');
      table.querySelectorAll('[data-row-select]').forEach((item) => { item.checked = checkbox.checked; });
      updateBulkCount(root);
    };
  });
  root.querySelectorAll('[data-row-select]').forEach((checkbox) => checkbox.onchange = () => updateBulkCount(root));
  root.querySelectorAll('[data-sort-column]').forEach((header) => {
    header.onclick = () => {
      const table = header.closest('table');
      const column = header.dataset.sortColumn;
      const direction = header.dataset.direction === 'asc' ? 'desc' : 'asc';
      header.dataset.direction = direction;
      const rows = [...table.querySelectorAll('tbody tr')].filter((row) => row.querySelector('[data-col]'));
      rows.sort((a, b) => {
        const left = tableSortValue(a, column);
        const right = tableSortValue(b, column);
        const result = typeof left === 'number' && typeof right === 'number' ? left - right : String(left).localeCompare(String(right));
        return direction === 'asc' ? result : -result;
      });
      rows.forEach((row) => table.tBodies[0].append(row));
    };
  });
  root.querySelectorAll('[data-column-toggle]').forEach((checkbox) => {
    checkbox.onchange = () => {
      const shell = checkbox.closest('.dense-page, .panel, section') || root;
      shell.querySelectorAll(`[data-col="${checkbox.dataset.columnToggle}"]`).forEach((cell) => { cell.hidden = !checkbox.checked; });
    };
  });
  root.querySelectorAll('.dense-table tbody tr[data-contract-link]').forEach((row) => {
    row.onkeydown = (event) => {
      if (event.key === 'Enter') location.href = `/contract-finder/contracts/${encodeURIComponent(row.dataset.contractLink)}`;
      if (event.key === 'ArrowDown') { event.preventDefault(); row.nextElementSibling?.focus(); }
      if (event.key === 'ArrowUp') { event.preventDefault(); row.previousElementSibling?.focus(); }
    };
  });
}

function selectedContractIds(root = document) {
  return [...root.querySelectorAll('[data-row-select]:checked')].map((item) => item.value);
}

function updateBulkCount(root = document) {
  const counter = root.querySelector('[data-bulk-count]');
  if (counter) counter.textContent = `${selectedContractIds(root).length} selected`;
}

function savedViews() {
  try { return JSON.parse(localStorage.getItem('skyprozSavedContractViews') || '[]'); } catch { return []; }
}

function saveCurrentView(name, params) {
  const views = savedViews().filter((view) => view.name !== name);
  views.push({ name, query: String(params) });
  localStorage.setItem('skyprozSavedContractViews', JSON.stringify(views.slice(-12)));
}

function savedViewSelector() {
  const views = savedViews();
  return `<select id="saved-view"><option value="">Saved views</option>${views.map((view) => `<option value="${escapeHtml(view.query)}">${escapeHtml(view.name)}</option>`).join('')}</select>`;
}

function csvCell(value) {
  return `"${String(value ?? '').replaceAll('"', '""')}"`;
}

function downloadTextFile(filename, content, contentType) {
  const blob = new Blob([content], { type: contentType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function contractExportRows(items = []) {
  return items.map((contract) => ({
    score: contract.opportunity_score || contract.ai_score || 0,
    title: contract.title,
    buyer: contract.buyer_name || contract.buyer_type || '',
    country: contract.country || '',
    industry: contract.industry || '',
    source: contract.configured_source_name || contract.source_name || '',
    budget: contract.budget_value ?? '',
    currency: contract.currency || '',
    deadline: contract.deadline || '',
    status: contract.status || '',
    posted: contract.posted_date || '',
    original_tender: contract.source_url || ''
  }));
}

function exportContracts(items = [], format = 'csv') {
  const rows = contractExportRows(items);
  const headers = ['score', 'title', 'buyer', 'country', 'industry', 'source', 'budget', 'currency', 'deadline', 'status', 'posted', 'original_tender'];
  const stamp = new Date().toISOString().slice(0, 10);
  if (format === 'excel') {
    const html = `<table><thead><tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join('')}</tr></thead><tbody>${rows.map((row) => `<tr>${headers.map((header) => `<td>${escapeHtml(row[header])}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
    downloadTextFile(`skyproz-contracts-${stamp}.xls`, html, 'application/vnd.ms-excel;charset=utf-8');
    return;
  }
  const csv = [headers.map(csvCell).join(','), ...rows.map((row) => headers.map((header) => csvCell(row[header])).join(','))].join('\n');
  downloadTextFile(`skyproz-contracts-${stamp}.csv`, csv, 'text/csv;charset=utf-8');
}

function pageQuery(targetPage) {
  const params = new URLSearchParams(location.search);
  params.set('page', targetPage);
  return params;
}

function bindServerSort(root, basePath) {
  root.querySelectorAll('[data-sort-column]').forEach((header) => {
    header.onclick = (event) => {
      const column = header.dataset.sortColumn;
      const params = new URLSearchParams(location.search);
      const parts = String(params.get('sort') || '').split(',').map((part) => part.trim()).filter(Boolean);
      const existing = parts.map((part) => part.split(':')).find(([key]) => key === column);
      const nextDirection = existing?.[1] === 'asc' ? 'desc' : 'asc';
      const nextPart = `${column}:${nextDirection}`;
      const nextParts = event.shiftKey ? [nextPart, ...parts.filter((part) => !part.startsWith(`${column}:`))].slice(0, 4) : [nextPart];
      params.set('sort', nextParts.join(','));
      params.set('page', '1');
      location.href = `${basePath}?${params}`;
    };
  });
}

function dashboardNav() {
  return `<nav class="dashboard-nav" aria-label="Contract Finder dashboard">
    ${button('Overview','/contract-finder/dashboard','button-ghost')}
    ${currentUser?.role === 'admin' ? button('Government Contracts','/contract-finder/admin','button-ghost') + button('Lead Finder','/contract-finder/admin/lead-finder','button-ghost') : ''}
    ${button('Contracts','/contract-finder/contracts','button-ghost')}
    ${button('Favorites','/contract-finder/favorites','button-ghost')}
    ${button('Saved Searches','/contract-finder/saved-searches','button-ghost')}
    ${button('Alerts','/contract-finder/alerts','button-ghost')}
    ${button('Watchlists','/contract-finder/watchlists','button-ghost')}
    ${currentUser?.role === 'admin' ? button('Connectors','/contract-finder/admin/connectors','button-ghost') + button('Wizard','/contract-finder/admin/connector-wizard','button-ghost') + button('Discovery','/contract-finder/admin/source-discovery','button-ghost') + button('Marketplace','/contract-finder/admin/marketplace','button-ghost') : ''}
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
    <div class="field"><label>Status</label><select name="status"><option value="">All</option>${selectOptions(options.statuses || [], params.get('status'))}</select></div>
    <div class="field"><label>Government or Private</label><select name="buyer_type"><option value="">Government & private</option>${option('government', params.get('buyer_type'), 'Government')}${option('private', params.get('buyer_type'), 'Private')}</select></div>
    <div class="field"><label>Remote or Onsite</label><select name="work_mode"><option value="">Remote & onsite</option>${option('remote', params.get('work_mode'), 'Remote')}${option('onsite', params.get('work_mode'), 'Onsite')}${option('hybrid', params.get('work_mode'), 'Hybrid')}</select></div>
    <div class="field"><label>Minimum score</label><input type="number" name="min_score" min="0" max="100" value="${escapeHtml(params.get('min_score') || '')}" placeholder="0 - 100"></div>
    <div class="field"><label>Sort</label><select name="sort">${option('newest', params.get('sort') || 'newest', 'Newest')}${option('deadline', params.get('sort'), 'Deadline')}${option('budget_high', params.get('sort'), 'Budget high')}${option('budget_low', params.get('sort'), 'Budget low')}${option('score:desc', params.get('sort'), 'AI score high')}${option('title:asc', params.get('sort'), 'Title A-Z')}${option('posted:desc', params.get('sort'), 'Posted newest')}</select></div>
    <button class="button button-gold" type="submit">Apply filters</button>
  </form>`;
}

async function renderSearch() {
  const params = new URLSearchParams(location.search);
  if (!params.get('page_size')) params.set('page_size','50');
  const [results, options] = await Promise.all([api(`/contracts?${params}`), api('/filter-options')]);
  const quickChips = [
    ['Rope access', 'keyword', 'rope access'],
    ['Marine', 'industry', 'Marine'],
    ['India', 'country', 'India'],
    ['High score', 'min_score', '75'],
    ['Deadline first', 'sort', 'deadline']
  ];
  app.innerHTML = `<section class="page dense-page">
    <div class="section-heading dense-heading"><div><p class="eyebrow">Contract database</p><h1>Search Opportunities</h1></div><p>Dense table view with server-side pagination, quick filters, saved views and keyboard navigation.</p></div>
    <div class="dense-toolbar sticky-toolbar">
      <form id="quick-search" class="dense-search"><input name="keyword" value="${escapeHtml(params.get('keyword') || '')}" placeholder="Search contracts, buyers, services..."><button class="button button-gold">Search</button></form>
      <div class="toolbar">
        <span class="chip">${results.pagination.total} contracts</span>
        <label class="compact-select">Rows <select id="page-size">${[25,50,100].map((size)=>option(String(size), params.get('page_size'), String(size))).join('')}</select></label>
        ${savedViewSelector()}
        <button class="button button-ghost" id="save-view" type="button">Save view</button>
        <button class="button button-ghost" id="save-search" type="button">Save search</button>
        ${columnSelector(contractColumns)}
      </div>
      <div class="chip-row quick-filters">${quickChips.map(([label, key, value]) => {
        const q = new URLSearchParams(params); q.set(key, value); q.set('page', '1');
        return `<a class="chip ${params.get(key) === value ? 'chip-gold' : ''}" href="/contract-finder/search?${q}">${escapeHtml(label)}</a>`;
      }).join('')}</div>
    </div>
    <details class="filter-drawer">
      <summary class="button button-outline">Advanced filters</summary>
      ${filterForm(options, params)}
    </details>
    <div class="bulk-toolbar sticky-filters">
      <span data-bulk-count>0 selected</span>
      <button class="button button-ghost" id="bulk-open" type="button">Open first</button>
      <button class="button button-ghost" id="bulk-save" type="button">Save selected</button>
      <label class="compact-check"><input type="checkbox" id="infinite-mode" ${params.get('page_size') === '100' ? 'checked' : ''}> Infinite-style 100 rows</label>
    </div>
    ${contractDataTable(results.items)}
    <div class="pagination sticky-pagination"><button class="button button-ghost" id="prev" ${results.pagination.page <= 1 ? 'disabled' : ''}>Previous</button><span class="button button-ghost">Page ${results.pagination.page} of ${results.pagination.pages}</span><button class="button button-ghost" id="next" ${results.pagination.page >= results.pagination.pages ? 'disabled' : ''}>Next</button></div>
  </section>`;
  bindDenseTableControls(app);
  document.querySelector('#quick-search').addEventListener('submit',(event) => { event.preventDefault(); const q = new URLSearchParams(location.search); q.set('keyword', new FormData(event.currentTarget).get('keyword') || ''); q.set('page','1'); location.search = q; });
  document.querySelector('#filters').addEventListener('submit',(event) => { event.preventDefault(); const q = new URLSearchParams(new FormData(event.currentTarget)); q.set('page_size', params.get('page_size') || '50'); location.search = q; });
  document.querySelector('#page-size').onchange = (event) => { const q = new URLSearchParams(location.search); q.set('page_size', event.target.value); q.set('page','1'); location.search = q; };
  document.querySelector('#infinite-mode').onchange = (event) => { const q = new URLSearchParams(location.search); q.set('page_size', event.target.checked ? '100' : '50'); q.set('page','1'); location.search = q; };
  document.querySelector('#saved-view').onchange = (event) => { if (event.target.value) location.href = `/contract-finder/search?${event.target.value}`; };
  document.querySelector('#save-view').onclick = () => { const name = prompt('Name this dense view'); if (!name) return; saveCurrentView(name, params); toast('View saved on this browser'); };
  document.querySelector('#prev').onclick = () => setPage(results.pagination.page - 1);
  document.querySelector('#next').onclick = () => setPage(results.pagination.page + 1);
  document.querySelector('#bulk-open').onclick = () => {
    const first = document.querySelector('[data-row-select]:checked')?.closest('tr')?.dataset.contractSlug;
    if (first) location.href = `/contract-finder/contracts/${encodeURIComponent(first)}`; else toast('Select at least one contract', true);
  };
  document.querySelector('#bulk-save').onclick = async () => {
    if (!currentUser) return location.href='/contract-finder/login';
    const ids = selectedContractIds(app);
    if (!ids.length) return toast('Select contracts first', true);
    try {
      for (const id of ids) await api(`/contracts/${id}/favorite`,{method:'POST',body:'{}'});
      toast(`${ids.length} contract(s) saved`);
    } catch(error) { toast(error.message,true); }
  };
  document.querySelector('#save-search').onclick = async () => {
    if (!currentUser) return location.href='/contract-finder/login';
    const name = prompt('Name this saved search'); if (!name) return;
    try { await api('/saved-searches',{method:'POST',body:JSON.stringify({name,filters:Object.fromEntries(params)})}); toast('Search saved'); } catch(error) { toast(error.message,true); }
  };
}

async function renderContracts() {
  const params = new URLSearchParams(location.search);
  if (!params.get('page_size')) params.set('page_size','100');
  const basePath = '/contract-finder/contracts';
  const apiParams = new URLSearchParams(params);
  apiParams.set('view', 'contracts');
  const [results, options] = await Promise.all([api(`/contracts?${apiParams}`), api('/filter-options')]);
  const quickChips = [
    ['Rope access', 'keyword', 'rope access'],
    ['High score', 'min_score', '80'],
    ['Open only', 'status', 'open'],
    ['Deadline first', 'sort', 'deadline:asc'],
    ['Highest budget', 'sort', 'budget:desc']
  ];
  app.innerHTML = `<section class="page dense-page contracts-only-page">
    <div class="section-heading dense-heading">
      <div><p class="eyebrow">Contracts database</p><h1>Contracts</h1></div>
      <p>Contracts-only workspace optimized for large datasets with server-side filtering, 100-row pages, sticky controls and compact rows.</p>
    </div>
    <div class="dense-toolbar sticky-toolbar">
      <form id="quick-search" class="dense-search"><input name="keyword" value="${escapeHtml(params.get('keyword') || '')}" placeholder="Search all contracts, buyers, sources..."><button class="button button-gold">Search</button></form>
      <div class="toolbar">
        <span class="chip">${results.pagination.total} total contracts</span>
        <label class="compact-select">Rows <select id="page-size">${[25,50,100].map((size)=>option(String(size), params.get('page_size'), String(size))).join('')}</select></label>
        ${savedViewSelector()}
        <button class="button button-ghost" id="save-view" type="button">Save filter</button>
        <button class="button button-ghost" id="export-csv" type="button">Export CSV</button>
        <button class="button button-ghost" id="export-excel" type="button">Export Excel</button>
        ${columnSelector(contractColumns, 'contracts-page')}
      </div>
      <div class="chip-row quick-filters">${quickChips.map(([label, key, value]) => {
        const query = new URLSearchParams(params); query.set(key, value); query.set('page', '1');
        return `<a class="chip ${params.get(key) === value ? 'chip-gold' : ''}" href="${basePath}?${query}">${escapeHtml(label)}</a>`;
      }).join('')}</div>
    </div>
    <details class="filter-drawer">
      <summary class="button button-outline">Advanced filters</summary>
      ${filterForm(options, params)}
    </details>
    <div class="bulk-toolbar sticky-filters">
      <span data-bulk-count>0 selected</span>
      <div class="toolbar">
        <button class="button button-ghost" id="bulk-open" type="button">Open first</button>
        <button class="button button-ghost" id="bulk-save" type="button">Save selected</button>
        <span class="chip">Server sorted: ${escapeHtml(params.get('sort') || 'newest')}</span>
      </div>
    </div>
    ${contractDataTable(results.items)}
    <div class="pagination sticky-pagination">
      <button class="button button-ghost" id="prev" ${results.pagination.page <= 1 ? 'disabled' : ''}>Previous</button>
      <span class="button button-ghost">Page ${results.pagination.page} of ${results.pagination.pages}</span>
      <button class="button button-ghost" id="next" ${results.pagination.page >= results.pagination.pages ? 'disabled' : ''}>Next</button>
    </div>
  </section>`;
  bindDenseTableControls(app);
  bindServerSort(app, basePath);
  document.querySelector('#quick-search').addEventListener('submit',(event) => {
    event.preventDefault();
    const query = new URLSearchParams(location.search);
    query.set('keyword', new FormData(event.currentTarget).get('keyword') || '');
    query.set('page','1');
    location.href = `${basePath}?${query}`;
  });
  document.querySelector('#filters').addEventListener('submit',(event) => {
    event.preventDefault();
    const query = new URLSearchParams(new FormData(event.currentTarget));
    query.set('page_size', params.get('page_size') || '100');
    query.set('page','1');
    location.href = `${basePath}?${query}`;
  });
  document.querySelector('#page-size').onchange = (event) => {
    const query = pageQuery('1');
    query.set('page_size', event.target.value);
    location.href = `${basePath}?${query}`;
  };
  document.querySelector('#saved-view').onchange = (event) => { if (event.target.value) location.href = `${basePath}?${event.target.value}`; };
  document.querySelector('#save-view').onclick = () => { const name = prompt('Name this contract filter'); if (!name) return; saveCurrentView(name, params); toast('Filter saved on this browser'); };
  document.querySelector('#export-csv').onclick = () => exportContracts(results.items, 'csv');
  document.querySelector('#export-excel').onclick = () => exportContracts(results.items, 'excel');
  document.querySelector('#prev').onclick = () => { location.href = `${basePath}?${pageQuery(results.pagination.page - 1)}`; };
  document.querySelector('#next').onclick = () => { location.href = `${basePath}?${pageQuery(results.pagination.page + 1)}`; };
  document.querySelector('#bulk-open').onclick = () => {
    const first = document.querySelector('[data-row-select]:checked')?.closest('tr')?.dataset.contractLink;
    if (first) location.href = `${basePath}/${encodeURIComponent(first)}`; else toast('Select at least one contract', true);
  };
  document.querySelector('#bulk-save').onclick = async () => {
    if (!currentUser) return location.href='/contract-finder/login';
    const ids = selectedContractIds(app);
    if (!ids.length) return toast('Select contracts first', true);
    try {
      for (const id of ids) await api(`/contracts/${id}/favorite`,{method:'POST',body:'{}'});
      toast(`${ids.length} contract(s) saved`);
    } catch(error) { toast(error.message,true); }
  };
}

function setPage(value) { const params = new URLSearchParams(location.search); params.set('page',value); location.search=params; }

function listFromValue(value) {
  if (Array.isArray(value)) return value.map((item) => String(item || '').trim()).filter(Boolean);
  if (value && typeof value === 'object') return Object.entries(value).map(([key, item]) => `${key}: ${item}`).filter(Boolean);
  if (typeof value === 'string') return value.split(/\n|;|\|/).map((item) => item.trim()).filter(Boolean);
  return [];
}

function firstList(values = []) {
  for (const value of values) {
    const list = listFromValue(value);
    if (list.length) return list;
  }
  return [];
}

function listPanel(title, items, fallback = 'Not stated in imported notice. Verify the original tender.') {
  const list = items.length ? items : [fallback];
  return `<section class="info-panel contract-intel-card">
    <h3>${escapeHtml(title)}</h3>
    <ul class="mini-checklist">${list.slice(0, 10).map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>
  </section>`;
}

function contractRiskItems(contract) {
  const items = [];
  if (contract.country_risk) items.push(`Country risk: ${contract.country_risk}`);
  if (contract.submission_urgency) items.push(`Submission urgency: ${contract.submission_urgency}`);
  if (contract.recommended_action) items.push(`Recommended action: ${contract.recommended_action}`);
  if (contract.deadline) items.push(`Deadline: ${date(contract.deadline)}`);
  if (contract.budget_value) items.push(`Budget visibility: ${money(contract.budget_value, contract.currency)}`);
  return items;
}

async function renderContract() {
  const { contract } = await api(`/contracts/${encodeURIComponent(identifier)}`);
  const tags = contract.tags.map((tag) => `<span class="chip">${escapeHtml(tag)}</span>`).join('');
  const score = Number(contract.opportunity_score || 0);
  const metadata = contract.metadata || {};
  const sourceName = contract.configured_source_name || contract.source_name || 'Source';
  const aiSummary = contract.ai_summary || metadata.ai_summary || metadata.summary || contract.translated_description || '';
  const requiredDocuments = firstList([metadata.required_documents, metadata.document_checklist, metadata.documents]);
  const requiredCertifications = firstList([metadata.required_certifications, metadata.certifications, metadata.compliance_certifications]);
  const submissionChecklist = firstList([contract.ai_checklist, metadata.submission_checklist, metadata.checklist]);
  const sourceButton = contract.source_url
    ? `<a class="button button-gold" href="${escapeHtml(contract.source_url)}" target="_blank" rel="noopener noreferrer">Open Original Tender</a>`
    : '<button class="button button-gold" type="button" disabled>Original Tender Unavailable</button>';
  app.innerHTML = `<section class="page detail-hero">
    <p class="eyebrow">${escapeHtml(sourceName)}</p>
    <h1>${escapeHtml(contract.title)}</h1>
    <div class="chip-row"><span class="status ${escapeHtml(contract.status)}">${escapeHtml(statusText(contract.status))}</span>${contract.verified?'<span class="verified">Verified</span>':''}<span class="chip">${escapeHtml(contract.country)}</span><span class="chip">${escapeHtml(contract.industry)}</span>${contract.ai_category ? `<span class="chip chip-gold">${escapeHtml(contract.ai_category)}</span>` : ''}${tags}</div>
  </section>
  <section class="page detail-grid">
    <div>
      <h2>Contract Overview</h2>
      <div class="prose">${escapeHtml(contract.description)}</div>
      <div class="contract-intel-grid">
        <section class="info-panel contract-intel-card ai-summary-card">
          <h3>AI Summary</h3>
          <p>${escapeHtml(aiSummary || 'AI summary is not available yet. Use the assistant below to generate one after login.')}</p>
        </section>
        ${listPanel('Required Documents', requiredDocuments)}
        ${listPanel('Required Certifications', requiredCertifications)}
        ${listPanel('Risk Analysis', contractRiskItems(contract))}
        ${listPanel('Submission Checklist', submissionChecklist)}
      </div>
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
          <div><dt>Source</dt><dd>${escapeHtml(sourceName)}</dd></div>
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

function connectorCards(connectors = [], sources = []) {
  return connectors.map((connector) => {
    const source = sources.find((item) => (item.connector_key || item.parser_type) === connector.key);
    const stats = connector.statistics || {};
    const failures = Number(stats.failure_count || source?.failure_count || 0);
    const success = Number(stats.success_count || 0);
    const imported = Number(stats.total_imported || source?.contracts_imported || 0);
    const health = source?.health_score ?? (success + failures ? Math.round((success / Math.max(1, success + failures)) * 100) : 0);
    return `<article class="connector-card compact-connector">
      <div class="connector-card-top"><span class="status ${failures ? 'expired' : ''}">${escapeHtml(statusText(stats.last_status || source?.last_status || 'not tested'))}</span><strong>${escapeHtml(compactText(connector.name, 28))}</strong></div>
      <div class="connector-meta"><span>${escapeHtml(source?.region || connector.category || 'Global')}</span><span>Health ${health}%</span></div>
      <dl class="connector-metrics">
        <div><dt>Success</dt><dd>${success}</dd></div>
        <div><dt>Imported</dt><dd>${imported}</dd></div>
        <div><dt>Fail</dt><dd>${failures}</dd></div>
        <div><dt>Sync</dt><dd>${shortDate(source?.last_success_at || stats.last_imported_at)}</dd></div>
      </dl>
      <div class="connector-actions">
        <button class="button button-ghost" ${source?.id ? `data-test-source="${source.id}"` : 'disabled'}>Test</button>
        <button class="button button-ghost" ${source?.id ? `data-import-source="${source.id}"` : 'disabled'}>Import</button>
        <a class="button button-ghost" href="/contract-finder/admin/connector-wizard${source?.id ? `?connector=source:${source.id}` : ''}">Configure</a>
      </div>
    </article>`;
  }).join('');
}

function sourceRows(sources = []) {
  return sources.map((source)=>`<tr>
    <td><strong>${escapeHtml(compactText(source.name, 42))}</strong><small>${escapeHtml(source.connector_key || source.parser_type || 'json')}</small></td>
    <td>${escapeHtml(source.source_type || source.source_format || 'json')}</td>
    <td>${escapeHtml(source.country || '-')}</td>
    <td><span class="status ${source.last_status === 'failed' ? 'expired' : ''}">${escapeHtml(statusText(source.last_status))}</span></td>
    <td>${source.api_url ? 'Yes' : 'No'}</td>
    <td>${['rss','xml','json','csv'].includes(source.source_format) ? escapeHtml(source.source_format.toUpperCase()) : '-'}</td>
    <td>${source.api_key_env ? 'Key' : 'None'}</td>
    <td>${shortDate(source.last_success_at || source.last_imported_at || source.last_run_at)}</td>
    <td>${source.contracts_imported || 0}<small>dup ${source.duplicates_skipped || 0}</small></td>
    <td>
      <div class="toolbar">
        <button class="button button-ghost" data-test-source="${source.id}">Test</button>
        <button class="button button-ghost" data-import-source="${source.id}">Import</button>
        <button class="button button-ghost" data-log-source="${source.id}">Logs</button>
        <a class="button button-ghost" href="/contract-finder/admin/connector-wizard?connector=source:${source.id}">Config</a>
        <button class="button ${source.is_active ? 'button-danger' : 'button-outline'}" data-toggle-source="${source.id}" data-active="${source.is_active ? '1' : '0'}">${source.is_active ? 'Disable' : 'Enable'}</button>
      </div>
    </td>
  </tr>`).join('');
}

function parseSourceJson(value, fallback = []) {
  try { return JSON.parse(value || JSON.stringify(fallback)); } catch { return fallback; }
}

function connectorManagerWidgets(summary = {}) {
  const widgets = [
    ['Total connectors', summary.total_connectors || 0],
    ['Enabled connectors', summary.enabled_connectors || 0],
    ['Healthy connectors', summary.healthy_connectors || 0],
    ['Failed connectors', summary.failed_connectors || 0],
    ['Imported today', summary.contracts_imported_today || 0],
    ['Avg import duration', `${summary.average_import_duration || 0} ms`]
  ];
  return widgets.map(([label, value]) => `<div class="metric"><strong>${escapeHtml(value)}</strong><span>${escapeHtml(label)}</span></div>`).join('');
}

function samplePreview(source = {}) {
  const samples = parseSourceJson(source.sample_contracts_json, []);
  return samples.map((item) => `<div class="list-item compact-list-item">
    <div><h3>${escapeHtml(item.title || 'Untitled sample')}</h3><p>${escapeHtml(item.country || 'Worldwide')} | ${escapeHtml(item.industry || 'General')} | ${item.valid ? 'Valid' : 'Needs mapping'}</p></div>
    ${item.source_url ? `<a class="button button-ghost" href="${escapeHtml(item.source_url)}" target="_blank" rel="noopener noreferrer">Open</a>` : ''}
  </div>`).join('') || '<div class="empty">Run Test Connection to preview sample contracts.</div>';
}

function connectorLogRows(logs = []) {
  return logs.map((log) => `<div class="list-item compact-list-item">
    <div><h3>${escapeHtml(log.action)} - ${escapeHtml(log.level)}</h3><p>${escapeHtml(log.message)}</p></div>
    <span>${date(log.created_at)}</span>
  </div>`).join('') || '<div class="empty">No connector logs yet.</div>';
}

function expansionTemplateRows(templates = []) {
  return templates.map((template) => `<tr>
    <td><strong>${escapeHtml(template.name)}</strong><small>${escapeHtml(template.id)}</small></td>
    <td>${escapeHtml(template.group)}</td>
    <td>${escapeHtml(template.region || 'Global')}</td>
    <td>${escapeHtml(template.connector_key || 'json')}</td>
    <td><span class="status">${escapeHtml(statusText(template.health_status))}</span></td>
    <td>${escapeHtml(template.failure_reason || 'Configure official source before testing.')}</td>
    <td>${escapeHtml((template.recommended_keywords || []).slice(0, 4).join(', '))}</td>
  </tr>`).join('');
}

async function renderConnectorManager() {
  if (!(await requireLogin())) return; if(currentUser.role!=='admin'){app.innerHTML='<section class="page"><div class="empty">Administrator access required.</div></section>';return;}
  const data = await api('/admin/connectors');
  app.innerHTML = `<section class="page">
    <div class="section-heading"><div><p class="eyebrow">Procurement automation</p><h1>Auto Connector Manager</h1></div><div class="toolbar"><a class="button button-outline" href="/contract-finder/admin">Back to Admin</a><button class="button button-gold" id="refresh-connectors">Refresh</button></div></div>
    ${dashboardNav()}
    <div class="metric-grid">${connectorManagerWidgets(data.summary)}</div>
    <div class="admin-grid">
      <form class="panel" id="connector-source-form">
        <h2>Source Configuration</h2>
        <div class="field"><label>Name</label><input name="name" required placeholder="Example: TED rope access feed"></div>
        <div class="field-row"><div class="field"><label>Connector</label><select name="connector_key">${data.connectors.map((connector)=>option(connector.key,'',connector.name)).join('')}</select></div><div class="field"><label>Format</label><select name="source_format">${['REST API','RSS','XML','JSON','CSV'].map((format)=>option(format.toLowerCase().replace(' api',''),'',format)).join('')}</select></div></div>
        <div class="field"><label>Source URL</label><input name="source_url" type="url" required placeholder="Official procurement page"></div>
        <div class="field"><label>Base/API/Feed URL</label><input name="api_url" type="url" placeholder="Official REST, RSS, XML, JSON or CSV endpoint"></div>
        <div class="field-row"><div class="field"><label>Country</label><input name="country"></div><div class="field"><label>Region</label><input name="region"></div></div>
        <div class="field-row"><div class="field"><label>Type</label><select name="source_type"><option value="government">Government</option><option value="private">Private</option></select></div><div class="field"><label>Schedule</label><select name="schedule">${['hourly','daily','weekly','monthly'].map((item)=>option(item,item === 'daily')).join('')}</select></div></div>
        <div class="field-row"><div class="field"><label>API key env name</label><input name="api_key_env" placeholder="SAM_API_KEY"></div><div class="field"><label>Rate limit ms</label><input name="rate_limit_ms" type="number" min="0" value="0"></div></div>
        <div class="field-row"><div class="field"><label>Initial Import Limit</label><input name="initial_import_limit" type="number" min="1" max="1000" value="500"></div><div class="field"><label>Daily Import Limit</label><input name="daily_import_limit" type="number" min="1" max="1000" value="50"></div></div>
        <div class="field"><label>Headers JSON</label><textarea name="headers" placeholder='{"accept":"application/json"}'>{}</textarea></div>
        <div class="field"><label>Authentication JSON</label><textarea name="auth_config" placeholder='{"api_key_env":"SAM_API_KEY","api_key_header":"x-api-key"}'>{}</textarea></div>
        <div class="field"><label>Pagination JSON</label><textarea name="pagination_config" placeholder='{"limit_param":"limit","page_param":"page"}'>{}</textarea></div>
        <div class="field"><label>Parser Mapping JSON</label><textarea name="parser_config" placeholder='{"items_path":"items","parser_type":"json","field_map":{"title":"title","description":"description","source_url":"url"}}'>{"parser_type":"json","field_map":{"external_id":"id","title":"title","description":"description","source_url":"url","country":"country","industry":"industry","contract_type":"contract_type","deadline":"deadline","posted_date":"posted_date","buyer_name":"buyer_name","tags":"tags"}}</textarea></div>
        <button class="button button-gold">Save Source</button>
      </form>
      <div class="panel">
        <h2>Connector Health</h2>
        <div class="connector-grid dense-connector-grid">${connectorCards(data.connectors, data.sources)}</div>
      </div>
    </div>
    <div class="panel" style="margin-top:20px">
      <div class="section-heading compact"><div><p class="eyebrow">Expansion pack</p><h2>Requires Configuration Templates</h2></div><p>These provider templates are not active connectors. Add only official APIs, public feeds or permitted procurement endpoints before testing or importing.</p></div>
      <div class="table-wrap"><table><thead><tr><th>Provider</th><th>Group</th><th>Region</th><th>Connector</th><th>Status</th><th>Requirement</th><th>AI keywords</th></tr></thead><tbody>${expansionTemplateRows(data.templates || [])}</tbody></table></div>
    </div>
    <div class="panel" style="margin-top:20px">
      <div class="section-heading compact"><div><p class="eyebrow">Configured sources</p><h2>Live Connectors & Templates</h2></div><p>Enable only official public APIs or permitted feeds. Restricted portals can remain disabled as configuration templates.</p></div>
      <div class="table-wrap dense-table-wrap"><table class="dense-table"><thead><tr><th>Source</th><th>Type</th><th>Country</th><th>Status</th><th>API</th><th>Feed</th><th>Auth</th><th>Last Sync</th><th>Contracts</th><th>Actions</th></tr></thead><tbody>${sourceRows(data.sources)}</tbody></table></div>
    </div>
    <div class="admin-grid" style="margin-top:20px">
      <div class="panel"><h2>Sample Contracts</h2><div id="sample-preview">${samplePreview(data.sources.find((source)=>source.sample_contracts_json && source.sample_contracts_json !== '[]'))}</div></div>
      <div class="panel"><h2>Execution Logs</h2><div id="connector-logs">${connectorLogRows(data.logs)}</div></div>
    </div>
  </section>`;
  document.querySelector('#refresh-connectors').onclick=()=>location.reload();
  document.querySelector('#connector-source-form').onsubmit=async(event)=>{
    event.preventDefault();
    const values=Object.fromEntries(new FormData(event.currentTarget));
    try {
      values.parser_config=JSON.parse(values.parser_config || '{}');
      values.headers=JSON.parse(values.headers || '{}');
      values.auth_config=JSON.parse(values.auth_config || '{}');
      values.pagination_config=JSON.parse(values.pagination_config || '{}');
      values.rate_limit_ms=Number(values.rate_limit_ms || 0);
      values.initial_import_limit=Number(values.initial_import_limit || 500);
      values.daily_import_limit=Number(values.daily_import_limit || 50);
      values.parser_config.parser_type = values.parser_config.parser_type || values.source_format || 'json';
      await api('/admin/sources',{method:'POST',body:JSON.stringify(values)});
      toast('Connector source saved'); setTimeout(()=>location.reload(),450);
    } catch(error) { toast(`Configuration error: ${error.message}`, true); }
  };
  document.querySelectorAll('[data-test-source]').forEach((el)=>el.onclick=async()=>{
    try {
      const result=await api(`/admin/sources/${el.dataset.testSource}/test`,{method:'POST',body:'{}'});
      document.querySelector('#sample-preview').innerHTML = samplePreview({ sample_contracts_json: JSON.stringify(result.sample_contracts || []) });
      toast(result.ok ? 'Connection test passed' : `Test failed: ${result.error || result.message || result.status}`);
    } catch(error) { toast(error.message,true); }
  });
  document.querySelectorAll('[data-import-source]').forEach((el)=>el.onclick=async()=>{
    try { const result=await api(`/admin/sources/${el.dataset.importSource}/import`,{method:'POST',body:'{}'}); toast(`Import done: ${result.imported} new, ${result.updated} updated`); setTimeout(()=>location.reload(),600); }
    catch(error) { toast(error.message,true); }
  });
  document.querySelectorAll('[data-toggle-source]').forEach((el)=>el.onclick=async()=>{const active=el.dataset.active !== '1';await api(`/admin/sources/${el.dataset.toggleSource}`,{method:'PATCH',body:JSON.stringify({is_active:active})});toast(active?'Source enabled':'Source disabled');setTimeout(()=>location.reload(),350);});
  document.querySelectorAll('[data-log-source]').forEach((el)=>el.onclick=async()=>{const logs=await api(`/admin/sources/${el.dataset.logSource}/logs`);document.querySelector('#connector-logs').innerHTML=connectorLogRows(logs.items);});
}

function scoreStars(score = 0) {
  const value = Math.max(0, Math.min(5, Math.round(Number(score || 0) / 20)));
  return `${'*'.repeat(value)}${'-'.repeat(5 - value)} ${Number(score || 0)}%`;
}

function discoveryWidgets(summary = {}, analytics = {}) {
  const widgets = [
    ['Verified', summary.verified || 0],
    ['Needs config', summary.requires_configuration || 0],
    ['Needs API key', summary.needs_api_key || 0],
    ['Broken', summary.broken || 0],
    ['APIs found', summary.official_api_available || 0],
    ['RSS feeds', summary.rss_available || 0],
    ['Contracts week', analytics.contracts_this_week || 0],
    ['Scheduler', analytics.scheduler_health || 'not run']
  ];
  return widgets.map(([label, value]) => `<div class="metric"><strong>${escapeHtml(value)}</strong><span>${escapeHtml(label)}</span></div>`).join('');
}

function yesNo(value) { return value ? 'Yes' : 'No'; }

function discoveryRows(items = []) {
  return items.map((item) => {
    const endpoints = item.endpoint_availability || {};
    const mapping = item.field_mapping || {};
    return `<tr>
      <td><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(item.group_name || '')}</small></td>
      <td><span class="status ${item.status === 'broken' ? 'expired' : ''}">${escapeHtml(statusText(item.status))}</span></td>
      <td>${escapeHtml(item.source_url || '-')}</td>
      <td>${escapeHtml(item.api_documentation_url || '-')}</td>
      <td>${escapeHtml(item.country || 'Worldwide')}</td>
      <td>${escapeHtml(item.industry || 'Procurement')}</td>
      <td>${yesNo(item.authentication_required)} ${item.required_api_keys?.length ? `(${escapeHtml(item.required_api_keys.join(', '))})` : ''}</td>
      <td>${escapeHtml(item.rate_limit || '-')}</td>
      <td>${escapeHtml(Object.keys(item.pagination || {}).length ? JSON.stringify(item.pagination) : '-')}</td>
      <td>${yesNo(endpoints.official_api_available)} / ${yesNo(endpoints.rss_available)} / ${yesNo(endpoints.json_available)} / ${yesNo(endpoints.xml_available)} / ${yesNo(endpoints.csv_available)}</td>
      <td>${mapping.confidence || 0}%</td>
      <td>${item.health_score || 0}%</td>
      <td>${scoreStars(item.quality_score)}</td>
      <td>${date(item.last_verified_at)}</td>
      <td>${item.source_id ? `<button class="button button-ghost" data-verify-source="${item.source_id}">Verify Source</button>` : '<span class="chip">Configure first</span>'}</td>
    </tr>`;
  }).join('');
}

function discoveryPreview(items = []) {
  const samples = items.flatMap((item) => (item.metadata?.sample_contracts || []).map((sample) => ({ ...sample, source_name: item.name }))).slice(0, 8);
  return samples.map((sample) => `<div class="list-item compact-list-item">
    <div><h3>${escapeHtml(sample.title || 'Untitled sample')}</h3><p>${escapeHtml(sample.source_name || 'Source')} | ${escapeHtml(sample.country || 'Worldwide')} | ${escapeHtml(sample.industry || 'Procurement')}</p></div>
    ${sample.source_url ? `<a class="button button-ghost" href="${escapeHtml(sample.source_url)}" target="_blank" rel="noopener noreferrer">Open</a>` : ''}
  </div>`).join('') || '<div class="empty">Run Verify Source on a configured connector to preview sample contracts.</div>';
}

function marketplaceRows(items = []) {
  return items.map((item) => `<tr>
    <td><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(item.id)}</small></td>
    <td>${escapeHtml(item.group || '-')}</td>
    <td>${escapeHtml(item.country || 'Worldwide')}</td>
    <td>${escapeHtml(item.industry || 'Procurement')}</td>
    <td>${yesNo(item.official_api_available)}</td>
    <td>${yesNo(item.rss_available)}</td>
    <td>${yesNo(item.json_available)}</td>
    <td>${yesNo(item.xml_available)}</td>
    <td>${yesNo(item.csv_available)}</td>
    <td>${yesNo(item.authentication_required)}</td>
    <td>${escapeHtml(item.api_documentation || '-')}</td>
    <td><span class="status">${escapeHtml(statusText(item.status))}</span></td>
    <td><button class="button button-ghost" data-install-template="${escapeHtml(item.id)}" ${item.install_supported ? '' : 'disabled'}>${item.install_supported ? 'Install' : 'Needs config'}</button></td>
  </tr>`).join('');
}

async function renderSourceDiscovery() {
  if (!(await requireLogin())) return; if(currentUser.role!=='admin'){app.innerHTML='<section class="page"><div class="empty">Administrator access required.</div></section>';return;}
  const data = await api('/admin/source-discovery');
  app.innerHTML = `<section class="page">
    <div class="section-heading"><div><p class="eyebrow">Self-configuring intelligence</p><h1>Auto Source Discovery</h1></div><div class="toolbar"><button class="button button-gold" id="run-discovery">Discover Sources</button><a class="button button-outline" href="/contract-finder/admin/connectors">Connector Manager</a></div></div>
    ${dashboardNav()}
    <div class="metric-grid">${discoveryWidgets(data.summary, data.analytics)}</div>
    <form class="panel" id="discovery-save-form" style="margin-top:20px">
      <div class="section-heading compact"><div><p class="eyebrow">Save configuration</p><h2>Add Verified Source</h2></div><p>Use only official APIs, public feeds, or permitted procurement endpoints. New sources are disabled unless an API/feed URL is supplied and enabled.</p></div>
      <div class="field-row"><div class="field"><label>Name</label><input name="name" required></div><div class="field"><label>Connector</label><input name="connector_key" value="json"></div></div>
      <div class="field-row"><div class="field"><label>Source URL</label><input name="source_url" type="url" required></div><div class="field"><label>API / Feed URL</label><input name="api_url" type="url"></div></div>
      <div class="field-row"><div class="field"><label>Country</label><input name="country"></div><div class="field"><label>Region</label><input name="region"></div></div>
      <div class="field-row"><div class="field"><label>Format</label><select name="source_format">${['rest','rss','xml','json','csv'].map((item)=>option(item,'json',item.toUpperCase())).join('')}</select></div><div class="field"><label>API key env</label><input name="api_key_env"></div></div>
      <div class="field"><label>Field mapping override JSON</label><textarea name="field_mapping" placeholder='{"title":"title","description":"description"}'>{}</textarea></div>
      <label class="check-row"><input type="checkbox" name="enable"> Enable after save when API/feed URL is present</label>
      <button class="button button-gold">Save Configuration</button>
    </form>
    <div class="panel" style="margin-top:20px">
      <div class="section-heading compact"><div><p class="eyebrow">Preview contracts</p><h2>Sample Data</h2></div><p>Samples are stored only after an official configured source passes parser validation.</p></div>
      <div class="list">${discoveryPreview(data.items)}</div>
    </div>
    <div class="panel" style="margin-top:20px">
      <div class="section-heading compact"><div><p class="eyebrow">Discovery results</p><h2>Sources, Endpoints & AI Mapping</h2></div><p>Endpoint columns show API / RSS / JSON / XML / CSV availability based only on configured official metadata.</p></div>
      <div class="table-wrap"><table><thead><tr><th>Source</th><th>Status</th><th>Source URL</th><th>API Docs</th><th>Country</th><th>Industry</th><th>Auth</th><th>Rate limit</th><th>Pagination</th><th>API/RSS/JSON/XML/CSV</th><th>Mapping</th><th>Health</th><th>Quality</th><th>Last verified</th><th>Action</th></tr></thead><tbody>${discoveryRows(data.items)}</tbody></table></div>
    </div>
  </section>`;
  document.querySelector('#run-discovery').onclick=async()=>{await api('/admin/source-discovery/run',{method:'POST',body:'{}'});toast('Source discovery refreshed');setTimeout(()=>location.reload(),450);};
  document.querySelector('#discovery-save-form').onsubmit=async(event)=>{
    event.preventDefault();
    const values=Object.fromEntries(new FormData(event.currentTarget));
    try {
      values.enable=Boolean(values.enable);
      values.field_mapping=JSON.parse(values.field_mapping || '{}');
      values.parser_config={ parser_type: values.source_format || 'json', field_map: values.field_mapping };
      await api('/admin/source-discovery/save',{method:'POST',body:JSON.stringify(values)});
      toast('Source configuration saved'); setTimeout(()=>location.reload(),500);
    } catch(error) { toast(error.message,true); }
  };
  document.querySelectorAll('[data-verify-source]').forEach((el)=>el.onclick=async()=>{try{await api('/admin/source-discovery/verify',{method:'POST',body:JSON.stringify({source_id:Number(el.dataset.verifySource)})});toast('Source verified');setTimeout(()=>location.reload(),500);}catch(error){toast(error.message,true);}});
}

function wizardKey(item = {}) {
  return `${item.type}:${item.id}`;
}

function wizardSelected(data = {}) {
  const selectedKey = new URLSearchParams(location.search).get('connector');
  return (data.sources || []).find((item) => wizardKey(item) === selectedKey)
    || (data.sources || []).find((item) => item.status === 'requires_configuration')
    || (data.sources || [])[0]
    || null;
}

function wizardStatusClass(status) {
  return ['failed','broken'].includes(String(status || '').toLowerCase()) ? 'expired' : '';
}

function wizardAuthSummary(auth = {}) {
  const keys = auth.keys?.length ? ` (${auth.keys.join(', ')})` : '';
  return `${auth.type || 'Unknown'}${auth.required ? ' required' : ''}${auth.configured ? '' : ' - not configured'}${keys}`;
}

function wizardDiagnostics(diagnostics = {}) {
  const dns = diagnostics.dns?.status === 'resolved' ? `Resolved ${diagnostics.dns.address}` : diagnostics.dns?.error || diagnostics.dns?.status || 'Not checked';
  const tls = diagnostics.tls?.status || 'Not checked';
  const rate = diagnostics.rate_limit?.remaining || diagnostics.rate_limit?.limit || diagnostics.rate_limit?.retry_after || 'Not provided';
  const metrics = [
    ['HTTP code', diagnostics.http_code || 'Not tested'],
    ['Response time', diagnostics.response_time_ms === null || diagnostics.response_time_ms === undefined ? 'Not tested' : `${diagnostics.response_time_ms} ms`],
    ['DNS', dns],
    ['TLS', tls],
    ['Response size', diagnostics.response_size_bytes ? `${diagnostics.response_size_bytes} bytes` : 'Not measured'],
    ['Rate limit', rate],
    ['Auth', wizardAuthSummary(diagnostics.authentication_status || {})]
  ];
  return `<div class="metric-grid compact-metrics">${metrics.map(([label, value]) => `<div class="metric"><strong>${escapeHtml(value)}</strong><span>${escapeHtml(label)}</span></div>`).join('')}</div>`;
}

function wizardPreview(items = []) {
  return items.map((item) => `<div class="list-item compact-list-item">
    <div><h3>${escapeHtml(item.title || 'Untitled contract')}</h3><p>${escapeHtml(item.country || 'Worldwide')} | ${escapeHtml(item.industry || 'Procurement')} | ${item.valid === false ? 'Needs mapping' : 'Valid sample'}</p></div>
    ${item.source_url ? `<a class="button button-ghost" href="${escapeHtml(item.source_url)}" target="_blank" rel="noopener noreferrer">Open Original Tender</a>` : ''}
  </div>`).join('') || '<div class="empty">No preview contracts yet. Run Test Connection after adding an official endpoint.</div>';
}

function wizardResultPanel(result = null) {
  if (!result) return '<div class="empty">Choose a connector, add the official API/feed URL, then run Test Connection.</div>';
  if (result.message) {
    return `<div class="notice"><strong>${escapeHtml(result.name || 'Connector')}</strong><p>${escapeHtml(result.message)}</p><p>Documentation: ${result.documentation_url ? `<a href="${escapeHtml(result.documentation_url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(result.documentation_url)}</a>` : 'Add official documentation URL in configuration.'}</p><p>Authentication: ${wizardAuthSummary(result.authentication || {})}</p></div>`;
  }
  const test = result.test || {};
  return `<div>
    <div class="notice ${test.ok ? '' : 'premium'}"><strong>${test.ok ? 'Connection test completed' : 'Connection needs attention'}</strong><p>${escapeHtml(test.message || test.error || test.status || 'No status message returned.')}</p></div>
    ${wizardDiagnostics(result.diagnostics || {})}
    <h3>Preview Contracts</h3>
    <div class="list">${wizardPreview(result.preview_contracts || test.sample_contracts || [])}</div>
  </div>`;
}

function wizardPayload(form, selected) {
  const values = Object.fromEntries(new FormData(form));
  if (selected?.type === 'source') values.source_id = Number(selected.id);
  if (selected?.type === 'template') values.template_id = selected.id;
  values.enable = Boolean(values.enable);
  values.headers = parseSourceJson(values.headers, {});
  values.auth_config = parseSourceJson(values.auth_config, {});
  values.pagination_config = parseSourceJson(values.pagination_config, {});
  values.field_mapping = parseSourceJson(values.field_mapping, {});
  values.parser_config = {
    parser_type: values.source_format || 'json',
    items_path: values.items_path || undefined,
    limit: values.limit ? Number(values.limit) : undefined,
    field_map: values.field_mapping
  };
  values.rate_limit_ms = Number(values.rate_limit_ms || 0);
  values.initial_import_limit = Number(values.initial_import_limit || 500);
  values.daily_import_limit = Number(values.daily_import_limit || 50);
  return values;
}

async function renderConnectorWizard() {
  if (!(await requireLogin())) return; if(currentUser.role!=='admin'){app.innerHTML='<section class="page"><div class="empty">Administrator access required.</div></section>';return;}
  const data = await api('/admin/connector-wizard');
  const selected = wizardSelected(data);
  const selectedKey = selected ? wizardKey(selected) : '';
  const baseMapping = { external_id: 'id', title: 'title', description: 'description', source_url: 'url', buyer_name: 'buyer_name', country: 'country', industry: 'industry', contract_type: 'contract_type', budget_value: 'budget_value', currency: 'currency', deadline: 'deadline', posted_date: 'posted_date', tags: 'tags' };
  const defaultMapping = JSON.stringify(Object.keys(selected?.field_mapping || {}).length ? selected.field_mapping : baseMapping, null, 2);
  const documentationUrl = selected?.documentation_url || '';
  app.innerHTML = `<section class="page">
    <div class="section-heading"><div><p class="eyebrow">Admin guided setup</p><h1>Connector Wizard</h1></div><div class="toolbar"><a class="button button-outline" href="/contract-finder/admin/connectors">Connector Manager</a><a class="button button-outline" href="/contract-finder/admin/source-discovery">Source Discovery</a></div></div>
    ${dashboardNav()}
    <div class="metric-grid">
      <div class="metric"><strong>${data.summary?.total || data.sources?.length || 0}</strong><span>Total connectors</span></div>
      <div class="metric"><strong>${data.summary?.requires_configuration || 0}</strong><span>Requires configuration</span></div>
      <div class="metric"><strong>${data.summary?.verified || 0}</strong><span>Verified</span></div>
      <div class="metric"><strong>${data.summary?.needs_api_key || 0}</strong><span>Needs API key</span></div>
    </div>
    <div class="admin-grid">
      <form class="panel" id="connector-wizard-form">
        <div class="section-heading compact"><div><p class="eyebrow">Step 1</p><h2>Select Connector</h2></div><span class="status ${wizardStatusClass(selected?.status)}">${escapeHtml(statusText(selected?.status))}</span></div>
        <div class="field"><label>Connector</label><select id="wizard-connector">${(data.sources || []).map((item)=>option(wizardKey(item), selectedKey, `${item.name} - ${statusText(item.status)}`)).join('')}</select></div>
        <div class="notice"><strong>Compliance rule</strong><p>Use only official APIs, public feeds, or permitted public procurement interfaces. The wizard will not mark a connector as Working until it connects, returns HTTP 200, and imports at least one contract.</p></div>

        <div class="section-heading compact" style="margin-top:22px"><div><p class="eyebrow">Step 2</p><h2>Official Source Details</h2></div><button class="button button-ghost" type="button" id="wizard-detect">Detect</button></div>
        <div class="field-row"><div class="field"><label>Name</label><input name="name" value="${escapeHtml(selected?.name || '')}" required></div><div class="field"><label>Connector key</label><input name="connector_key" value="${escapeHtml(selected?.connector_key || 'json')}"></div></div>
        <div class="field"><label>Official documentation URL</label><input name="api_documentation_url" type="url" value="${escapeHtml(documentationUrl)}" placeholder="Official API/feed documentation"></div>
        <div class="field"><label>Official procurement/source page</label><input name="source_url" type="url" value="${escapeHtml(selected?.source_url || '')}" placeholder="Official procurement portal page"></div>

        <div class="section-heading compact" style="margin-top:22px"><div><p class="eyebrow">Step 3</p><h2>Configure Endpoint</h2></div></div>
        <div class="field-row"><div class="field"><label>API URL</label><input name="api_url" type="url" value="${escapeHtml(selected?.api_url || '')}" placeholder="REST API endpoint"></div><div class="field"><label>RSS URL</label><input name="rss_url" type="url" placeholder="Official RSS feed"></div></div>
        <div class="field-row"><div class="field"><label>XML URL</label><input name="xml_url" type="url" placeholder="Official XML feed"></div><div class="field"><label>JSON URL</label><input name="json_url" type="url" placeholder="Official JSON endpoint"></div></div>
        <div class="field-row"><div class="field"><label>CSV URL</label><input name="csv_url" type="url" placeholder="Official CSV feed"></div><div class="field"><label>Format</label><select name="source_format">${['rest','rss','xml','json','csv'].map((item)=>option(item, selected?.source_format === 'requires_configuration' ? 'json' : selected?.source_format || 'json', item.toUpperCase())).join('')}</select></div></div>
        <div class="field-row"><div class="field"><label>Country</label><input name="country" value="${escapeHtml(selected?.country || 'Worldwide')}"></div><div class="field"><label>Region</label><input name="region" value="${escapeHtml(selected?.region || '')}"></div></div>
        <div class="field-row"><div class="field"><label>Source type</label><select name="source_type">${['government','private'].map((item)=>option(item, selected?.source_type || 'government', item)).join('')}</select></div><div class="field"><label>Schedule</label><select name="schedule">${['hourly','daily','weekly','monthly'].map((item)=>option(item, selected?.schedule || 'hourly', item)).join('')}</select></div></div>
        <div class="field-row"><div class="field"><label>API key environment variable</label><input name="api_key_env" value="${escapeHtml(selected?.api_key_env || '')}" placeholder="SAM_API_KEY"></div><div class="field"><label>API key header</label><input name="api_key_header" placeholder="x-api-key"></div></div>
        <div class="field-row"><div class="field"><label>OAuth client ID env</label><input name="oauth_client_id_env" placeholder="OAUTH_CLIENT_ID"></div><div class="field"><label>OAuth secret env</label><input name="oauth_client_secret_env" placeholder="OAUTH_CLIENT_SECRET"></div></div>
        <div class="field-row"><div class="field"><label>Items path</label><input name="items_path" placeholder="results.items"></div><div class="field"><label>Preview/import limit</label><input name="limit" type="number" min="0" placeholder="Optional"></div></div>
        <div class="field-row"><div class="field"><label>Rate limit ms</label><input name="rate_limit_ms" type="number" min="0" value="${Number(selected?.rate_limit_ms || 0)}"></div><div class="field"><label>Base URL</label><input name="base_url" type="url" value="${escapeHtml(selected?.base_url || '')}" placeholder="Optional"></div></div>
        <div class="field-row"><div class="field"><label>Initial Import Limit</label><input name="initial_import_limit" type="number" min="1" max="1000" value="${Number(selected?.initial_import_limit || 500)}"></div><div class="field"><label>Daily Import Limit</label><input name="daily_import_limit" type="number" min="1" max="1000" value="${Number(selected?.daily_import_limit || 50)}"></div></div>
        <div class="field"><label>Headers JSON</label><textarea name="headers">{}</textarea></div>
        <div class="field"><label>Authentication JSON</label><textarea name="auth_config">{}</textarea></div>
        <div class="field"><label>Pagination JSON</label><textarea name="pagination_config">{}</textarea></div>

        <div class="section-heading compact" style="margin-top:22px"><div><p class="eyebrow">Steps 4-6</p><h2>Test, Map & Save</h2></div></div>
        <div class="field"><label>Field mapping JSON</label><textarea name="field_mapping" id="wizard-field-mapping">${escapeHtml(defaultMapping)}</textarea></div>
        <label class="check-row"><input type="checkbox" name="enable"> Enable and schedule imports after successful test/import</label>
        <div class="toolbar" style="margin-top:16px"><button class="button button-outline" type="button" id="wizard-test">Test Connection</button><button class="button button-gold" type="submit">Save Configuration</button></div>
      </form>
      <div class="panel">
        <div class="section-heading compact"><div><p class="eyebrow">Diagnostics</p><h2>Connection Result</h2></div></div>
        <div id="wizard-result">${wizardResultPanel(null)}</div>
        <div class="panel" style="margin-top:20px">
          <h2>Selected Connector</h2>
          <dl class="mini-list">
            <div><dt>Name</dt><dd>${escapeHtml(selected?.name || '-')}</dd></div>
            <div><dt>Status</dt><dd>${escapeHtml(statusText(selected?.status))}</dd></div>
            <div><dt>Auth</dt><dd>${escapeHtml(wizardAuthSummary(selected?.authentication || {}))}</dd></div>
            <div><dt>Last sync</dt><dd>${date(selected?.last_sync)}</dd></div>
            <div><dt>Imported</dt><dd>${selected?.contracts_imported || 0}</dd></div>
            <div><dt>Last failure</dt><dd>${escapeHtml(selected?.last_failure || 'None')}</dd></div>
          </dl>
        </div>
      </div>
    </div>
  </section>`;
  document.querySelector('#wizard-connector').onchange=(event)=>{location.href=`/contract-finder/admin/connector-wizard?connector=${encodeURIComponent(event.target.value)}`;};
  document.querySelector('#wizard-detect').onclick=async()=>{
    try {
      const body = selected?.type === 'source' ? { source_id: Number(selected.id) } : { template_id: selected?.id };
      const result = await api('/admin/connector-wizard/detect',{method:'POST',body:JSON.stringify(body)});
      document.querySelector('#wizard-result').innerHTML=wizardResultPanel(result);
      toast('Connector details loaded');
    } catch(error) { toast(error.message,true); }
  };
  document.querySelector('#wizard-test').onclick=async()=>{
    try {
      const result = await api('/admin/connector-wizard/test',{method:'POST',body:JSON.stringify(wizardPayload(document.querySelector('#connector-wizard-form'), selected))});
      document.querySelector('#wizard-result').innerHTML=wizardResultPanel(result);
      if (result.field_mapping?.mapping) document.querySelector('#wizard-field-mapping').value=JSON.stringify(result.field_mapping.mapping, null, 2);
      toast(result.test?.ok ? 'Connection test completed' : 'Connection test needs attention', !result.test?.ok);
    } catch(error) { toast(error.message,true); }
  };
  document.querySelector('#connector-wizard-form').onsubmit=async(event)=>{
    event.preventDefault();
    try {
      const result = await api('/admin/connector-wizard/save',{method:'POST',body:JSON.stringify(wizardPayload(event.currentTarget, selected))});
      toast(result.working ? 'Connector saved and marked Working' : 'Connector saved but remains configuration-only', !result.working);
      setTimeout(()=>location.reload(),700);
    } catch(error) { toast(error.message,true); }
  };
}

async function renderMarketplace() {
  if (!(await requireLogin())) return; if(currentUser.role!=='admin'){app.innerHTML='<section class="page"><div class="empty">Administrator access required.</div></section>';return;}
  const data = await api('/admin/marketplace');
  app.innerHTML = `<section class="page">
    <div class="section-heading"><div><p class="eyebrow">Connector marketplace</p><h1>Global Procurement Coverage</h1></div><div class="toolbar"><a class="button button-outline" href="/contract-finder/admin/source-discovery">Source Discovery</a><a class="button button-outline" href="/contract-finder/admin/connectors">Connector Manager</a></div></div>
    ${dashboardNav()}
    <div class="metric-grid">${discoveryWidgets(data.summary, data.analytics)}</div>
    <div class="panel" style="margin-top:20px">
      <div class="section-heading compact"><div><p class="eyebrow">Coverage catalog</p><h2>Marketplace</h2></div><p>One-click install is enabled only when a connector has a verified official endpoint. Template-only entries require admin configuration first.</p></div>
      <div class="table-wrap"><table><thead><tr><th>Connector</th><th>Group</th><th>Country</th><th>Industry</th><th>API</th><th>RSS</th><th>JSON</th><th>XML</th><th>CSV</th><th>Auth</th><th>API Docs</th><th>Status</th><th>Install</th></tr></thead><tbody>${marketplaceRows(data.items)}</tbody></table></div>
    </div>
  </section>`;
  document.querySelectorAll('[data-install-template]').forEach((el)=>el.onclick=async()=>{toast('Add official API/feed URL in Source Discovery before installing this connector.', true);});
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

function recentContractRows(items = []) {
  return items.map((item) => `<tr>
    <td><span class="score-pill">${item.ai_score || 0}</span></td>
    <td><a href="/contract-finder/contracts/${escapeHtml(item.slug)}">${escapeHtml(compactText(item.title, 64))}</a></td>
    <td>${escapeHtml(item.country || 'Worldwide')}</td>
    <td>${escapeHtml(item.ai_priority || 'Low')}</td>
    <td>${shortDate(item.created_at)}</td>
  </tr>`).join('') || '<tr><td colspan="5" class="empty-row">No recent contracts.</td></tr>';
}

function importActivityRows(items = []) {
  return items.map((run) => `<tr>
    <td>${escapeHtml(run.connector_key || 'manual')}</td>
    <td><span class="status ${run.status === 'failed' ? 'expired' : ''}">${escapeHtml(statusText(run.status))}</span></td>
    <td>${run.imported_count || 0}</td>
    <td>${run.updated_count || 0}</td>
    <td>${run.duplicate_skipped_count || 0}</td>
    <td>${run.failure_count || 0}</td>
    <td>${run.duration_ms || 0} ms</td>
    <td>${shortDate(run.started_at)}</td>
  </tr>`).join('') || '<tr><td colspan="8" class="empty-row">No import runs yet.</td></tr>';
}

function countryMap(items = []) {
  const max = Math.max(1, ...items.map((item) => Number(item.count || 0)));
  return `<div class="map-panel">${items.map((item) => `<div class="map-row"><span>${escapeHtml(item.country || 'Worldwide')}</span><meter min="0" max="${max}" value="${item.count || 0}"></meter><strong>${item.count || 0}</strong></div>`).join('') || '<div class="empty compact-empty">No country data yet.</div>'}</div>`;
}

function sourceStatusRows(items = []) {
  return items.slice(0, 12).map((source) => `<tr>
    <td>${escapeHtml(compactText(source.name, 34))}</td>
    <td><span class="status ${source.last_status === 'failed' ? 'expired' : ''}">${escapeHtml(statusText(source.last_status))}</span></td>
    <td>${shortDate(source.last_success_at || source.last_imported_at)}</td>
    <td>${source.contracts_imported || 0}<small>dup ${source.duplicates_skipped || 0}</small></td>
  </tr>`).join('') || '<tr><td colspan="4" class="empty-row">No sources configured.</td></tr>';
}

function privateMetricGrid(dashboard = {}) {
  const metrics = [
    ['Total Opportunities', dashboard.total_opportunities || 0],
    ['New Today', dashboard.new_today || 0],
    ['Closing Soon', dashboard.closing_soon || 0],
    ['AMC Opportunities', dashboard.amc_opportunities || 0],
    ['Rope Access', dashboard.rope_access_opportunities || 0],
    ['Building Maintenance', dashboard.building_maintenance_opportunities || 0],
    ['High Priority', dashboard.high_priority || 0],
    ['AI Matches', dashboard.ai_matches || 0]
  ];
  return metrics.map(([label, value]) => `<div class="metric"><strong>${escapeHtml(value)}</strong><span>${escapeHtml(label)}</span></div>`).join('');
}

function leadFinderBasePath() {
  return location.pathname.startsWith('/contract-finder/admin/private-opportunities')
    ? '/contract-finder/admin/private-opportunities'
    : '/contract-finder/admin/lead-finder';
}

function leadCategoryCards(filters = {}, params = new URLSearchParams(), basePath = leadFinderBasePath()) {
  const labels = ['CB','SM','HS','HT','IT','AP','WH','MF','FM','PD','VR'];
  return `<div class="lead-category-grid">${(filters.lead_categories || []).map((category, index) => {
    const query = new URLSearchParams(params);
    query.set('lead_category', category);
    query.set('page', '1');
    return `<a class="lead-category-card ${params.get('lead_category') === category ? 'is-active' : ''}" href="${basePath}?${query}">
      <span>${labels[index] || 'LD'}</span>
      <strong>${escapeHtml(category)}</strong>
    </a>`;
  }).join('')}</div>`;
}

function privateRows(items = [], basePath = leadFinderBasePath()) {
  return items.map((item) => `<tr tabindex="0">
    <td data-col="score"><span class="score-pill">${item.match_score || 0}</span></td>
    <td data-col="company"><strong>${escapeHtml(compactText(item.company, 34))}</strong></td>
    <td data-col="opportunity"><a href="${basePath}/${encodeURIComponent(item.slug)}">${escapeHtml(compactText(item.title, 58))}</a><small>${escapeHtml(compactText(item.building_type || item.win_probability || '', 34))}</small></td>
    <td data-col="service">${escapeHtml(compactText((item.required_services || []).join(', '), 42))}</td>
    <td data-col="industry">${escapeHtml(compactText(item.industry || '-', 30))}</td>
    <td data-col="country">${escapeHtml(item.country || 'Worldwide')}</td>
    <td data-col="state">${escapeHtml(item.state || '-')}</td>
    <td data-col="city">${escapeHtml(item.city || '-')}</td>
    <td data-col="deadline">${shortDate(item.deadline)}</td>
    <td data-col="status"><span class="status ${item.priority === 'High' ? '' : item.status === 'closed' ? 'expired' : ''}">${escapeHtml(statusText(item.status))}</span></td>
    <td data-col="source">${escapeHtml(compactText(item.configured_source_name || item.source_name || '-', 30))}</td>
    <td data-col="updated">${shortDate(item.updated_at)}</td>
    <td data-col="actions"><a class="button button-ghost" href="${basePath}/${encodeURIComponent(item.slug)}">Open</a></td>
  </tr>`).join('') || '<tr><td colspan="13" class="empty-row">No private opportunities yet.</td></tr>';
}

function privateSourceRows(sources = []) {
  return sources.map((source) => `<tr>
    <td><strong>${escapeHtml(compactText(source.name, 34))}</strong><small>${escapeHtml(source.source_type)}</small></td>
    <td>${escapeHtml(source.country || 'Worldwide')}</td>
    <td>${escapeHtml(source.industry || '-')}</td>
    <td><span class="status ${source.last_test_status === 'failed' ? 'expired' : ''}">${escapeHtml(statusText(source.last_test_status))}</span></td>
    <td>${source.last_http_status || '-'}</td>
    <td>${source.opportunities_imported || 0}</td>
    <td>${source.failures || 0}</td>
    <td>${shortDate(source.last_success_at || source.last_run_at)}</td>
    <td>
      <div class="toolbar">
        <button class="button button-ghost" data-private-test="${source.id}">Test</button>
        <button class="button button-ghost" data-private-import="${source.id}">Import</button>
        <button class="button button-ghost" data-private-logs="${source.id}">Logs</button>
        <button class="button button-ghost" data-private-edit="${source.id}">Edit</button>
        <button class="button ${source.is_active ? 'button-danger' : 'button-outline'}" data-private-toggle="${source.id}" data-active="${source.is_active ? '1' : '0'}">${source.is_active ? 'Disable' : 'Enable'}</button>
        <button class="button button-danger" data-private-delete-source="${source.id}">Delete</button>
      </div>
    </td>
  </tr>`).join('') || '<tr><td colspan="9" class="empty-row">No private sources configured.</td></tr>';
}

function privateFilterForm(filters = {}, params = new URLSearchParams()) {
  const selectOptions = (values, selected) => values.map((value) => option(value, selected)).join('');
  return `<form id="private-filters" class="filters">
    <h3>Advanced filters</h3>
    <div class="field"><label>Keyword</label><input name="keyword" value="${escapeHtml(params.get('keyword') || '')}" placeholder="Company, service, city..."></div>
    <div class="field"><label>Country</label><select name="country"><option value="">All</option>${selectOptions(filters.countries || [], params.get('country'))}</select></div>
    <div class="field"><label>Industry</label><select name="industry"><option value="">All</option>${selectOptions(filters.industries || [], params.get('industry'))}</select></div>
    <div class="field"><label>Lead category</label><select name="lead_category"><option value="">All</option>${selectOptions(filters.lead_categories || [], params.get('lead_category'))}</select></div>
    <div class="field"><label>Service</label><select name="service"><option value="">All</option>${selectOptions(filters.services || [], params.get('service'))}</select></div>
    <div class="field"><label>Status</label><select name="status"><option value="">All</option>${selectOptions(filters.statuses || [], params.get('status'))}</select></div>
    <div class="field"><label>Source</label><select name="source_id"><option value="">All</option>${(filters.sources || []).map((source) => option(String(source.id), params.get('source_id'), source.name)).join('')}</select></div>
    <div class="field-row"><div class="field"><label>State</label><input name="state" value="${escapeHtml(params.get('state') || '')}"></div><div class="field"><label>City</label><input name="city" value="${escapeHtml(params.get('city') || '')}"></div></div>
    <div class="field-row"><div class="field"><label>Budget min</label><input type="number" name="min_budget" value="${escapeHtml(params.get('min_budget') || '')}"></div><div class="field"><label>Budget max</label><input type="number" name="max_budget" value="${escapeHtml(params.get('max_budget') || '')}"></div></div>
    <div class="field-row"><div class="field"><label>Deadline after</label><input type="date" name="deadline_after" value="${escapeHtml(params.get('deadline_after') || '')}"></div><div class="field"><label>Deadline before</label><input type="date" name="deadline_before" value="${escapeHtml(params.get('deadline_before') || '')}"></div></div>
    <div class="field"><label>AI match score</label><input type="number" name="min_score" min="0" max="100" value="${escapeHtml(params.get('min_score') || '')}"></div>
    <div class="field"><label>Sort</label><select name="sort">${['updated:desc','score:desc','deadline:asc','company:asc','country:asc'].map((item) => option(item, params.get('sort') || 'updated:desc', item)).join('')}</select></div>
    <button class="button button-gold">Apply filters</button>
  </form>`;
}

async function renderPrivateOpportunities() {
  if (!(await requireLogin())) return; if(currentUser.role !== 'admin'){app.innerHTML='<section class="page"><div class="empty">Administrator access required.</div></section>';return;}
  const basePath = leadFinderBasePath();
  const params = new URLSearchParams(location.search);
  if (!params.get('page_size')) params.set('page_size', '100');
  const data = await api(`/admin/private-opportunities?${params}`);
  const opportunities = data.opportunities || { items: [], pagination: { page: 1, pages: 1, total: 0 } };
  app.innerHTML = `<section class="page dense-page">
    <div class="section-heading dense-heading">
      <div><p class="eyebrow">Admin-only business development</p><h1>Lead Finder</h1></div>
      <p>Internal lead finder for private building maintenance, facility management, AMC, facade, glass cleaning, and rope access opportunities.</p>
    </div>
    ${dashboardNav()}
    <div class="metric-grid dashboard-metrics">${privateMetricGrid(data.dashboard)}</div>
    <div class="panel lead-finder-panel">
      <div class="section-heading compact"><div><p class="eyebrow">Lead Finder</p><h2>Target Segments</h2></div><p>Find private building maintenance leads by client segment and vendor registration opportunities.</p></div>
      ${leadCategoryCards(data.filters, params, basePath)}
    </div>
    <div class="dense-toolbar sticky-toolbar">
      <form id="private-quick-search" class="dense-search"><input name="keyword" value="${escapeHtml(params.get('keyword') || '')}" placeholder="Search private opportunities..."><button class="button button-gold">Search</button></form>
      <div class="toolbar"><span class="chip">${opportunities.pagination.total} private opportunities</span><a class="button button-outline" href="/contract-finder/admin">Government Contracts</a>${columnSelector(privateOpportunityColumns, 'private-opportunities')}</div>
      <div class="chip-row quick-filters">${['Rope Access','Glass Cleaning','Building Maintenance','AMC','Facility Management'].map((service) => { const query = new URLSearchParams(params); query.set('service', service); query.set('page','1'); return `<a class="chip ${params.get('service') === service ? 'chip-gold' : ''}" href="${basePath}?${query}">${escapeHtml(service)}</a>`; }).join('')}</div>
    </div>
    <details class="filter-drawer"><summary class="button button-outline">Advanced filters</summary>${privateFilterForm(data.filters, params)}</details>
    <div class="dense-table-wrap virtual-table">
      <table class="dense-table private-opportunity-table">
        <thead><tr>${privateOpportunityColumns.map(([id, label]) => `<th data-col="${escapeHtml(id)}">${escapeHtml(label)}</th>`).join('')}</tr></thead>
        <tbody>${privateRows(opportunities.items, basePath)}</tbody>
      </table>
    </div>
    <div class="pagination sticky-pagination">
      <button class="button button-ghost" id="private-prev" ${opportunities.pagination.page <= 1 ? 'disabled' : ''}>Previous</button>
      <span class="button button-ghost">Page ${opportunities.pagination.page} of ${opportunities.pagination.pages}</span>
      <button class="button button-ghost" id="private-next" ${opportunities.pagination.page >= opportunities.pagination.pages ? 'disabled' : ''}>Next</button>
    </div>
    <div class="admin-grid" style="margin-top:20px">
      <form class="panel" id="private-source-form">
        <h2>Add Private Source</h2>
        <div class="field"><label>Name</label><input name="name" required placeholder="Mall vendor portal"></div>
        <div class="field-row"><div class="field"><label>Source type</label><select name="source_type">${['procurement_portal','vendor_registration','rfq_page','rfp_page','tender_page','rss','json','xml','csv'].map((item)=>option(item,'',statusText(item))).join('')}</select></div><div class="field"><label>Schedule</label><select name="schedule">${['hourly','daily','weekly','monthly'].map((item)=>option(item,'hourly',item)).join('')}</select></div></div>
        <div class="field"><label>Official source URL</label><input name="source_url" type="url" required placeholder="Official company procurement page"></div>
        <div class="field"><label>Official API / RSS / XML / JSON / CSV URL</label><input name="endpoint_url" type="url" placeholder="Only if publicly available and permitted"></div>
        <div class="field-row"><div class="field"><label>Country</label><input name="country" value="India"></div><div class="field"><label>State</label><input name="state"></div></div>
        <div class="field-row"><div class="field"><label>City</label><input name="city"></div><div class="field"><label>Industry</label><input name="industry" value="Commercial Building Maintenance"></div></div>
        <div class="field-row"><div class="field"><label>API key env</label><input name="api_key_env"></div><div class="field"><label>Rate limit ms</label><input name="rate_limit_ms" type="number" value="0"></div></div>
        <div class="field"><label>Headers JSON</label><textarea name="headers">{}</textarea></div>
        <div class="field"><label>Parser config JSON</label><textarea name="parser_config">{"parser_type":"json","field_map":{"external_id":"id","company":"company","title":"title","description":"description","source_url":"url","deadline":"deadline","posted_date":"posted_date","industry":"industry","country":"country","state":"state","city":"city"}}</textarea></div>
        <label class="check-row"><input type="checkbox" name="is_active"> Enable after configuration</label>
        <button class="button button-gold" id="private-source-submit">Add Source</button>
      </form>
      <form class="panel" id="private-opportunity-form">
        <h2>Add Manual Private Opportunity</h2>
        <div class="field-row"><div class="field"><label>Company</label><input name="company" required></div><div class="field"><label>Opportunity</label><input name="title" required></div></div>
        <div class="field"><label>Description</label><textarea name="description" required></textarea></div>
        <div class="field-row"><div class="field"><label>Service</label><input name="required_services" placeholder="Rope Access, Glass Cleaning"></div><div class="field"><label>Industry</label><input name="industry" value="Commercial Building Maintenance"></div></div>
        <div class="field-row"><div class="field"><label>Country</label><input name="country" value="India"></div><div class="field"><label>City</label><input name="city"></div></div>
        <div class="field-row"><div class="field"><label>Deadline</label><input name="deadline" type="date"></div><div class="field"><label>Estimated value</label><input name="budget_value" type="number"></div></div>
        <div class="field"><label>Original source link</label><input name="source_url" type="url" required></div>
        <div class="field"><label>Vendor registration link</label><input name="vendor_registration_url" type="url"></div>
        <div class="field"><label>Internal notes</label><textarea name="internal_notes"></textarea></div>
        <button class="button button-gold">Add Opportunity</button>
      </form>
    </div>
    <div class="panel" style="margin-top:20px">
      <div class="section-heading compact"><div><p class="eyebrow">Private source control</p><h2>Sources</h2></div><p>Use only official company portals, public RFQ/RFP pages, vendor registration portals, or permitted public feeds.</p></div>
      <div class="table-wrap dense-table-wrap"><table class="dense-table"><thead><tr><th>Source</th><th>Country</th><th>Industry</th><th>Health</th><th>HTTP</th><th>Imported</th><th>Failures</th><th>Last Sync</th><th>Actions</th></tr></thead><tbody>${privateSourceRows(data.dashboard.sources || [])}</tbody></table></div>
    </div>
    <div class="panel" style="margin-top:20px"><h2>Source Logs</h2><div id="private-source-logs" class="list"><div class="empty compact-empty">Select View Logs on a private source.</div></div></div>
  </section>`;
  document.querySelector('#private-quick-search').onsubmit = (event) => { event.preventDefault(); const query = new URLSearchParams(location.search); query.set('keyword', new FormData(event.currentTarget).get('keyword') || ''); query.set('page','1'); location.href = `${basePath}?${query}`; };
  document.querySelector('#private-filters').onsubmit = (event) => { event.preventDefault(); const query = new URLSearchParams(new FormData(event.currentTarget)); query.set('page_size', params.get('page_size') || '100'); query.set('page','1'); location.href = `${basePath}?${query}`; };
  document.querySelector('#private-prev').onclick = () => { const query = new URLSearchParams(location.search); query.set('page', opportunities.pagination.page - 1); location.href = `${basePath}?${query}`; };
  document.querySelector('#private-next').onclick = () => { const query = new URLSearchParams(location.search); query.set('page', opportunities.pagination.page + 1); location.href = `${basePath}?${query}`; };
  bindDenseTableControls(app);
  const privateSources = data.dashboard.sources || [];
  document.querySelector('#private-source-form').onsubmit = async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const values = Object.fromEntries(new FormData(form));
    try {
      values.headers = parseSourceJson(values.headers, {});
      values.parser_config = parseSourceJson(values.parser_config, {});
      values.is_active = Boolean(form.is_active.checked);
      values.rate_limit_ms = Number(values.rate_limit_ms || 0);
      const editId = form.dataset.editId;
      await api(editId ? `/admin/private-opportunities/sources/${editId}` : '/admin/private-opportunities/sources', { method: editId ? 'PATCH' : 'POST', body: JSON.stringify(values) });
      toast(editId ? 'Private source updated' : 'Private source added'); setTimeout(() => location.reload(), 500);
    } catch (error) { toast(error.message, true); }
  };
  document.querySelector('#private-opportunity-form').onsubmit = async (event) => {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.currentTarget));
    values.required_services = String(values.required_services || '').split(',').map((item) => item.trim()).filter(Boolean);
    values.source_name = 'Manual Private Opportunity';
    values.original_source_url = values.source_url;
    try { await api('/admin/private-opportunities', { method: 'POST', body: JSON.stringify(values) }); toast('Private opportunity added'); setTimeout(() => location.reload(), 500); } catch (error) { toast(error.message, true); }
  };
  document.querySelectorAll('[data-private-test]').forEach((el) => el.onclick = async () => { const result = await api(`/admin/private-opportunities/sources/${el.dataset.privateTest}/test`, { method: 'POST', body: '{}' }); toast(result.ok ? 'Private source verified' : result.message || result.error || 'Source needs mapping', !result.ok); });
  document.querySelectorAll('[data-private-import]').forEach((el) => el.onclick = async () => { try { const result = await api(`/admin/private-opportunities/sources/${el.dataset.privateImport}/import`, { method: 'POST', body: '{}' }); toast(`Import done: ${result.imported} new, ${result.updated} updated, ${result.duplicates_skipped} duplicates`); setTimeout(() => location.reload(), 600); } catch(error) { toast(error.message, true); } });
  document.querySelectorAll('[data-private-edit]').forEach((el) => el.onclick = () => {
    const source = privateSources.find((item) => String(item.id) === String(el.dataset.privateEdit));
    if (!source) return toast('Source not found', true);
    const form = document.querySelector('#private-source-form');
    form.dataset.editId = source.id;
    form.name.value = source.name || '';
    form.source_type.value = source.source_type || 'procurement_portal';
    form.schedule.value = source.schedule || 'hourly';
    form.source_url.value = source.source_url || '';
    form.endpoint_url.value = source.endpoint_url || '';
    form.country.value = source.country || '';
    form.state.value = source.state || '';
    form.city.value = source.city || '';
    form.industry.value = source.industry || '';
    form.api_key_env.value = source.api_key_env || '';
    form.rate_limit_ms.value = source.rate_limit_ms || 0;
    form.headers.value = JSON.stringify(source.headers || {}, null, 2);
    form.parser_config.value = JSON.stringify(source.parser_config || {}, null, 2);
    form.is_active.checked = Boolean(source.is_active);
    document.querySelector('#private-source-submit').textContent = 'Update Source';
    form.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });
  document.querySelectorAll('[data-private-toggle]').forEach((el) => el.onclick = async () => { const active = el.dataset.active !== '1'; await api(`/admin/private-opportunities/sources/${el.dataset.privateToggle}`, { method: 'PATCH', body: JSON.stringify({ is_active: active }) }); toast(active ? 'Private source enabled' : 'Private source disabled'); setTimeout(() => location.reload(), 400); });
  document.querySelectorAll('[data-private-delete-source]').forEach((el) => el.onclick = async () => { if (!confirm('Delete this private source? Opportunities already imported will remain.')) return; await api(`/admin/private-opportunities/sources/${el.dataset.privateDeleteSource}`, { method: 'DELETE' }); toast('Private source deleted'); setTimeout(() => location.reload(), 400); });
  document.querySelectorAll('[data-private-logs]').forEach((el) => el.onclick = async () => { const logs = await api(`/admin/private-opportunities/sources/${el.dataset.privateLogs}/logs`); document.querySelector('#private-source-logs').innerHTML = logs.items.map((log) => `<div class="list-item compact-list-item"><div><h3>${escapeHtml(log.action)} - ${escapeHtml(log.level)}</h3><p>${escapeHtml(log.message)}</p></div><span>${shortDate(log.created_at)}</span></div>`).join('') || '<div class="empty compact-empty">No logs yet.</div>'; });
}

async function renderPrivateOpportunityDetail() {
  if (!(await requireLogin())) return; if(currentUser.role !== 'admin'){app.innerHTML='<section class="page"><div class="empty">Administrator access required.</div></section>';return;}
  const basePath = leadFinderBasePath();
  const { opportunity } = await api(`/admin/private-opportunities/${encodeURIComponent(identifier)}`);
  const originalButton = opportunity.original_source_url ? `<a class="button button-gold" href="${escapeHtml(opportunity.original_source_url)}" target="_blank" rel="noopener noreferrer">Open Original Source</a>` : '';
  const vendorButton = opportunity.vendor_registration_url ? `<a class="button button-outline" href="${escapeHtml(opportunity.vendor_registration_url)}" target="_blank" rel="noopener noreferrer">Vendor Registration</a>` : '';
  app.innerHTML = `<section class="page detail-hero">
    <p class="eyebrow">Private opportunity</p>
    <h1>${escapeHtml(opportunity.title)}</h1>
    <div class="chip-row"><span class="score-pill">${opportunity.match_score}</span><span class="status">${escapeHtml(statusText(opportunity.status))}</span><span class="chip">${escapeHtml(opportunity.company)}</span><span class="chip">${escapeHtml(opportunity.country || 'Worldwide')}</span>${(opportunity.required_services || []).map((service) => `<span class="chip chip-gold">${escapeHtml(service)}</span>`).join('')}</div>
  </section>
  <section class="page detail-grid">
    <div>
      <h2>Opportunity Description</h2>
      <div class="prose">${escapeHtml(opportunity.description)}</div>
      <div class="contract-intel-grid">
        <section class="info-panel contract-intel-card ai-summary-card"><h3>AI Summary</h3><p>${escapeHtml(opportunity.ai_summary || 'No AI summary generated yet.')}</p></section>
        ${listPanel('Required Certifications', opportunity.required_certifications || [])}
        ${listPanel('Required Documents', opportunity.required_documents || [])}
        ${listPanel('Submission Checklist', opportunity.submission_checklist || [])}
        ${listPanel('Recommended Skyproz Services', opportunity.recommended_services || [])}
      </div>
      <section class="ai-panel"><p class="eyebrow">Internal notes</p><h2>Business Development Notes</h2><p>${escapeHtml(opportunity.internal_notes || 'No internal notes added yet.')}</p></section>
    </div>
    <aside class="detail-sidebar">
      <div class="score-panel"><span class="score-ring">${opportunity.match_score}</span><div><strong>${escapeHtml(opportunity.priority)} Priority</strong><p>Win probability: ${escapeHtml(opportunity.win_probability || 'Not assessed')}</p></div></div>
      <div class="info-panel">
        <dl class="info-list">
          <div><dt>Company</dt><dd>${escapeHtml(opportunity.company)}</dd></div>
          <div><dt>Building type</dt><dd>${escapeHtml(opportunity.building_type || 'Not stated')}</dd></div>
          <div><dt>Industry</dt><dd>${escapeHtml(opportunity.industry || 'Not stated')}</dd></div>
          <div><dt>Location</dt><dd>${escapeHtml([opportunity.city, opportunity.state, opportunity.country].filter(Boolean).join(', ') || 'Worldwide')}</dd></div>
          <div><dt>Estimated value</dt><dd>${money(opportunity.budget_value, opportunity.currency)}</dd></div>
          <div><dt>Deadline</dt><dd>${date(opportunity.deadline)}</dd></div>
          <div><dt>Source</dt><dd>${escapeHtml(opportunity.configured_source_name || opportunity.source_name)}</dd></div>
          <div><dt>Last updated</dt><dd>${date(opportunity.updated_at)}</dd></div>
        </dl>
        <div class="toolbar" style="margin-top:22px">${originalButton}${vendorButton}<a class="button button-outline" href="${basePath}">Back</a></div>
      </div>
    </aside>
  </section>`;
}

async function renderAdmin() {
  if (!(await requireLogin())) return; if(currentUser.role!=='admin'){app.innerHTML='<section class="page"><div class="empty">Administrator access required.</div></section>';return;}
  const [analytics,sources,users,connectors,keywords]=await Promise.all([api('/admin/analytics'),api('/admin/sources'),api('/admin/users'),api('/admin/connectors'),api('/admin/bot/keywords')]);
  const bot = analytics.bot || {};
  app.innerHTML=`<section class="page">
    <div class="section-heading"><div><p class="eyebrow">Operations control</p><h1>Admin Panel</h1></div><div class="toolbar"><button class="button button-outline" id="snapshot">Save analytics</button><button class="button button-danger" id="dedupe">Remove duplicates</button></div></div>
    ${dashboardNav()}
    <div class="dense-toolbar sticky-toolbar">
      <div class="toolbar"><button class="button button-gold" id="run-bot">Run AI Bot Now</button>${['hourly','daily','weekly','monthly'].map((job)=>`<button class="button button-ghost" data-run-job="${job}">Run ${job}</button>`).join('')}</div>
    </div>
    <div class="metric-grid dashboard-metrics">
      <div class="metric"><strong>${analytics.contracts || 0}</strong><span>Total Contracts</span></div>
      <div class="metric"><strong>${connectors.summary?.healthy_connectors || 0}</strong><span>Working Connectors</span></div>
      <div class="metric"><strong>${analytics.sources || 0}</strong><span>Active Sources</span></div>
      <div class="metric"><strong>${connectors.summary?.contracts_imported_today || 0}</strong><span>Today's Imports</span></div>
      <div class="metric"><strong>${connectors.summary?.failed_connectors || 0}</strong><span>Failed Imports</span></div>
      <div class="metric"><strong>${bot.latest_run?.high_value_matches || 0}</strong><span>AI Matches</span></div>
    </div>
    <div class="dashboard-dense-grid second-row">
      <div class="panel dense-panel wide-panel"><div class="section-heading compact"><div><p class="eyebrow">Recent contracts</p><h2>Latest</h2></div></div><div class="dense-table-wrap"><table class="dense-table"><thead><tr><th>Score</th><th>Title</th><th>Country</th><th>Priority</th><th>Posted</th></tr></thead><tbody>${recentContractRows(analytics.newest_opportunities)}</tbody></table></div></div>
      <div class="panel dense-panel"><div class="section-heading compact"><div><p class="eyebrow">Connector Health</p><h2>Status</h2></div></div><div class="connector-grid dense-connector-grid mini-connectors">${connectorCards(connectors.connectors, sources.items)}</div></div>
      <div class="panel dense-panel"><div class="section-heading compact"><div><p class="eyebrow">Import Activity</p><h2>Runs</h2></div></div><div class="dense-table-wrap"><table class="dense-table"><thead><tr><th>Connector</th><th>Status</th><th>New</th><th>Upd</th><th>Dup</th><th>Fail</th><th>Time</th><th>Started</th></tr></thead><tbody>${importActivityRows(analytics.recent_imports)}</tbody></table></div></div>
    </div>
    <div class="dashboard-dense-grid third-row">
      <div class="panel dense-panel"><div class="section-heading compact"><div><p class="eyebrow">World Map</p><h2>Coverage</h2></div></div>${countryMap(analytics.top_countries)}</div>
      <div class="panel dense-panel"><div class="section-heading compact"><div><p class="eyebrow">AI Analytics</p><h2>Matches</h2></div></div><div class="metric-grid compact-metrics">${matchDistribution(bot.ai_match_distribution || analytics.ai_match_distribution)}</div><div class="notice">Keywords: ${bot.keywords || 0} | Sources checked: ${bot.latest_run?.sources_checked || 0} | Unread alerts: ${bot.unread_notifications || 0}</div></div>
      <div class="panel dense-panel"><div class="section-heading compact"><div><p class="eyebrow">Source Status</p><h2>Sources</h2></div></div><div class="dense-table-wrap"><table class="dense-table"><thead><tr><th>Source</th><th>Status</th><th>Sync</th><th>Contracts</th></tr></thead><tbody>${sourceStatusRows(sources.items)}</tbody></table></div></div>
    </div>
    <div class="panel dense-panel" style="margin-top:8px"><div class="section-heading compact"><div><p class="eyebrow">Notifications</p><h2>Dashboard Alerts</h2></div></div><div class="list compact-list">${botNotificationList(bot)}</div></div>
    <div class="admin-grid">
      <form class="panel" id="source-form">
        <h2>Add Source</h2>
        <div class="field"><label>Name</label><input name="name" required></div>
        <div class="field"><label>Connector</label><select name="connector_key">${(sources.connectors || connectors.connectors || []).map((connector)=>option(connector.key,'',connector.name)).join('')}</select></div>
        <div class="field"><label>Source URL</label><input name="source_url" type="url" required></div>
        <div class="field"><label>API URL / Feed URL (optional)</label><input name="api_url" type="url"></div>
        <div class="field-row"><div class="field"><label>Country</label><input name="country"></div><div class="field"><label>Region</label><input name="region"></div></div>
        <div class="field-row"><div class="field"><label>Type</label><select name="source_type"><option value="government">Government</option><option value="private">Private</option></select></div><div class="field"><label>Schedule</label><select name="schedule"><option value="daily">Daily</option><option value="hourly">Hourly</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option></select></div></div>
        <div class="field-row"><div class="field"><label>Initial Import Limit</label><input name="initial_import_limit" type="number" min="1" max="1000" value="500"></div><div class="field"><label>Daily Import Limit</label><input name="daily_import_limit" type="number" min="1" max="1000" value="50"></div></div>
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
      <div class="connector-grid dense-connector-grid">${connectorCards(connectors.connectors, sources.items)}</div>
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
      <div class="table-wrap dense-table-wrap"><table class="dense-table"><thead><tr><th>Source</th><th>Type</th><th>Country</th><th>Status</th><th>API</th><th>Feed</th><th>Auth</th><th>Last Sync</th><th>Contracts</th><th>Actions</th></tr></thead><tbody>${sourceRows(sources.items)}</tbody></table></div>
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
  document.querySelectorAll('[data-log-source]').forEach((el)=>el.onclick=()=>{location.href='/contract-finder/admin/connectors';});
  document.querySelector('#keyword-form').onsubmit=async(event)=>{event.preventDefault();const values=Object.fromEntries(new FormData(event.currentTarget));values.weight=Number(values.weight || 8);await api('/admin/bot/keywords',{method:'POST',body:JSON.stringify(values)});toast('Keyword added');setTimeout(()=>location.reload(),350);};
  document.querySelector('#source-form').onsubmit=async(event)=>{event.preventDefault();const values=Object.fromEntries(new FormData(event.currentTarget));values.parser_type='json';values.initial_import_limit=Number(values.initial_import_limit || 500);values.daily_import_limit=Number(values.daily_import_limit || 50);await api('/admin/sources',{method:'POST',body:JSON.stringify(values)});toast('Source added');setTimeout(()=>location.reload(),350);};
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
  const routes={home:renderHome,search:renderSearch,contracts:renderContracts,contract:renderContract,dashboard:renderDashboard,favorites:renderFavorites,saved:renderSaved,alerts:renderAlerts,watchlists:renderWatchlists,admin:renderAdmin,privateOpportunities:renderPrivateOpportunities,privateOpportunity:renderPrivateOpportunityDetail,connectors:renderConnectorManager,sourceDiscovery:renderSourceDiscovery,connectorWizard:renderConnectorWizard,marketplace:renderMarketplace,login:renderLogin,'not-found':renderNotFound};
  try { await (routes[page]||renderNotFound)(); } catch(error){ console.error(error); app.innerHTML=`<section class="page"><div class="empty error"><h2>Unable to load this page</h2><p>${escapeHtml(error.message)}</p></div></section>`; }
}

init();
