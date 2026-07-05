const API = '/api/workers';
const app = document.querySelector('#worker-app');
const page = app.dataset.page;
const identifier = app.dataset.identifier;
const toastBox = document.querySelector('#worker-toast');
let currentWorker = null;
let options = { skills: [], document_types: [], availability_options: [] };

const escapeHtml = (value) => String(value ?? '').replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]);
const money = (min, max, currency = 'USD') => min || max ? `${currency} ${Number(min || 0).toLocaleString()}${max ? ` - ${Number(max).toLocaleString()}` : '+'}` : 'Salary on request';
const dateText = (value) => value ? new Intl.DateTimeFormat('en', { dateStyle: 'medium' }).format(new Date(value)) : 'Not stated';
const statusLabel = (status) => ({ submitted: 'Applied', viewed: 'Viewed', shortlisted: 'Shortlisted', interview: 'Interview', offer: 'Offer', rejected: 'Rejected', withdrawn: 'Withdrawn' })[status] || status || 'Pending';

async function api(path, options = {}) {
  const response = await fetch(`${API}${path}`, { ...options, headers: { 'content-type': 'application/json', ...(options.headers || {}) } });
  const contentType = response.headers.get('content-type') || '';
  const payload = contentType.includes('application/json') ? await response.json().catch(() => ({})) : {};
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

function textareaField(name, label, value = '', attrs = '') {
  return `<div class="field"><label for="${name}">${escapeHtml(label)}</label><textarea id="${name}" name="${name}" rows="4" ${attrs}>${escapeHtml(value)}</textarea></div>`;
}

function selectField(name, label, values = [], selected = '', attrs = '') {
  return `<div class="field"><label for="${name}">${escapeHtml(label)}</label><select id="${name}" name="${name}" ${attrs}>${values.map((value) => option(value, selected)).join('')}</select></div>`;
}

function skillChecks(selected = []) {
  return `<div class="skill-grid">${options.skills.map((skill) => `<label><input type="checkbox" name="skills" value="${escapeHtml(skill)}" ${selected.includes(skill) ? 'checked' : ''}> ${escapeHtml(skill)}</label>`).join('')}</div>`;
}

function collectForm(form) {
  const data = Object.fromEntries(new FormData(form));
  data.skills = [...form.querySelectorAll('[name="skills"]:checked')].map((item) => item.value);
  if (data.preferred_countries) data.preferred_countries = String(data.preferred_countries).split(',').map((item) => item.trim()).filter(Boolean);
  if (data.languages) data.languages = String(data.languages).split(',').map((item) => item.trim()).filter(Boolean);
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
      <a href="/workers/applications" role="menuitem">My Applications</a>
      <a href="/workers/saved-jobs" role="menuitem">Saved Jobs</a>
      <a href="/workers/notifications" role="menuitem">Messages</a>
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

function pageToolbar(active = '') {
  const links = [
    ['Dashboard', '/workers/dashboard'], ['Profile', '/workers/profile'], ['Resume', '/workers/resume'], ['Documents', '/workers/documents'],
    ['Skills', '/workers/skills'], ['Applications', '/workers/applications'], ['Saved Jobs', '/workers/saved-jobs'],
    ['Alerts', '/workers/job-alerts'], ['Interviews', '/workers/interviews'], ['Analytics', '/workers/analytics'],
    ['Subscription', '/workers/subscription'], ['Notifications', '/workers/notifications'], ['Settings', '/workers/settings']
  ];
  return `<nav class="portal-tabs" aria-label="Worker dashboard sections">${links.map(([label, href]) => `<a class="${active === label ? 'active' : ''}" href="${href}">${label}</a>`).join('')}</nav>`;
}

function completionWidget(worker) {
  const details = worker.profile_completion_details || { percent: worker.profile_completion || 0, sections: [], missing_sections: [] };
  return `<section class="glass-panel profile-completion"><div class="completion-ring" style="--progress:${details.percent}%"><strong>${details.percent}%</strong><span>Complete</span></div><div><h2>Profile Completion</h2><p>${escapeHtml(details.message || 'Complete your profile to improve your chances of getting hired.')}</p><div class="completion-checks">${(details.sections || []).map((section) => `<span class="${section.complete ? 'done' : ''}">${section.complete ? 'Done' : 'Missing'} ${escapeHtml(section.label)}</span>`).join('')}</div></div></section>`;
}

function verificationBadges(worker) {
  const badges = worker.verification_badges || [];
  return `<div class="badge-grid">${badges.map((badge) => `<span class="verify-badge ${badge.verified ? 'verified' : ''}">${badge.verified ? 'Verified' : 'Pending'} ${escapeHtml(badge.label)}</span>`).join('')}</div>`;
}

function jobCard(job) {
  return `<article class="job-card">
    <div class="job-card-top"><span class="status">${escapeHtml(job.status)}</span><span>${dateText(job.posted_at)}</span></div>
    <h3><a href="/workers/jobs/${encodeURIComponent(job.slug)}">${escapeHtml(job.title)}</a></h3>
    <p>${escapeHtml(job.description).slice(0, 170)}${job.description.length > 170 ? '...' : ''}</p>
    <div class="chip-row"><span>${escapeHtml(job.country)}</span><span>${escapeHtml(job.industry)}</span><span>${escapeHtml(job.trade)}</span><span>${escapeHtml(job.job_type)}</span></div>
    <div class="job-meta"><strong>${money(job.salary_min, job.salary_max, job.currency)}</strong><span>${escapeHtml(job.company)}</span><span>${job.experience_required}+ yrs</span></div>
    <div class="toolbar"><a class="button button-gold" href="/workers/jobs/${encodeURIComponent(job.slug)}">View Details</a>${currentWorker ? `${job.is_saved ? `<button class="button button-outline" data-unsave-job="${job.id}">Remove</button>` : `<button class="button button-outline" data-save-job="${job.id}">Save</button>`}<button class="button button-outline" data-apply-job="${job.id}">${job.application_status ? `Applied: ${statusLabel(job.application_status)}` : 'Apply'}</button>` : button('Login to Apply', '/workers/login')}</div>
  </article>`;
}
function bindJobActions(root = document) {
  root.querySelectorAll('[data-save-job]').forEach((button) => {
    button.onclick = async () => {
      try { await api(`/jobs/${button.dataset.saveJob}/save`, { method: 'POST', body: '{}' }); button.textContent = 'Saved'; toast('Job saved'); }
      catch (error) { toast(error.message, true); }
    };
  });
  root.querySelectorAll('[data-unsave-job]').forEach((button) => {
    button.onclick = async () => {
      try { await api(`/jobs/${button.dataset.unsaveJob}/save`, { method: 'DELETE' }); toast('Saved job removed'); setTimeout(() => location.reload(), 350); }
      catch (error) { toast(error.message, true); }
    };
  });
  root.querySelectorAll('[data-apply-job]').forEach((button) => {
    button.onclick = async () => {
      try { await api(`/jobs/${button.dataset.applyJob}/apply`, { method: 'POST', body: JSON.stringify({ cover_note: 'Interested and available for review.' }) }); button.textContent = 'Applied'; toast('Application submitted'); }
      catch (error) { toast(error.message, true); }
    };
  });
}

function documentRows(documents = []) {
  return documents.map((doc) => `<tr><td>${escapeHtml(doc.document_name || doc.document_type)}</td><td>${escapeHtml(doc.document_type)}</td><td>${escapeHtml(doc.original_filename)}</td><td>${Math.round(doc.size_bytes / 1024)} KB</td><td><span class="status">${escapeHtml(doc.status)}</span></td><td>${dateText(doc.expiry_date)}</td><td>${dateText(doc.uploaded_at)}</td><td class="document-actions"><a class="button button-outline" href="${escapeHtml(doc.download_url)}">Download</a><button class="button button-outline" data-replace-document="${doc.id}">Replace</button><button class="button button-outline" data-delete-document="${doc.id}">Delete</button></td></tr>`).join('') || '<tr><td colspan="8" class="empty-row">No documents uploaded yet.</td></tr>';
}

async function fileToBase64(file) {
  return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1]); reader.onerror = reject; reader.readAsDataURL(file); });
}

async function uploadDocumentPayload(form) {
  const file = form.file.files[0];
  return {
    document_type: form.document_type.value,
    document_name: form.document_name?.value || form.document_type.value,
    expiry_date: form.expiry_date?.value || '',
    filename: file.name,
    content_type: file.type,
    content_base64: await fileToBase64(file)
  };
}

function bindDocumentUpload(form, path = '/documents') {
  form.onsubmit = async (event) => {
    event.preventDefault();
    try {
      await api(path, { method: 'POST', body: JSON.stringify(await uploadDocumentPayload(form)) });
      toast('Document uploaded for review');
      setTimeout(() => location.reload(), 500);
    } catch (error) { toast(error.message, true); }
  };
}

function documentUploadForm(title = 'Upload Document') {
  return `<form id="document-form" class="glass-panel"><h2>${escapeHtml(title)}</h2>${field('document_name','Document Name')}
    <div class="field"><label>Document Type</label><select name="document_type" required>${options.document_types.map((type) => option(type)).join('')}</select></div>
    ${field('expiry_date','Expiry Date','','date')}
    <div class="field"><label>File</label><input name="file" type="file" accept=".pdf,.doc,.docx,.jpg,.jpeg,.png" required></div>
    <button class="button button-gold">Upload Document</button><p class="helper">PDF, DOC, DOCX, JPG or PNG. Max 5 MB.</p></form>`;
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
  app.innerHTML = `<section class="auth-layout signup-page"><div class="signup-shell"><header class="signup-intro"><p class="eyebrow">Worker registration</p><h1>Join Our Workforce</h1><p>Create your professional worker profile and connect with employers worldwide.</p><div class="signup-steps" aria-label="Worker signup steps"><span><strong>1</strong>Create an account</span><span><strong>2</strong>Log in anytime</span><span><strong>3</strong>Browse available jobs</span><span><strong>4</strong>Access your dashboard</span></div></header>
    <form id="signup-form" class="glass-panel auth-card wide"><h2>Worker Registration Form</h2><div class="form-grid">${field('full_name','Full Name','','text','required')}${field('mobile_number','Mobile Number','','tel','required')}${field('email','Email','','email','required')}${field('country','Country','','text','required')}${field('nationality','Nationality','','text','required')}${field('current_location','Current Location','','text','required')}${field('date_of_birth','Date of Birth','','date','required')}${field('passport_number','Passport Number (optional)')}${field('trade_profession','Trade / Profession','','text','required')}${field('years_experience','Years of Experience','0','number','min="0" required')}${field('highest_qualification','Highest Qualification','','text','required')}${field('professional_title','Professional Title')}${field('preferred_salary','Preferred Salary')}${field('password','Password','','password','minlength="10" required')}${field('confirm_password','Confirm Password','','password','minlength="10" required')}</div><div class="field"><label>Skills</label>${skillChecks()}</div><button class="button button-gold">Create Account</button></form>
    <section class="glass-panel signup-quick-links" aria-labelledby="worker-quick-links-title"><p class="eyebrow">Quick Links</p><h2 id="worker-quick-links-title">Need another path?</h2><div class="quick-link-grid"><a class="quick-link-card" href="/workers/login"><span>Already have an account?</span><strong>Worker Login</strong></a><a class="quick-link-card" href="/workers/opportunities"><span>Looking for available jobs?</span><strong>Browse Available Jobs</strong></a></div></section></div></section>`;
  document.querySelector('#signup-form').onsubmit = async (event) => { event.preventDefault(); try { await api('/auth/register', { method: 'POST', body: JSON.stringify(collectForm(event.currentTarget)) }); location.href = '/workers/dashboard'; } catch (error) { toast(error.message, true); } };
}

function renderLogin() {
  app.innerHTML = `<section class="auth-layout"><form id="login-form" class="glass-panel auth-card"><p class="eyebrow">Worker access</p><h1>Worker Login</h1>${field('email','Email','','email','required')}${field('password','Password','','password','required')}<button class="button button-gold">Sign In</button><p class="helper">New to Skyproz? <a href="/workers/signup">Create your worker profile</a></p></form></section>`;
  document.querySelector('#login-form').onsubmit = async (event) => { event.preventDefault(); try { await api('/auth/login', { method: 'POST', body: JSON.stringify(Object.fromEntries(new FormData(event.currentTarget))) }); location.href = '/workers/dashboard'; } catch (error) { toast(error.message, true); } };
}
async function renderDashboard() {
  if (!requireWorkerPage()) return;
  const data = await api('/dashboard');
  app.innerHTML = `<section class="page-section dashboard-page">${pageToolbar('Dashboard')}<div class="section-heading"><div><p class="eyebrow">My Dashboard</p><h1>Welcome, ${escapeHtml(data.worker.full_name)}</h1></div><div class="toolbar">${button('Edit Profile','/workers/profile','button-gold')}<button class="button button-outline" id="logout">Logout</button></div></div>${completionWidget(data.worker)}<div class="metric-grid"><div class="metric"><strong>${data.worker.profile_completion}%</strong><span>Profile Completion</span></div><div class="metric"><strong>${data.counts.saved_jobs}</strong><span>Saved Jobs</span></div><div class="metric"><strong>${data.counts.applied_jobs}</strong><span>Applied Jobs</span></div><div class="metric"><strong>${data.counts.interview_invitations}</strong><span>Interview Invitations</span></div><div class="metric"><strong>${data.counts.messages}</strong><span>Messages</span></div><div class="metric"><strong>${data.counts.notifications}</strong><span>Notifications</span></div><div class="metric"><strong>${data.counts.interviews || 0}</strong><span>Interviews</span></div><div class="metric"><strong>${data.counts.certificates || 0}</strong><span>Certificates</span></div><div class="metric"><strong>${data.counts.profile_views || 0}</strong><span>Profile Views</span></div></div><div class="dashboard-grid"><section class="glass-panel"><h2>Verification Badges</h2>${verificationBadges(data.worker)}</section><section class="glass-panel"><h2>Quick Actions</h2><div class="quick-stack">${button('Upload Documents','/workers/documents','button-gold')}${button('Resume Builder','/workers/resume')}${button('Job Alerts','/workers/job-alerts')}${button('Interviews','/workers/interviews')}${button('Analytics','/workers/analytics')}${button('Account Settings','/workers/settings')}</div></section><section class="glass-panel"><h2>Recent Applications</h2><div class="list">${data.applications.map(applicationItem).join('') || '<div class="empty compact">No applications yet.</div>'}</div></section><section class="glass-panel"><h2>Recent Notifications</h2><div class="list">${data.notifications.map(notificationItem).join('') || '<div class="empty compact">No notifications yet.</div>'}</div></section><section class="glass-panel"><h2>Recent Activity</h2><div class="list">${(data.activity || []).map((item) => `<div class="list-item"><div><strong>${escapeHtml(item.title)}</strong><span>${escapeHtml(item.message || item.activity_type)}</span></div><span>${dateText(item.created_at)}</span></div>`).join('') || '<div class="empty compact">No recent activity.</div>'}</div></section></div></section>`;
  document.querySelector('#logout').onclick = async () => { await api('/auth/logout', { method: 'POST', body: '{}' }); location.href = '/workers/login'; };
}

async function renderProfile() {
  if (!requireWorkerPage()) return;
  options = await api('/options');
  const { worker } = await api('/profile');
  app.innerHTML = `<section class="page-section profile-page">${pageToolbar('Profile')}<div class="section-heading"><div><p class="eyebrow">Premium worker profile</p><h1>My Profile</h1></div><p>Keep your skills, availability, certifications and preferences current for faster matching.</p></div>${completionWidget(worker)}<div class="profile-layout"><aside class="glass-panel profile-card"><div class="profile-avatar">${escapeHtml((worker.full_name || 'S').charAt(0))}</div><h2>${escapeHtml(worker.full_name)}</h2><p>${escapeHtml(worker.professional_title || worker.trade_profession)}</p>${verificationBadges(worker)}</aside><form id="profile-form" class="glass-panel auth-card wide"><h2>Professional Details</h2><div class="form-grid">${field('full_name','Full Name',worker.full_name,'text','required')}${field('mobile_number','Mobile Number',worker.mobile_number,'tel','required')}${field('country','Country',worker.country,'text','required')}${field('nationality','Nationality',worker.nationality,'text','required')}${field('current_location','Current Location',worker.current_location,'text','required')}${field('date_of_birth','Date of Birth',worker.date_of_birth,'date','required')}${field('passport_number','Passport Number',worker.passport_number || '')}${field('trade_profession','Trade / Profession',worker.trade_profession,'text','required')}${field('professional_title','Professional Title',worker.professional_title || '')}${field('years_experience','Years of Experience',worker.years_experience,'number','min="0" required')}${field('highest_qualification','Highest Qualification',worker.highest_qualification,'text','required')}${selectField('availability','Availability',options.availability_options || [], worker.availability)}${field('preferred_salary','Preferred Salary',worker.preferred_salary || '')}${field('languages','Languages',(worker.languages || []).join(', '))}${field('emergency_contact_name','Emergency Contact Name',worker.emergency_contact?.name || '')}${field('emergency_contact_phone','Emergency Contact Phone',worker.emergency_contact?.phone || '')}${field('emergency_contact_relationship','Emergency Relationship',worker.emergency_contact?.relationship || '')}${field('preferred_countries','Preferred Countries',(worker.preferred_countries || []).join(', '))}</div>${textareaField('biography','Professional Biography',worker.biography || '')}<div class="field"><label>Skills</label>${skillChecks(worker.skills || [])}</div><button class="button button-gold">Save Profile</button></form></div><section class="glass-panel experience-panel"><h2>Experience</h2><div class="table-wrap"><table><thead><tr><th>Position</th><th>Company</th><th>Country</th><th>Period</th><th>Details</th><th>Action</th></tr></thead><tbody>${experienceRows(worker.experience || [])}</tbody></table></div><form id="experience-form" class="inline-form"><div class="form-grid">${field('position','Position','','text','required')}${field('company','Company','','text','required')}${field('country','Country','','text','required')}${field('start_date','Start Date','','date','required')}${field('end_date','End Date','','date')}${field('description','Description')}</div><button class="button button-gold">Add Experience</button></form></section></section>`;
  document.querySelector('#profile-form').onsubmit = async (event) => { event.preventDefault(); try { await api('/profile', { method: 'PATCH', body: JSON.stringify(collectForm(event.currentTarget)) }); toast('Profile updated'); setTimeout(() => location.reload(), 500); } catch (error) { toast(error.message, true); } };
  document.querySelector('#experience-form').onsubmit = async (event) => { event.preventDefault(); try { await api('/experience', { method: 'POST', body: JSON.stringify(Object.fromEntries(new FormData(event.currentTarget))) }); toast('Experience added'); setTimeout(() => location.reload(), 500); } catch (error) { toast(error.message, true); } };
  bindExperienceActions();
}

function experienceRows(items = []) {
  return items.map((item) => `<tr><td>${escapeHtml(item.position)}</td><td>${escapeHtml(item.company)}</td><td>${escapeHtml(item.country)}</td><td>${dateText(item.start_date)} - ${dateText(item.end_date)}</td><td>${escapeHtml(item.description || '')}</td><td><button class="button button-outline" data-delete-experience="${item.id}">Delete</button></td></tr>`).join('') || '<tr><td colspan="6" class="empty-row">Add your offshore, industrial, marine and trade experience.</td></tr>';
}

function bindExperienceActions() {
  document.querySelectorAll('[data-delete-experience]').forEach((button) => {
    button.onclick = async () => { try { await api(`/experience/${button.dataset.deleteExperience}`, { method: 'DELETE' }); toast('Experience deleted'); setTimeout(() => location.reload(), 500); } catch (error) { toast(error.message, true); } };
  });
}

async function renderDocuments(pageTitle = 'My Documents', active = 'Documents', certificateOnly = false) {
  if (!requireWorkerPage()) return;
  const data = await api('/documents');
  const items = certificateOnly ? data.items.filter((doc) => /certificate|resume|cv|medical|passport/i.test(doc.document_type)) : data.items;
  app.innerHTML = `<section class="page-section">${pageToolbar(active)}<div class="section-heading"><div><p class="eyebrow">Worker document vault</p><h1>${escapeHtml(pageTitle)}</h1></div><p>Upload, replace and track certificates, passport, CV, medical and experience documents.</p></div><div class="dashboard-grid"><section class="glass-panel"><h2>${escapeHtml(pageTitle)}</h2><div class="table-wrap"><table><thead><tr><th>Name</th><th>Type</th><th>File</th><th>Size</th><th>Status</th><th>Expiry</th><th>Uploaded</th><th>Actions</th></tr></thead><tbody>${documentRows(items)}</tbody></table></div></section>${documentUploadForm(certificateOnly ? 'Upload Certificate' : 'Upload Document')}</div></section>`;
  bindDocumentUpload(document.querySelector('#document-form'));
  document.querySelectorAll('[data-delete-document]').forEach((button) => {
    button.onclick = async () => {
      try { await api(`/documents/${button.dataset.deleteDocument}`, { method: 'DELETE' }); toast('Document deleted'); setTimeout(() => location.reload(), 500); }
      catch (error) { toast(error.message, true); }
    };
  });  document.querySelectorAll('[data-replace-document]').forEach((button) => {
    button.onclick = () => {
      const form = document.querySelector('#document-form');
      form.scrollIntoView({ behavior: 'smooth', block: 'center' });
      form.querySelector('button').textContent = 'Replace Document';
      bindDocumentUpload(form, `/documents/${button.dataset.replaceDocument}/replace`);
    };
  });
}

function applicationItem(item) {
  return `<div class="list-item"><div><strong>${escapeHtml(item.title)}</strong><span>${escapeHtml(item.company)} | ${escapeHtml(item.country)} | ${dateText(item.applied_at)}</span></div><span class="status">${escapeHtml(statusLabel(item.status))}</span></div>`;
}

async function renderApplications() {
  if (!requireWorkerPage()) return;
  const { items } = await api('/applications');
  app.innerHTML = `<section class="page-section">${pageToolbar('Applications')}<div class="section-heading"><div><p class="eyebrow">Application tracker</p><h1>My Applications</h1></div><p>Track every application from submitted through interview, offer or withdrawal.</p></div><section class="glass-panel"><div class="table-wrap"><table><thead><tr><th>Job</th><th>Company</th><th>Country</th><th>Status</th><th>Applied</th><th>Interview</th><th>Actions</th></tr></thead><tbody>${items.map((item) => `<tr><td><a href="/workers/jobs/${escapeHtml(item.slug)}">${escapeHtml(item.title)}</a></td><td>${escapeHtml(item.company)}</td><td>${escapeHtml(item.country)}</td><td><span class="status">${escapeHtml(statusLabel(item.status))}</span></td><td>${dateText(item.applied_at)}</td><td>${dateText(item.interview_at)}</td><td>${item.status !== 'withdrawn' ? `<button class="button button-outline" data-withdraw-application="${item.id}">Withdraw</button>` : 'Withdrawn'}</td></tr>`).join('') || '<tr><td colspan="7" class="empty-row">No applications yet.</td></tr>'}</tbody></table></div></section></section>`;
  document.querySelectorAll('[data-withdraw-application]').forEach((button) => button.onclick = async () => { try { await api(`/applications/${button.dataset.withdrawApplication}/withdraw`, { method: 'POST', body: '{}' }); toast('Application withdrawn'); setTimeout(() => location.reload(), 500); } catch (error) { toast(error.message, true); } });
}
async function renderSavedJobs() {
  if (!requireWorkerPage()) return;
  const { items } = await api('/saved-jobs');
  app.innerHTML = `<section class="page-section">${pageToolbar('Saved Jobs')}<div class="section-heading"><div><p class="eyebrow">Saved opportunities</p><h1>Saved Jobs</h1></div><p>Keep high-fit opportunities ready for review and application.</p></div><div class="job-grid">${items.map(jobCard).join('') || '<div class="empty">No saved jobs yet.</div>'}</div></section>`;
  bindJobActions(app);
}

function notificationItem(item) {
  return `<div class="list-item ${item.is_read ? '' : 'unread'}"><div><strong>${escapeHtml(item.title)}</strong><span>${escapeHtml(item.message)}</span><span>${dateText(item.created_at)}</span></div>${item.is_read ? '<span class="status">Read</span>' : `<button class="button button-outline" data-read-notification="${item.id}">Mark Read</button>`}</div>`;
}

async function renderNotifications() {
  if (!requireWorkerPage()) return;
  const { items } = await api('/notifications');
  app.innerHTML = `<section class="page-section">${pageToolbar('Notifications')}<div class="section-heading"><div><p class="eyebrow">Messages and alerts</p><h1>Notifications</h1></div><p>Review profile, document and application updates from Skyproz.</p></div><section class="glass-panel"><div class="list">${items.map(notificationItem).join('') || '<div class="empty compact">No notifications yet.</div>'}</div></section></section>`;
  document.querySelectorAll('[data-read-notification]').forEach((button) => button.onclick = async () => { try { await api(`/notifications/${button.dataset.readNotification}/read`, { method: 'POST', body: '{}' }); toast('Notification marked as read'); setTimeout(() => location.reload(), 500); } catch (error) { toast(error.message, true); } });
}

async function renderSettings() {
  if (!requireWorkerPage()) return;
  const { worker } = await api('/profile');
  const notifications = worker.notification_settings || {};
  const privacy = worker.privacy_settings || {};
  const checked = (value) => value === false ? '' : 'checked';
  app.innerHTML = `<section class="page-section">${pageToolbar('Settings')}<div class="section-heading"><div><p class="eyebrow">Account preferences</p><h1>Settings</h1></div><p>Control worker alerts, privacy and profile visibility.</p></div><form id="settings-form" class="glass-panel settings-grid"><section><h2>Notifications</h2><label class="toggle"><input type="checkbox" name="email_alerts" ${checked(notifications.email_alerts)}> Email job alerts</label><label class="toggle"><input type="checkbox" name="application_updates" ${checked(notifications.application_updates)}> Application updates</label><label class="toggle"><input type="checkbox" name="document_updates" ${checked(notifications.document_updates)}> Document verification updates</label></section><section><h2>Privacy</h2><label class="toggle"><input type="checkbox" name="profile_visible" ${checked(privacy.profile_visible)}> Profile visible to approved employers</label><label class="toggle"><input type="checkbox" name="show_documents" ${privacy.show_documents ? 'checked' : ''}> Show verified documents to admins</label><label class="toggle"><input type="checkbox" name="open_to_relocation" ${checked(privacy.open_to_relocation)}> Open to international relocation</label></section><button class="button button-gold">Save Settings</button></form></section>`;
  document.querySelector('#settings-form').onsubmit = async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const notification_settings = { email_alerts: form.email_alerts.checked, application_updates: form.application_updates.checked, document_updates: form.document_updates.checked };
    const privacy_settings = { profile_visible: form.profile_visible.checked, show_documents: form.show_documents.checked, open_to_relocation: form.open_to_relocation.checked };
    try { await api('/settings', { method: 'PATCH', body: JSON.stringify({ notification_settings, privacy_settings }) }); toast('Settings saved'); }
    catch (error) { toast(error.message, true); }
  };
}

async function renderPublicProfile() {
  const { profile } = await api(`/public/${encodeURIComponent(identifier)}`);
  const shareUrl = `${location.origin}${profile.share_url}`;
  app.innerHTML = `<section class="page-section public-profile"><div class="public-profile-grid"><aside class="glass-panel profile-card"><div class="profile-avatar">${escapeHtml((profile.full_name || 'S').charAt(0))}</div><h1>${escapeHtml(profile.full_name)}</h1><p>${escapeHtml(profile.professional_title || profile.trade_profession)}</p><div class="chip-row"><span>${escapeHtml(profile.country)}</span><span>${profile.years_experience}+ years</span><span>${escapeHtml(profile.availability)}</span></div>${verificationBadges(profile)}<div class="toolbar">${profile.cv_download_url ? button('Download CV', profile.cv_download_url, 'button-gold') : ''}<button class="button button-outline" data-copy-profile>Copy Public Profile Link</button></div></aside><article class="glass-panel"><p class="eyebrow">Public worker profile</p><h2>${escapeHtml(profile.professional_title || profile.trade_profession)}</h2><p>${escapeHtml(profile.biography || 'Professional worker profile registered with Skyproz Services.')}</p><div class="metric-grid compact-metrics"><div class="metric"><strong>${profile.profile_completion}%</strong><span>Profile Strength</span></div><div class="metric"><strong>${profile.profile_views}</strong><span>Profile Views</span></div><div class="metric"><strong>${(profile.certificates || []).length}</strong><span>Certificates</span></div></div><h3>Skills</h3><div class="chip-row">${(profile.skill_levels?.length ? profile.skill_levels.map((skill) => `${skill.skill_name} - ${skill.skill_level}`) : profile.skills || []).map((skill) => `<span>${escapeHtml(skill)}</span>`).join('') || '<span>Skills available on request</span>'}</div><h3>Certificates</h3><div class="list">${(profile.certificates || []).map((cert) => `<div class="list-item"><div><strong>${escapeHtml(cert.certificate_name)}</strong><span>${escapeHtml(cert.certificate_number || 'Certificate number pending')} | ${escapeHtml(cert.verification_status)}</span></div><span>${dateText(cert.expiry_date)}</span></div>`).join('') || '<div class="empty compact">No certificates listed yet.</div>'}</div></article><aside class="glass-panel qr-card"><h2>Share Profile</h2><img src="${escapeHtml(profile.qr_url)}" alt="Public profile QR code" loading="lazy"><p>${escapeHtml(shareUrl)}</p><a class="button button-outline" href="${escapeHtml(profile.qr_url)}" download="skyproz-profile-qr.svg">Download QR</a></aside></div></section>`;
  document.querySelector('[data-copy-profile]')?.addEventListener('click', async () => { await navigator.clipboard?.writeText(shareUrl); toast('Public profile link copied'); });
}

async function renderResume() {
  if (!requireWorkerPage()) return;
  const { resume } = await api('/resume');
  app.innerHTML = `<section class="page-section">${pageToolbar('Resume')}<div class="section-heading"><div><p class="eyebrow">Resume builder</p><h1>Professional Resume</h1></div><div class="toolbar"><a class="button button-gold" href="/api/workers/resume/download?format=pdf">Download PDF</a><a class="button button-outline" href="/api/workers/resume/download?format=ats">ATS Friendly Resume</a></div></div><div class="resume-layout"><article class="glass-panel resume-preview"><pre>${escapeHtml(resume.ats_text)}</pre></article><aside class="glass-panel"><h2>Resume Score</h2><div class="completion-ring" style="--progress:${resume.ai_resume_score}%"><strong>${resume.ai_resume_score}%</strong><span>Score</span></div><p>Built from profile details, skills, certifications and experience. Supported templates: Executive, ATS and Compact.</p></aside></div></section>`;
}

function skillLevelRows(items = []) {
  return items.map((item) => `<tr><td><input name="skill_name" value="${escapeHtml(item.skill_name)}"></td><td><select name="skill_level">${['Beginner','Intermediate','Advanced','Expert'].map((level) => option(level, item.skill_level)).join('')}</select></td><td><input name="years_experience" type="number" min="0" value="${item.years_experience || 0}"></td><td>${item.verified ? 'Verified' : 'Pending'}</td></tr>`).join('') || `<tr><td><input name="skill_name" placeholder="Rope Access"></td><td><select name="skill_level">${['Beginner','Intermediate','Advanced','Expert'].map((level) => option(level, 'Intermediate')).join('')}</select></td><td><input name="years_experience" type="number" min="0" value="0"></td><td>Pending</td></tr>`;
}

async function renderSkills() {
  if (!requireWorkerPage()) return;
  const { items } = await api('/skills');
  app.innerHTML = `<section class="page-section">${pageToolbar('Skills')}<div class="section-heading"><div><p class="eyebrow">Skill levels</p><h1>Skills</h1></div><p>Add unlimited skills and levels for better future AI job matching.</p></div><form id="skills-form" class="glass-panel"><div class="table-wrap"><table id="skills-table"><thead><tr><th>Skill</th><th>Level</th><th>Years</th><th>Status</th></tr></thead><tbody>${skillLevelRows(items)}</tbody></table></div><div class="toolbar"><button class="button button-outline" type="button" id="add-skill-row">Add Skill</button><button class="button button-gold">Save Skills</button></div></form></section>`;
  document.querySelector('#add-skill-row').onclick = () => document.querySelector('#skills-table tbody').insertAdjacentHTML('beforeend', skillLevelRows([]));
  document.querySelector('#skills-form').onsubmit = async (event) => {
    event.preventDefault();
    const rows = [...document.querySelectorAll('#skills-table tbody tr')].map((row) => ({ skill_name: row.querySelector('[name="skill_name"]').value, skill_level: row.querySelector('[name="skill_level"]').value, years_experience: row.querySelector('[name="years_experience"]').value })).filter((item) => item.skill_name.trim());
    try { await api('/skills', { method: 'PUT', body: JSON.stringify({ skills: rows }) }); toast('Skills saved'); }
    catch (error) { toast(error.message, true); }
  };
}
async function renderJobAlerts() {
  if (!requireWorkerPage()) return;
  const { items } = await api('/job-alerts');
  app.innerHTML = `<section class="page-section">${pageToolbar('Alerts')}<div class="section-heading"><div><p class="eyebrow">Job alerts</p><h1>Alerts</h1></div><p>Choose country, trade, industry, salary, rotation and offshore preferences.</p></div><div class="dashboard-grid"><section class="glass-panel"><h2>Active Alerts</h2><div class="list">${items.map((alert) => `<div class="list-item"><div><strong>${escapeHtml([alert.country, alert.trade, alert.industry].filter(Boolean).join(' | ') || 'General alert')}</strong><span>${escapeHtml(alert.salary || 'Any salary')} | ${escapeHtml(alert.rotation || 'Any rotation')} | ${alert.offshore ? 'Offshore' : 'Onshore/Any'}</span></div><button class="button button-outline" data-delete-alert="${alert.id}">Delete</button></div>`).join('') || '<div class="empty compact">No alerts yet.</div>'}</div></section><form id="alert-form" class="glass-panel"><h2>Create Alert</h2>${field('country','Country')}${field('trade','Trade')}${field('industry','Industry')}${field('salary','Salary')}${field('rotation','Rotation')}<label class="toggle"><input type="checkbox" name="offshore"> Offshore</label><label class="toggle"><input type="checkbox" name="email_enabled" checked> Email</label><label class="toggle"><input type="checkbox" name="dashboard_enabled" checked> Dashboard alerts</label><label class="toggle"><input type="checkbox" name="whatsapp_future"> Future WhatsApp integration</label><button class="button button-gold">Save Alert</button></form></div></section>`;
  document.querySelector('#alert-form').onsubmit = async (event) => { event.preventDefault(); const form = event.currentTarget; const data = Object.fromEntries(new FormData(form)); data.offshore = form.offshore.checked; data.email_enabled = form.email_enabled.checked; data.dashboard_enabled = form.dashboard_enabled.checked; data.whatsapp_future = form.whatsapp_future.checked; try { await api('/job-alerts', { method: 'POST', body: JSON.stringify(data) }); toast('Job alert created'); setTimeout(() => location.reload(), 500); } catch (error) { toast(error.message, true); } };
  document.querySelectorAll('[data-delete-alert]').forEach((button) => button.onclick = async () => { try { await api(`/job-alerts/${button.dataset.deleteAlert}`, { method: 'DELETE' }); toast('Alert deleted'); setTimeout(() => location.reload(), 500); } catch (error) { toast(error.message, true); } });
}

async function renderInterviews() {
  if (!requireWorkerPage()) return;
  const { items } = await api('/interviews');
  const now = Date.now();
  const upcoming = items.filter((item) => new Date(item.scheduled_at).getTime() >= now);
  const past = items.filter((item) => new Date(item.scheduled_at).getTime() < now);
  const itemView = (item) => `<div class="list-item"><div><strong>${escapeHtml(item.interview_title)}</strong><span>${escapeHtml(item.employer_name)} | ${dateText(item.scheduled_at)} | ${escapeHtml(item.status)}</span><span>${escapeHtml(item.employer_note || '')}</span></div>${item.meeting_url ? `<a class="button button-gold" href="${escapeHtml(item.meeting_url)}" target="_blank" rel="noopener noreferrer">Join Meeting</a>` : '<span class="status">Scheduled</span>'}</div>`;
  app.innerHTML = `<section class="page-section">${pageToolbar('Interviews')}<div class="section-heading"><div><p class="eyebrow">Interview center</p><h1>Interviews</h1></div><p>Upcoming interviews, past interviews, statuses, notes and meeting links.</p></div><div class="dashboard-grid"><section class="glass-panel"><h2>Upcoming Interviews</h2><div class="list">${upcoming.map(itemView).join('') || '<div class="empty compact">No upcoming interviews.</div>'}</div></section><section class="glass-panel"><h2>Past Interviews</h2><div class="list">${past.map(itemView).join('') || '<div class="empty compact">No past interviews.</div>'}</div></section></div></section>`;
}

async function renderAnalytics() {
  if (!requireWorkerPage()) return;
  const { analytics } = await api('/analytics');
  app.innerHTML = `<section class="page-section">${pageToolbar('Analytics')}<div class="section-heading"><div><p class="eyebrow">Worker analytics</p><h1>Analytics</h1></div><p>Track profile views, employer searches, applications, interviews and profile strength.</p></div><div class="metric-grid"><div class="metric"><strong>${analytics.profile_views}</strong><span>Profile Views</span></div><div class="metric"><strong>${analytics.employer_searches}</strong><span>Employer Searches</span></div><div class="metric"><strong>${analytics.applications}</strong><span>Applications</span></div><div class="metric"><strong>${analytics.interview_rate}%</strong><span>Interview Rate</span></div><div class="metric"><strong>${analytics.profile_strength}%</strong><span>Profile Strength</span></div><div class="metric"><strong>${analytics.response_rate}%</strong><span>Response Rate</span></div></div><section class="glass-panel"><h2>AI Readiness</h2><p>Resume score: ${analytics.ai_resume_score}%. This score is prepared for future AI resume analysis, profile improvement suggestions and skill gap analysis.</p></section></section>`;
}

async function renderSubscription() {
  if (!requireWorkerPage()) return;
  const { subscription } = await api('/subscription');
  app.innerHTML = `<section class="page-section">${pageToolbar('Subscription')}<div class="section-heading"><div><p class="eyebrow">Subscription</p><h1>Plans</h1></div><p>Prepared for future premium memberships and payment integration.</p></div><div class="plan-grid">${subscription.plans.map((plan) => `<article class="glass-panel plan-card ${plan.current ? 'current' : ''}"><h2>${escapeHtml(plan.name)}</h2><p>${plan.name === 'PREMIUM' ? 'Priority profile visibility, advanced alerts and future AI job matching.' : 'Core worker profile, job applications and document storage.'}</p><span class="status">${plan.current ? 'Current Plan' : 'Available'}</span></article>`).join('')}</div><section class="glass-panel"><h2>Billing History</h2><div class="table-wrap"><table><thead><tr><th>Plan</th><th>Amount</th><th>Status</th><th>Date</th></tr></thead><tbody>${subscription.billing_history.map((item) => `<tr><td>${escapeHtml(item.plan_name)}</td><td>${escapeHtml(item.amount || '')} ${escapeHtml(item.currency)}</td><td>${escapeHtml(item.billing_status)}</td><td>${dateText(item.billing_date)}</td></tr>`).join('') || '<tr><td colspan="4" class="empty-row">No billing records yet.</td></tr>'}</tbody></table></div></section></section>`;
}
async function renderCertifications() {
  if (!requireWorkerPage()) return;
  const { items } = await api('/certifications');
  app.innerHTML = `<section class="page-section">${pageToolbar('Documents')}<div class="section-heading"><div><p class="eyebrow">Certificate manager</p><h1>Certifications</h1></div><p>Track certificate numbers, issue dates, expiry dates and verification status.</p></div><div class="dashboard-grid"><section class="glass-panel"><h2>Certificates</h2><div class="table-wrap"><table><thead><tr><th>Certificate</th><th>Number</th><th>Authority</th><th>Issue</th><th>Expiry</th><th>Status</th><th>Action</th></tr></thead><tbody>${items.map((cert) => `<tr><td>${escapeHtml(cert.certificate_name)}</td><td>${escapeHtml(cert.certificate_number || '')}</td><td>${escapeHtml(cert.issuing_authority || '')}</td><td>${dateText(cert.issue_date)}</td><td>${dateText(cert.expiry_date)}</td><td><span class="status">${escapeHtml(cert.verification_status)}</span></td><td><button class="button button-outline" data-delete-cert="${cert.id}">Delete</button></td></tr>`).join('') || '<tr><td colspan="7" class="empty-row">No certificates added yet.</td></tr>'}</tbody></table></div></section><form id="certificate-form" class="glass-panel"><h2>Add Certificate</h2>${field('certificate_name','Certificate Name','','text','required')}${field('certificate_number','Certificate Number')}${field('issuing_authority','Issuing Authority')}${field('issue_date','Issue Date','','date')}${field('expiry_date','Expiry Date','','date')}<button class="button button-gold">Save Certificate</button></form></div></section>`;
  document.querySelector('#certificate-form').onsubmit = async (event) => { event.preventDefault(); try { await api('/certifications', { method: 'POST', body: JSON.stringify(Object.fromEntries(new FormData(event.currentTarget))) }); toast('Certificate saved'); setTimeout(() => location.reload(), 500); } catch (error) { toast(error.message, true); } };
  document.querySelectorAll('[data-delete-cert]').forEach((button) => button.onclick = async () => { try { await api(`/certifications/${button.dataset.deleteCert}`, { method: 'DELETE' }); toast('Certificate deleted'); setTimeout(() => location.reload(), 500); } catch (error) { toast(error.message, true); } });
}
async function renderJobDetail() {
  const { job } = await api(`/jobs/${encodeURIComponent(identifier)}`);
  app.innerHTML = `<section class="page-section job-detail"><p class="eyebrow">${escapeHtml(job.company)} | ${escapeHtml(job.country)}</p><h1>${escapeHtml(job.title)}</h1><div class="chip-row"><span>${escapeHtml(job.industry)}</span><span>${escapeHtml(job.trade)}</span><span>${escapeHtml(job.job_type)}</span><span>${job.experience_required}+ years</span></div><div class="detail-grid"><article class="glass-panel"><h2>Job Details</h2><p>${escapeHtml(job.description)}</p><h3>Requirements</h3><ul>${job.requirements.map((item) => `<li>${escapeHtml(item)}</li>`).join('') || '<li>Requirements will be confirmed during review.</li>'}</ul></article><aside class="glass-panel"><h2>Opportunity Summary</h2><dl><div><dt>Salary</dt><dd>${money(job.salary_min, job.salary_max, job.currency)}</dd></div><div><dt>Deadline</dt><dd>${dateText(job.deadline)}</dd></div><div><dt>Status</dt><dd>${escapeHtml(statusLabel(job.application_status || 'Not applied'))}</dd></div></dl><div class="toolbar">${currentWorker ? `<button class="button button-gold" data-apply-job="${job.id}">Apply</button><button class="button button-outline" data-save-job="${job.id}">Save Job</button>` : button('Login to Apply','/workers/login','button-gold')}</div></aside></div></section>`;
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
  try { options = await api('/options'); } catch { options = { skills: [], document_types: [], availability_options: [] }; }
  const routes = {
    opportunities: renderOpportunities,
    login: renderLogin,
    signup: renderSignup,
    dashboard: renderDashboard,
    profile: renderProfile,
    publicProfile: renderPublicProfile,
    resume: renderResume,
    skills: renderSkills,
    certifications: renderCertifications,
    documents: () => renderDocuments('My Documents', 'Documents'),
    applications: renderApplications,
    savedJobs: renderSavedJobs,
    jobAlerts: renderJobAlerts,
    interviews: renderInterviews,
    analytics: renderAnalytics,
    subscription: renderSubscription,
    notifications: renderNotifications,
    settings: renderSettings,
    job: renderJobDetail,
    admin: renderAdmin,
    notFound: renderNotFound
  };
  try { await (routes[page] || renderNotFound)(); } catch (error) { app.innerHTML = `<section class="page-section"><div class="empty error"><h1>Unable to load Worker Portal</h1><p>${escapeHtml(error.message)}</p></div></section>`; }
}

init();