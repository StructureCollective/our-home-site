// Our Home -- admin applicant dashboard.
// This page itself is served publicly by the Worker, but it's reachable
// only at /admin/*, which Cloudflare Access protects; every fetch() below
// also hits /api/admin/* endpoints that independently check the caller's
// Access identity against the ADMIN_EMAILS allowlist.

const listEl = document.getElementById('list');
const errorBanner = document.getElementById('errorBanner');
const whoamiEl = document.getElementById('whoami');
const filterTabs = document.getElementById('filterTabs');

const STATUS_LABEL = {
  submitted: 'New',
  phone_interview_sent: 'Phone interview sent',
  zoom_sent: 'Zoom sent',
  hired: 'Hired',
  not_selected: 'Not selected',
};

let applications = [];
let currentFilter = 'all';
let zoomTargetId = null;

function showError(message) {
  errorBanner.textContent = message;
  errorBanner.style.display = message ? 'block' : 'none';
}

async function api(path, options) {
  const res = await fetch(path, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options && options.headers) },
  });
  let data = null;
  try { data = await res.json(); } catch { /* no body */ }
  if (!res.ok) {
    throw new Error((data && data.error) || `Request failed (${res.status})`);
  }
  return data;
}

function formatDate(iso) {
  if (!iso) return '';
  try {
    return new Date(iso.replace(' ', 'T') + 'Z').toLocaleString(undefined, {
      dateStyle: 'medium', timeStyle: 'short',
    });
  } catch {
    return iso;
  }
}

function render() {
  const filtered = currentFilter === 'all'
    ? applications
    : applications.filter((a) => a.status === currentFilter);

  if (filtered.length === 0) {
    listEl.innerHTML = '<p class="empty-state">No applicants here yet.</p>';
    return;
  }

  listEl.innerHTML = '';
  for (const app of filtered) {
    listEl.appendChild(renderCard(app));
  }
}

function renderCard(app) {
  const card = document.createElement('div');
  card.className = 'app-card';

  const statusLabel = STATUS_LABEL[app.status] || app.status;

  card.innerHTML = `
    <div class="app-card-top">
      <div>
        <div class="app-name">${escapeHtml(app.full_name)}</div>
        <div class="app-meta">${escapeHtml(app.position || 'No position specified')} • ${escapeHtml(app.email)}${app.phone ? ' • ' + escapeHtml(app.phone) : ''}</div>
        <div class="app-meta">Submitted ${formatDate(app.submitted_at)}</div>
      </div>
      <span class="status-pill status-${app.status}">${statusLabel}</span>
    </div>
    <div class="app-actions">
      <a class="btn-small" href="/api/admin/applications/${app.id}/pdf" target="_blank" rel="noopener">Download PDF</a>
      <button data-action="phone" ${app.status !== 'submitted' ? 'disabled' : ''}>Send phone interview email</button>
      <button data-action="zoom" class="primary" ${app.status !== 'phone_interview_sent' ? 'disabled' : ''}>Send Zoom interview</button>
    </div>
  `;

  card.querySelector('[data-action="phone"]').addEventListener('click', () => sendPhoneInterview(app));
  card.querySelector('[data-action="zoom"]').addEventListener('click', () => openZoomModal(app));

  return card;
}

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

async function sendPhoneInterview(app) {
  if (!confirm(`Send the phone interview email to ${app.full_name} (${app.email})?`)) return;
  try {
    showError('');
    await api(`/api/admin/applications/${app.id}/send-phone-interview`, { method: 'POST', body: '{}' });
    await loadApplications();
  } catch (err) {
    showError(err.message);
  }
}

function openZoomModal(app) {
  zoomTargetId = app.id;
  document.getElementById('zoomLink').value = '';
  document.getElementById('zoomTime').value = '';
  document.getElementById('zoomMessage').value = '';
  document.getElementById('zoomModal').showModal();
}

document.getElementById('zoomCancel').addEventListener('click', () => {
  document.getElementById('zoomModal').close();
});

document.getElementById('zoomForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const zoomLink = document.getElementById('zoomLink').value.trim();
  const interviewTime = document.getElementById('zoomTime').value.trim();
  const message = document.getElementById('zoomMessage').value.trim();
  if (!zoomLink) return;

  try {
    showError('');
    await api(`/api/admin/applications/${zoomTargetId}/send-zoom`, {
      method: 'POST',
      body: JSON.stringify({ zoomLink, interviewTime, message }),
    });
    document.getElementById('zoomModal').close();
    await loadApplications();
  } catch (err) {
    showError(err.message);
  }
});

filterTabs.addEventListener('click', (e) => {
  const btn = e.target.closest('.admin-tab');
  if (!btn) return;
  currentFilter = btn.dataset.filter;
  [...filterTabs.children].forEach((el) => el.classList.toggle('active', el === btn));
  render();
});

async function loadApplications() {
  try {
    showError('');
    const data = await api('/api/admin/applications');
    applications = data.applications || [];
    render();
  } catch (err) {
    listEl.innerHTML = '';
    showError(err.message);
  }
}

loadApplications();
