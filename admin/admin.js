// Our Home -- admin applicant dashboard.
// This page itself is served publicly by the Worker, but it's reachable
// only at /admin/*, which Cloudflare Access protects; every fetch() below
// also hits /api/admin/* endpoints that independently check the caller's
// Access identity against the ADMIN_EMAILS allowlist.

const listEl = document.getElementById('list');
const errorBanner = document.getElementById('errorBanner');
const searchInput = document.getElementById('searchInput');
const statusFilter = document.getElementById('statusFilter');

const STATUS_LABEL = {
  submitted: 'New',
  phone_interview_sent: 'Phone interview sent',
  phone_interview_scheduled: 'Phone interview scheduled',
  zoom_interview_sent: 'Zoom interview sent',
  zoom_interview_scheduled: 'Zoom interview scheduled',
  hired: 'Hired',
  not_selected: 'Not selected',
};

let applications = [];
let currentFilter = 'all';
let currentSearch = '';
let zoomTargetApp = null;
let phoneTargetApp = null;
let deleteTargetApp = null;

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
    // Most timestamp columns are SQLite's `datetime('now')` format
    // ("YYYY-MM-DD HH:MM:SS", no timezone -- needs "T"/"Z" added to parse
    // reliably). The two *_scheduled_at columns instead store the
    // applicant's chosen slot verbatim, which is already a full ISO
    // string (from Date#toISOString() on the scheduling page) -- adding
    // another "Z" to those would break parsing, so only normalize when
    // the string doesn't already carry timezone info.
    const hasTimezone = /[zZ]$|[+-]\d{2}:\d{2}$/.test(iso);
    const normalized = hasTimezone ? iso : `${iso.replace(' ', 'T')}Z`;
    // Our Home operates out of Greensboro, NC -- every timestamp on this
    // dashboard is shown in Eastern Time (auto EST/EDT), same as the
    // emails and the public scheduling page, regardless of the admin's
    // own browser/system timezone.
    return new Date(normalized).toLocaleString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric',
      hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
      timeZone: 'America/New_York',
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
    clockEl.textContent = new Date().toLocaleString('en-US', {
      weekday: 'short', month: 'short', day: 'numeric',
      hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
      timeZone: 'America/New_York',
    });
  }
  tick();
  setInterval(tick, 1000 * 30);
}

// ---------------- Dashboard KPI row ----------------

function renderKpis() {
  const counts = {
    submitted: 0, phone_interview_sent: 0, phone_interview_scheduled: 0,
    zoom_interview_sent: 0, zoom_interview_scheduled: 0, hired: 0, not_selected: 0,
  };
  for (const app of applications) {
    if (counts[app.status] !== undefined) counts[app.status] += 1;
  }
  document.getElementById('kpiTotal').textContent = applications.length;
  document.getElementById('kpiSubmitted').textContent = counts.submitted;
  // "Phone interview" / "Zoom interview" tiles cover both the "offered,
  // awaiting the applicant" and "confirmed" sub-stages of that step.
  document.getElementById('kpiPhone').textContent = counts.phone_interview_sent + counts.phone_interview_scheduled;
  document.getElementById('kpiZoom').textContent = counts.zoom_interview_sent + counts.zoom_interview_scheduled;
  document.getElementById('kpiHired').textContent = counts.hired;
  document.getElementById('kpiNotSelected').textContent = counts.not_selected;
}

// ---------------- Applicant list ----------------

function render() {
  renderKpis();

  let filtered = currentFilter === 'all'
    ? applications
    : applications.filter((a) => a.status === currentFilter);

  const search = currentSearch.trim().toLowerCase();
  if (search) {
    filtered = filtered.filter((a) => (a.full_name || '').toLowerCase().includes(search));
  }

  if (filtered.length === 0) {
    listEl.innerHTML = '<p class="empty-state">No applicants match your search/filter.</p>';
    return;
  }

  listEl.innerHTML = '';
  for (const app of filtered) {
    listEl.appendChild(renderCard(app));
  }
}

function renderProgressChips(app) {
  const chips = [];
  if (app.phone_interview_sent_at) {
    chips.push(`<span class="progress-chip">Phone interview sent</span>`);
  }
  if (app.phone_interview_scheduled_at) {
    chips.push(`<span class="progress-chip scheduled">Phone interview scheduled — ${formatDate(app.phone_interview_scheduled_at)}</span>`);
  }
  if (app.phone_interview_resent_at) {
    chips.push(`<span class="progress-chip">Phone invite resent</span>`);
  }
  if (app.zoom_sent_at) {
    chips.push(`<span class="progress-chip">Zoom interview sent</span>`);
  }
  if (app.zoom_interview_scheduled_at) {
    chips.push(`<span class="progress-chip scheduled">Zoom interview scheduled — ${formatDate(app.zoom_interview_scheduled_at)}</span>`);
  }
  return chips.length ? `<div class="app-progress">${chips.join('')}</div>` : '';
}

function renderCard(app) {
  const card = document.createElement('div');
  card.className = 'app-card';

  const statusLabel = STATUS_LABEL[app.status] || app.status;
  const canSendPhone = app.status === 'submitted';
  const canSendZoom = app.status === 'phone_interview_scheduled';
  const canResendPhone = app.status === 'phone_interview_sent' && !app.phone_interview_resent_at;
  const resendTitle = app.status !== 'phone_interview_sent'
    ? 'Available once the phone interview invite has been sent, and before the applicant has scheduled a time'
    : app.phone_interview_resent_at
      ? 'This invite has already been resent once'
      : '';

  card.innerHTML = `
    <div class="app-card-top">
      <div>
        <div class="app-name">${escapeHtml(app.full_name)}</div>
        <div class="app-meta">${escapeHtml(app.position || 'No position specified')} • ${escapeHtml(app.email)}${app.phone ? ' • ' + escapeHtml(app.phone) : ''}</div>
        <div class="app-meta">Submitted ${formatDate(app.submitted_at)}</div>
      </div>
      <span class="status-pill status-${app.status}">${statusLabel}</span>
    </div>
    ${renderProgressChips(app)}
    <div class="app-actions">
      <a class="btn-small" href="/api/admin/applications/${app.id}/pdf" target="_blank" rel="noopener">Download PDF</a>
      <button data-action="phone" ${canSendPhone ? '' : 'disabled'}>Send phone interview email</button>
      <button data-action="resend-phone" ${canResendPhone ? '' : 'disabled'} title="${resendTitle}">Resend Phone Invite</button>
      <button data-action="zoom" class="primary" ${canSendZoom ? '' : 'disabled'} title="${canSendZoom ? '' : 'Available once the applicant has confirmed a phone interview time'}">Send Zoom interview</button>
      <button data-action="delete" class="danger" type="button">Delete</button>
    </div>
  `;

  card.querySelector('[data-action="phone"]').addEventListener('click', () => openPhoneModal(app));
  card.querySelector('[data-action="resend-phone"]').addEventListener('click', () => resendPhoneInterview(app));
  card.querySelector('[data-action="zoom"]').addEventListener('click', () => openZoomModal(app));
  card.querySelector('[data-action="delete"]').addEventListener('click', () => openDeleteModal(app));

  return card;
}

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

// ---------------- Interview time-slot helpers ----------------
//
// <input type="datetime-local"> values have no timezone info; they're
// interpreted in the browser's local time, same as the admin filling out
// the form. Converting through `new Date(...)` and back to ISO gives a
// consistent, unambiguous value to store and to show the applicant.

function slotInputsToIso(ids) {
  const values = ids.map((id) => document.getElementById(id).value);
  if (values.some((v) => !v)) return null;
  const isoValues = values.map((v) => new Date(v).toISOString());
  return isoValues;
}

// ---------------- Phone interview modal ----------------

function openPhoneModal(app) {
  phoneTargetApp = app;
  document.getElementById('phoneSlot1').value = '';
  document.getElementById('phoneSlot2').value = '';
  document.getElementById('phoneSlot3').value = '';
  document.getElementById('phoneModal').showModal();
}

document.getElementById('phoneCancel').addEventListener('click', () => {
  document.getElementById('phoneModal').close();
});

document.getElementById('phoneForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const slots = slotInputsToIso(['phoneSlot1', 'phoneSlot2', 'phoneSlot3']);
  if (!phoneTargetApp) return;
  if (!slots) {
    showError('Please fill in all 3 candidate interview times.');
    return;
  }

  try {
    showError('');
    await api(`/api/admin/applications/${phoneTargetApp.id}/send-phone-interview`, {
      method: 'POST',
      body: JSON.stringify({ slots }),
    });
    document.getElementById('phoneModal').close();
    await loadApplications();
  } catch (err) {
    showError(err.message);
  }
});

// ---------------- Resend phone interview invite (once only) ----------------
// Re-sends the ORIGINAL invite -- same 3 offered times, same scheduling
// link -- for when an applicant says the first email never arrived. The
// server enforces the "once only" rule; this just asks for confirmation
// and surfaces whatever error comes back if it's not allowed.

async function resendPhoneInterview(app) {
  const confirmed = window.confirm(
    `Resend the phone interview email to ${app.full_name}? This uses the same 3 times already offered, and can only be done once.`
  );
  if (!confirmed) return;

  try {
    showError('');
    await api(`/api/admin/applications/${app.id}/resend-phone-interview`, { method: 'POST' });
    await loadApplications();
  } catch (err) {
    showError(err.message);
  }
}

// ---------------- Zoom interview modal ----------------

function openZoomModal(app) {
  zoomTargetApp = app;
  document.getElementById('zoomLink').value = '';
  document.getElementById('zoomSlot1').value = '';
  document.getElementById('zoomSlot2').value = '';
  document.getElementById('zoomSlot3').value = '';
  document.getElementById('zoomModal').showModal();
}

document.getElementById('zoomCancel').addEventListener('click', () => {
  document.getElementById('zoomModal').close();
});

document.getElementById('zoomForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const zoomLink = document.getElementById('zoomLink').value.trim();
  const slots = slotInputsToIso(['zoomSlot1', 'zoomSlot2', 'zoomSlot3']);
  if (!zoomTargetApp || !zoomLink) return;
  if (!slots) {
    showError('Please fill in all 3 candidate interview times.');
    return;
  }

  try {
    showError('');
    await api(`/api/admin/applications/${zoomTargetApp.id}/send-zoom`, {
      method: 'POST',
      body: JSON.stringify({ zoomLink, slots }),
    });
    document.getElementById('zoomModal').close();
    await loadApplications();
  } catch (err) {
    showError(err.message);
  }
});

// ---------------- Delete confirmation ----------------

function openDeleteModal(app) {
  deleteTargetApp = app;
  document.getElementById('deleteApplicantName').textContent = app.full_name;
  document.getElementById('deleteConfirm').disabled = false;
  document.getElementById('deleteConfirm').textContent = 'Delete Permanently';
  document.getElementById('deleteModal').showModal();
}

document.getElementById('deleteCancel').addEventListener('click', () => {
  document.getElementById('deleteModal').close();
});

document.getElementById('deleteForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!deleteTargetApp) return;

  const confirmBtn = document.getElementById('deleteConfirm');
  confirmBtn.disabled = true;
  confirmBtn.textContent = 'Deleting…';

  try {
    showError('');
    await api(`/api/admin/applications/${deleteTargetApp.id}`, { method: 'DELETE' });
    document.getElementById('deleteModal').close();
    await loadApplications();
  } catch (err) {
    showError(err.message);
  } finally {
    confirmBtn.disabled = false;
    confirmBtn.textContent = 'Delete Permanently';
  }
});

// ---------------- Maintenance: regenerate all stored PDFs ----------------
// Re-renders every application's PDF with whatever the current template
// looks like (e.g. after a styling change) and overwrites the existing R2
// object at its existing key. Safe to click more than once.

const regenerateBtn = document.getElementById('regeneratePdfsBtn');
const regenerateStatus = document.getElementById('regeneratePdfsStatus');

if (regenerateBtn) {
  regenerateBtn.addEventListener('click', async () => {
    const confirmed = window.confirm(
      'This re-renders and re-saves the PDF for every application on file, using the current PDF template. ' +
      'It can take a little while if you have many applicants. Continue?'
    );
    if (!confirmed) return;

    regenerateBtn.disabled = true;
    regenerateStatus.className = 'hint';
    regenerateStatus.textContent = 'Regenerating PDFs… this may take a moment.';

    try {
      const data = await api('/api/admin/regenerate-pdfs', { method: 'POST' });
      const parts = [`Updated ${data.updated} of ${data.total}.`];
      if (data.skipped) parts.push(`${data.skipped} skipped (no PDF on file).`);
      if (data.failed) parts.push(`${data.failed} failed.`);
      regenerateStatus.className = data.failed ? 'hint error' : 'hint success';
      regenerateStatus.textContent = parts.join(' ');
      if (data.failed) {
        console.error('PDF regeneration failures:', data.failures);
      }
    } catch (err) {
      regenerateStatus.className = 'hint error';
      regenerateStatus.textContent = err.message;
    } finally {
      regenerateBtn.disabled = false;
    }
  });
}

// ---------------- Search + filter ----------------

let searchDebounce = null;
searchInput.addEventListener('input', () => {
  clearTimeout(searchDebounce);
  searchDebounce = setTimeout(() => {
    currentSearch = searchInput.value;
    render();
  }, 150);
});

statusFilter.addEventListener('change', () => {
  currentFilter = statusFilter.value;
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
