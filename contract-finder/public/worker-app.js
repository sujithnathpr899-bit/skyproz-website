const API = '/api/workers';
const app = document.querySelector('#worker-app');
const page = app.dataset.page;
const identifier = app.dataset.identifier;
const toastBox = document.querySelector('#worker-toast');
let currentWorker = null;
let options = { skills: [], document_types: [] };

const escapeHtml = (value) => String(value ?? '').replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]);
const money = (min, max, currency = 'USD') => min || max ? `${currency} ${Number(min || 0).toLocaleString()}${max ? ` - ${Number(max).toLocaleString()}` : '+'}` : 'Salary on request';
const dateText = (value) => value ? new Intl.DateTimeFormat('en', { dateStyle: 'medium' }).format(new Date(value)) : 'Not stated';

async function api(path, options = {}) {
  const response = await fetch(`${API}${path}`, { ...options, headers: { 'content-type': 'application/json', ...(options.headers || {}) } });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `Request failed (${response.status})`);
  return payload;
}

function toast(message, isError = false) {
  toastBox.textContent = message;
  toastBox.className = isError ? 'show error' : 'show';
  setTimeout(() => { toastBox.className = ''; }, 3200);
}

function button(label, href, variant = 'button-outline') {
  return `<a class="button ${variant}" href="${href}">${escapeHtml(label)}</a>`;
}

function option(value, selected = '', label = value) {
  return `<option value="${escapeHtml(value)}" ${String(value) === String(selected || '') ? 'selected' : ''}>${escapeHtml(label)}</option>`;
}

function field(name, label, value = '', type = 'text', attrs = '') {
  return `<div class="field"><label for="${name}">${escapeHtml(label)}</label><input id="${name}" name="${name}" type="${type}" value="${escapeHtml(value)}" ${attrs}></div>`;
}

function skillChecks(selected = []) {
  return `<div class="skill-grid">${options.skills.map((skill) => `<label><input type="checkbox" name="skills" value="${escapeHtml(skill)}" ${selected.includes(skill) ? 'checked' : ''}> ${escapeHtml(skill)}</label>`).join('')}</div>`;
}

function collectForm(form) {
  const data = Object.fromEntries(new FormData(form));
  data.skills = [...form.querySelectorAll('[name="skills"]:checked')].map((item) => item.value);
  if (data.preferred_countries) data.preferred_countries = String(data.preferred_countries).split(',').map((item) => item.trim()).filter(Boolean);
  return data;
}

function requireWorkerPage() {
  if (!currentWorker) { location.href = '/workers/login'; return false; }
  return true;
}

function workerNavState() {
  document.querySelector('.worker-menu')?.addEventListener('click', () => {
    const nav = document.querySelector('.worker-nav');
    const open = nav.classList.toggle('open');
    document.querySelector('.worker-menu').setAttribute('aria-expanded', String(open));
  });
}

function renderWorkerAccountNavigation() {
  const account = document.querySelector('[data-worker-account]');
  if (!account) return;
  if (!currentWorker) {
    account.innerHTML = '<a class="button button-gold worker-account-cta" href="/workers/signup">Join Our Workforce</a>';
    return;
  }
  const name = escapeHtml(currentWorker.full_name || 'My Dashboard');
  account.innerHTML = `<div class="worker-account-dropdown">
    <button class="button button-gold worker-account-toggle" type="button" aria-expanded="false">My Dashboard</button>
    <div class="worker-account-menu" role="menu" aria-label="Worker account menu">
      <a href="/workers/dashboard" role="menuitem">Dashboard</a>
      <a href="/workers/profile" role="menuitem">My Profile</a>
      <a href="/workers/dashboard#applications" role="menuitem">My Applications</a>
      <a href="/workers/dashboard#saved-jobs" role="menuitem">Saved Jobs</a>
      <a href="/workers/dashboard#messages" role="menuitem">Messages</a>
      <button type="button" data-worker-logout role="menuitem">Logout</button>
    </div>
    <span class="worker-account-name">${name}</span>
  </div>`;
  const dropdown = account.querySelector('.worker-account-dropdown');
  const toggle = account.querySelector('.worker-account-toggle');
  toggle?.addEventListener('click', (event) => {
    event.stopPropagation();
    const open = dropdown.classList.toggle('is-open');
    toggle.setAttribute('aria-expanded', String(open));
  });
  document.addEventListener('click', () => {
    dropdown?.classList.remove('is-open');
    toggle?.setAttribute('aria-expanded', 'false');
  });
  account.querySelector('[data-worker-logout]')?.addEventListener('click', async () => {
    await api('/auth/logout', { method: 'POST', body: '{}' });
    location.href = '/workers/login';
  });
}

function jobCard(job) {
  return `<article class="job-card">
    <div class="job-card-top"><span class="status">${escapeHtml(job.status)}</span><span>${dateText(job.posted_at)}</span></div>
    <h3><a href="/workers/jobs/${encodeURIComponent(job.slug)}">${escapeHtml(job.title)}</a></h3>
    <p>${escapeHtml(job.description).slice(0, 170)}${job.description.length > 170 ? '...' : ''}</p>
    <div class="chip-row"><span>${escapeHtml(job.country)}</span><span>${escapeHtml(job.industry)}</span><span>${escapeHtml(job.trade)}</span><span>${escapeHtml(job.job_type)}</span></div>
    <div class="job-meta"><strong>${money(job.salary_min, job.salary_max, job.currency)}</strong><span>${escapeHtml(job.company)}</span><span>${job.experience_required}+ yrs</span></div>
    <div class="toolbar"><a class="button button-gold" href="/workers/jobs/${encodeURIComponent(job.slug)}">View Details</a>${currentWorker ? `<button class="button button-outline" data-save-job="${job.id}">${job.is_saved ? 'Saved' : 'Save'}</button><button class="button button-outline" data-apply-job="${job.id}">${job.application_status ? `Applied: ${job.application_status}` : 'Apply'}</button>` : button('Login to Apply', '/workers/login')}</div>
  </article>`;
}

function bindJobActions(root = document) {
  root.querySelectorAll('[data-save-job]').forEach((button) => {
    button.onclick = async () => {
      try { await api(`/jobs/${button.dataset.saveJob}/save`, { method: 'POST', body: '{}' }); button.textContent = 'Saved'; toast('Job saved'); }
      catch (error) { toast(error.message, true); }
    };
  });
  root.querySelectorAll('[data-apply-job]').forEach((button) => {
    button.onclick = async () => {
      try { await api(`/jobs/${button.dataset.applyJob}/apply`, { method: 'POST', body: JSON.stringify({ cover_note: 'Interested and available for review.' }) }); button.textContent = 'Applied: submitted'; toast('Application submitted'); }
      catch (error) { toast(error.message, true); }
    };
  });
}

async function renderOpportunities() {
  const params = new URLSearchParams(location.search);
  const [jobs, filterOptions] = await Promise.all([api(`/jobs?${params}`), api('/options')]);
  options = filterOptions;
  app.innerHTML = `<section class="worker-hero"><div><p class="eyebrow">Global worker opportunities</p><h1>Find industrial work worldwide.</h1><p>Build your Skyproz profile, upload documents, and apply for international rope access, offshore, marine, wind, construction and industrial jobs.</p><div class="toolbar">${button('Worker Sign Up','/workers/signup','button-gold')}${button('Worker Login','/workers/login')}</div></div>
    <form id="job-search" class="glass-panel search-panel"><h2>Search Jobs</h2>${field('keyword','Keyword',params.get('keyword') || '')}<div class="field-row"><div class="field"><label>Country</label><select name="country"><option value="">All countries</option>${options.countries.map((value) => option(value, params.get('country'))).join('')}</select></div><div class="field"><label>Trade</label><select name="trade"><option value="">All trades</option>${options.trades.map((value) => option(value, params.get('trade'))).join('')}</select></div></div><div class="field-row"><div class="field"><label>Industry</label><select name="industry"><option value="">All industries</option>${options.industries.map((value) => option(value, params.get('industry'))).join('')}</select></div><div class="field"><label>Job Type</label><select name="job_type"><option value="">All types</option>${options.job_types.map((value) => option(value, params.get('job_type'))).join('')}</select></div></div><div class="field-row">${field('company','Company',params.get('company') || '')}${field('experience','Max Experience Required',params.get('experience') || '', 'number')}</div><button class="button button-gold">Search Opportunities</button></form></section>
  <section class="page-section"><div class="section-heading"><div><p class="eyebrow">${jobs.pagination.total} active jobs</p><h2>Available Opportunities</h2></div><p>Use filters to narrow by country, industry, trade, company, salary and experience.</p></div><div class="job-grid">${jobs.items.map(jobCard).join('') || '<div class="empty">No matching jobs found.</div>'}</div></section>`;
  document.querySelector('#job-search').onsubmit = (event) => { event.preventDefault(); location.href = `/workers?${new URLSearchParams(new FormData(event.currentTarget))}`; };
  bindJobActions(app);
}

async function renderSignup() {
  options = await api('/options');
  app.innerHTML = `<section class="auth-layout signup-page">
    <div class="signup-shell">
      <header class="signup-intro">
        <p class="eyebrow">Worker registration</p>
        <h1>Join Our Workforce</h1>
        <p>Create your professional worker profile and connect with employers worldwide.</p>
        <div class="signup-steps" aria-label="Worker signup steps">
          <span><strong>1</strong>Create an account</span>
          <span><strong>2</strong>Log in anytime</span>
          <span><strong>3</strong>Browse available jobs</span>
          <span><strong>4</strong>Access your dashboard</span>
        </div>
      </header>
      <form id="signup-form" class="glass-panel auth-card wide">
        <h2>Worker Registration Form</h2>
        <div class="form-grid">${field('full_name','Full Name','','text','required')}${field('mobile_number','Mobile Number','','tel','required')}${field('email','Email','','email','required')}${field('country','Country','','text','required')}${field('nationality','Nationality','','text','required')}${field('current_location','Current Location','','text','required')}${field('date_of_birth','Date of Birth','','date','required')}${field('passport_number','Passport Number (optional)')}${field('trade_profession','Trade / Profession','','text','required')}${field('years_experience','Years of Experience','0','number','min="0" required')}${field('highest_qualification','Highest Qualification','','text','required')}${field('preferred_salary','Preferred Salary')}${field('password','Password','','password','minlength="10" required')}${field('confirm_password','Confirm Password','','password','minlength="10" required')}</div>
        <div class="field"><label>Skills</label>${skillChecks()}</div>
        <button class="button button-gold">Create Account</button>
      </form>
      <section class="glass-panel signup-quick-links" aria-labelledby="worker-quick-links-title">
        <p class="eyebrow">Quick Links</p>
        <h2 id="worker-quick-links-title">Need another path?</h2>
        <div class="quick-link-grid">
          <a class="quick-link-card" href="/workers/login"><span>Already have an account?</span><strong>Worker Login</strong></a>
          <a class="quick-link-card" href="/workers/opportunities"><span>Looking for available jobs?</span><strong>Browse Available Jobs</strong></a>
        </div>
      </section>
    </div>
  </section>`;
  document.querySelector('#signup-form').onsubmit = async (event) => { event.preventDefault(); try { await api('/auth/register', { method: 'POST', body: JSON.stringify(collectForm(event.currentTarget)) }); location.href = '/workers/dashboard'; } catch (error) { toast(error.message, true); } };
}

function renderLogin() {
  app.innerHTML = `<section class="auth-layout"><form id="login-form" class="glass-panel auth-card"><p class="eyebrow">Worker access</p><h1>Worker Login</h1>${field('email','Email','','email','required')}${field('password','Password','','password','required')}<button class="button button-gold">Sign In</button><p class="helper">New to Skyproz? <a href="/workers/signup">Create your worker profile</a></p></form></section>`;
  document.querySelector('#login-form').onsubmit = async (event) => { event.preventDefault(); try { await api('/auth/login', { method: 'POST', body: JSON.stringify(Object.fromEntries(new FormData(event.currentTarget))) }); location.href = '/workers/dashboard'; } catch (error) { toast(error.message, true); } };
}

function documentRows(documents = []) {
  return documents.map((doc) => `<tr><td>${escapeHtml(doc.document_type)}</td><td>${escapeHtml(doc.original_filename)}</td><td>${Math.round(doc.size_bytes / 1024)} KB</td><td><span class="status">${escapeHtml(doc.status)}</span></td><td>${dateText(doc.uploaded_at)}</td></tr>`).join('') || '<tr><td colspan="5" class="empty-row">No documents uploaded yet.</td></tr>';
}

async function fileToBase64(file) {
  return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1]); reader.onerror = reject; reader.readAsDataURL(file); });
}

async function renderDashboard() {
  if (!requireWorkerPage()) return;
  const data = await api('/dashboard');
  app.innerHTML = `<section class="page-section dashboard-page"><div class="section-heading"><div><p class="eyebrow">My Dashboard</p><h1>Welcome, ${escapeHtml(data.worker.full_name)}</h1></div><div class="toolbar">${button('Edit Profile','/workers/profile','button-gold')}<button class="button button-outline" id="logout">Logout</button></div></div><div class="metric-grid"><div class="metric"><strong>${data.worker.profile_completion}%</strong><span>Profile Completion</span></div><div class="metric"><strong>${data.counts.saved_jobs}</strong><span>Saved Jobs</span></div><div class="metric"><strong>${data.counts.applied_jobs}</strong><span>Applied Jobs</span></div><div class="metric"><strong>${data.counts.interview_invitations}</strong><span>Interview Invitations</span></div><div class="metric" id="messages"><strong>${data.counts.messages}</strong><span>Messages</span></div><div class="metric"><strong>${data.counts.notifications}</strong><span>Notifications</span></div></div><div class="dashboard-grid"><section class="glass-panel"><h2>Uploaded Documents</h2><div class="table-wrap"><table><thead><tr><th>Type</th><th>File</th><th>Size</th><th>Status</th><th>Uploaded</th></tr></thead><tbody>${documentRows(data.documents)}</tbody></table></div></section><form id="document-form" class="glass-panel"><h2>Upload Certificate</h2><div class="field"><label>Document Type</label><select name="document_type" required>${options.document_types.map((type) => option(type)).join('')}</select></div><div class="field"><label>File</label><input name="file" type="file" accept=".pdf,.doc,.docx,.jpg,.jpeg,.png" required></div><button class="button button-gold">Upload Document</button><p class="helper">PDF, DOC, DOCX, JPG or PNG. Max 5 MB.</p></form><section class="glass-panel" id="applications"><h2>Applications</h2><div class="list">${data.applications.map((item) => `<div class="list-item"><div><strong>${escapeHtml(item.title)}</strong><span>${escapeHtml(item.company)} | ${escapeHtml(item.country)}</span></div><span class="status">${escapeHtml(item.status)}</span></div>`).join('') || '<div class="empty compact">No applications yet.</div>'}</div></section><section class="glass-panel" id="saved-jobs"><h2>Saved Jobs</h2><div class="list">${data.saved_jobs.map((job) => `<a class="list-item" href="/workers/jobs/${job.slug}"><div><strong>${escapeHtml(job.title)}</strong><span>${escapeHtml(job.company)} | ${escapeHtml(job.country)}</span></div><span>${escapeHtml(job.trade)}</span></a>`).join('') || '<div class="empty compact">No saved jobs yet.</div>'}</div></section></div></section>`;
  document.querySelector('#logout').onclick = async () => { await api('/auth/logout', { method: 'POST', body: '{}' }); location.href = '/workers/login'; };
  document.querySelector('#document-form').onsubmit = async (event) => { event.preventDefault(); const form = event.currentTarget; const file = form.file.files[0]; try { await api('/documents', { method: 'POST', body: JSON.stringify({ document_type: form.document_type.value, filename: file.name, content_type: file.type, content_base64: await fileToBase64(file) }) }); toast('Document uploaded for review'); setTimeout(() => location.reload(), 500); } catch (error) { toast(error.message, true); } };
}

async function renderProfile() {
  if (!requireWorkerPage()) return;
  options = await api('/options');
  const { worker } = await api('/profile');
  app.innerHTML = `<section class="auth-layout"><form id="profile-form" class="glass-panel auth-card wide"><p class="eyebrow">Worker profile</p><h1>Edit Profile</h1><div class="form-grid">${field('full_name','Full Name',worker.full_name,'text','required')}${field('mobile_number','Mobile Number',worker.mobile_number,'tel','required')}${field('country','Country',worker.country,'text','required')}${field('nationality','Nationality',worker.nationality,'text','required')}${field('current_location','Current Location',worker.current_location,'text','required')}${field('date_of_birth','Date of Birth',worker.date_of_birth,'date','required')}${field('passport_number','Passport Number',worker.passport_number || '')}${field('trade_profession','Trade / Profession',worker.trade_profession,'text','required')}${field('years_experience','Years of Experience',worker.years_experience,'number','min="0" required')}${field('highest_qualification','Highest Qualification',worker.highest_qualification,'text','required')}${field('availability','Availability',worker.availability)}${field('preferred_salary','Preferred Salary',worker.preferred_salary || '')}</div><div class="field"><label>Preferred Countries</label><input name="preferred_countries" value="${escapeHtml((worker.preferred_countries || []).join(', '))}" placeholder="UAE, Qatar, Saudi Arabia"></div><div class="field"><label>Skills</label>${skillChecks(worker.skills || [])}</div><button class="button button-gold">Save Profile</button></form></section>`;
  document.querySelector('#profile-form').onsubmit = async (event) => { event.preventDefault(); try { await api('/profile', { method: 'PATCH', body: JSON.stringify(collectForm(event.currentTarget)) }); toast('Profile updated'); } catch (error) { toast(error.message, true); } };
}

async function renderJobDetail() {
  const { job } = await api(`/jobs/${encodeURIComponent(identifier)}`);
  app.innerHTML = `<section class="page-section job-detail"><p class="eyebrow">${escapeHtml(job.company)} | ${escapeHtml(job.country)}</p><h1>${escapeHtml(job.title)}</h1><div class="chip-row"><span>${escapeHtml(job.industry)}</span><span>${escapeHtml(job.trade)}</span><span>${escapeHtml(job.job_type)}</span><span>${job.experience_required}+ years</span></div><div class="detail-grid"><article class="glass-panel"><h2>Job Details</h2><p>${escapeHtml(job.description)}</p><h3>Requirements</h3><ul>${job.requirements.map((item) => `<li>${escapeHtml(item)}</li>`).join('') || '<li>Requirements will be confirmed during review.</li>'}</ul></article><aside class="glass-panel"><h2>Opportunity Summary</h2><dl><div><dt>Salary</dt><dd>${money(job.salary_min, job.salary_max, job.currency)}</dd></div><div><dt>Deadline</dt><dd>${dateText(job.deadline)}</dd></div><div><dt>Status</dt><dd>${escapeHtml(job.application_status || 'Not applied')}</dd></div></dl><div class="toolbar">${currentWorker ? `<button class="button button-gold" data-apply-job="${job.id}">Apply</button><button class="button button-outline" data-save-job="${job.id}">Save Job</button>` : button('Login to Apply','/workers/login','button-gold')}</div></aside></div></section>`;
  bindJobActions(app);
}

async function renderAdmin() {
  const data = await api('/admin/workers');
  app.innerHTML = `<section class="page-section"><div class="section-heading"><div><p class="eyebrow">Worker admin</p><h1>Worker Management</h1></div><div class="toolbar"><a class="button button-gold" href="/api/workers/admin/export">Export CSV</a></div></div><div class="glass-panel"><div class="table-wrap"><table><thead><tr><th>Name</th><th>Email</th><th>Country</th><th>Trade</th><th>Experience</th><th>Completion</th><th>Status</th><th>Verified</th><th>Actions</th></tr></thead><tbody>${data.items.map((worker) => `<tr><td>${escapeHtml(worker.full_name)}</td><td>${escapeHtml(worker.email)}</td><td>${escapeHtml(worker.country)}</td><td>${escapeHtml(worker.trade_profession)}</td><td>${worker.years_experience}</td><td>${worker.profile_completion}%</td><td>${escapeHtml(worker.status)}</td><td>${worker.profile_verified ? 'Yes' : 'No'}</td><td><button class="button button-outline" data-verify-worker="${worker.id}">Verify</button><button class="button button-outline" data-suspend-worker="${worker.id}">Suspend</button></td></tr>`).join('') || '<tr><td colspan="9" class="empty-row">No workers yet.</td></tr>'}</tbody></table></div></div></section>`;
  document.querySelectorAll('[data-verify-worker]').forEach((button) => button.onclick = async () => { await api(`/admin/workers/${button.dataset.verifyWorker}`, { method: 'PATCH', body: JSON.stringify({ profile_verified: true }) }); toast('Worker verified'); setTimeout(() => location.reload(), 500); });
  document.querySelectorAll('[data-suspend-worker]').forEach((button) => button.onclick = async () => { await api(`/admin/workers/${button.dataset.suspendWorker}`, { method: 'PATCH', body: JSON.stringify({ status: 'suspended' }) }); toast('Worker suspended'); setTimeout(() => location.reload(), 500); });
}

function renderNotFound() { app.innerHTML = `<section class="page-section"><div class="empty"><h1>Worker page not found</h1>${button('Find Opportunities','/workers','button-gold')}</div></section>`; }

async function init() {
  workerNavState();
  try { currentWorker = (await api('/auth/me')).worker; } catch { currentWorker = null; }
  renderWorkerAccountNavigation();
  try { options = await api('/options'); } catch { options = { skills: [], document_types: [] }; }
  const routes = { opportunities: renderOpportunities, login: renderLogin, signup: renderSignup, dashboard: renderDashboard, profile: renderProfile, job: renderJobDetail, admin: renderAdmin, notFound: renderNotFound };
  try { await (routes[page] || renderNotFound)(); } catch (error) { app.innerHTML = `<section class="page-section"><div class="empty error"><h1>Unable to load Worker Portal</h1><p>${escapeHtml(error.message)}</p></div></section>`; }
}

init();
