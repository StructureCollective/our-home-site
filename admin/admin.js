// Our Home -- admin applicant dashboard.
// This page itself is served publicly by the Worker, but it's reachable
// only at /admin/*, which Cloudflare Access protects; every fetch() below
// also hits /api/admin/* endpoints that independently check the caller's
// Access identity against the ADMIN_EMAILS allowlist.

const listEl = document.getElementById('list');
const errorBanner = document.getElementById('errorBanner');
const filterTabs = document.getElementById('filterTabs');

const STATUS_LABEL = {
  submitted: 'New',
  phone_interview_sent: 'Phone interview sent',
  zoom_sent: 'Zoom sent',
  hired: 'Hired',
  not_selected: 'Not selected',
};

const DEFAULT_PHONE_SUBJECT = 'Our Home -- next steps on your application';

let applications = [];
let currentFilter = 'all';
let zoomTargetId = null;
let phoneTargetApp = null;

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

// ---------------- Session block: who's logged in + live clock ----------------

async function loadWhoAmI() {
  const emailEl = document.getElementById('whoEmail');
  const avatarEl = document.getElementById('whoAvatar');
  try {
    const data = await api('/api/admin/me');
    if (data && data.email) {
      emailEl.textContent = data.email;
      avatarEl.textContent = data.email.trim()[0].toUpperCase();
    }
  } catch {
    // Non-fatal -- the page still works, we just can't show who's logged in.
    emailEl.textContent = 'Signed in';
  }
}

function startClock() {
  const clockEl = document.getElementById('whoClock');
  function tick() {
    clockEl.textContent = new Date().toLocaleString(undefined, {
      weekday: 'short', month: 'short', day: 'numeric',
      hour: 'numeric', minute: '2-digit',
    });
  }
  tick();
  setInterval(tick, 1000 * 30);
}

// ---------------- Dashboard KPI row ----------------

function renderKpis() {
  const counts = { submitted: 0, phone_interview_sent: 0, zoom_sent: 0, hired: 0, not_selected: 0 };
  for (const app of applications) {
    if (counts[app.status] !== undefined) counts[app.status] += 1;
  }
  document.getElementById('kpiTotal').textContent = applications.length;
  document.getElementById('kpiSubmitted').textContent = counts.submitted;
  document.getElementById('kpiPhone').textContent = counts.phone_interview_sent;
  document.getElementById('kpiZoom').textContent = counts.zoom_sent;
  document.getElementById('kpiHired').textContent = counts.hired;
  document.getElementById('kpiNotSelected').textContent = counts.not_selected;
}

// ---------------- Applicant list ----------------

function render() {
  renderKpis();

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

  card.querySelector('[data-action="phone"]').addEventListener('click', () => openPhoneModal(app));
  card.querySelector('[data-action="zoom"]').addEventListener('click', () => openZoomModal(app));

  return card;
}

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

// ---------------- Phone interview modal ----------------

function openPhoneModal(app) {
  phoneTargetApp = app;
  document.getElementById('phoneSubject').value = DEFAULT_PHONE_SUBJECT;
  document.getElementById('phoneMessage').value = '';
  document.getElementById('phoneModal').showModal();
}

document.getElementById('phoneCancel').addEventListener('click', () => {
  document.getElementById('phoneModal').close();
});

document.getElementById('phoneForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const subject = document.getElementById('phoneSubject').value.trim();
  const message = document.getElementById('phoneMessage').value.trim();
  if (!phoneTargetApp) return;

  try {
    showError('');
    await api(`/api/admin/applications/${phoneTargetApp.id}/send-phone-interview`, {
      method: 'POST',
      body: JSON.stringify({ subject, message }),
    });
    document.getElementById('phoneModal').close();
    await loadApplications();
  } catch (err) {
    showError(err.message);
  }
});

// ---------------- Zoom interview modal ----------------

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

// ---------------- Filters + load ----------------

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

loadWhoAmI();
startClock();
loadApplications();
