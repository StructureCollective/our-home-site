// Our Home -- public interview self-scheduling page.
// Reached via an emailed link (schedule/?token=...). Not behind Cloudflare
// Access -- the token itself (a random, unguessable ID) is what scopes this
// page to one applicant's one interview offer. See src/routes/schedule.js
// for the API this talks to.

const titleEl = document.getElementById('scheduleTitle');
const introEl = document.getElementById('scheduleIntro');
const errorEl = document.getElementById('scheduleError');
const slotsWrap = document.getElementById('scheduleSlots');
const zoomNoteEl = document.getElementById('zoomLinkNote');
const slotListEl = document.getElementById('slotList');
const confirmBtn = document.getElementById('confirmSlotBtn');
const successEl = document.getElementById('scheduleSuccess');
const successTitleEl = document.getElementById('scheduleSuccessTitle');
const successDetailEl = document.getElementById('scheduleSuccessDetail');

const token = new URLSearchParams(window.location.search).get('token');

let selectedSlot = null;

function showError(message) {
  introEl.style.display = 'none';
  errorEl.textContent = message;
  errorEl.style.display = 'block';
}

function formatSlot(iso) {
  try {
    return new Date(iso).toLocaleString(undefined, {
      weekday: 'long', month: 'long', day: 'numeric',
      hour: 'numeric', minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

function stageLabel(stage) {
  return stage === 'zoom' ? 'video (Zoom) interview' : 'phone interview';
}

function renderSlots(data) {
  slotListEl.innerHTML = '';
  data.slots.forEach((iso) => {
    const option = document.createElement('label');
    option.className = 'slot-option';
    option.innerHTML = `
      <input type="radio" name="slot" value="${iso}">
      <span class="slot-label">${formatSlot(iso)}</span>
    `;
    option.querySelector('input').addEventListener('change', () => {
      selectedSlot = iso;
      confirmBtn.disabled = false;
      [...slotListEl.children].forEach((el) => el.classList.toggle('selected', el === option));
    });
    slotListEl.appendChild(option);
  });

  if (data.stage === 'zoom' && data.zoomLink) {
    zoomNoteEl.innerHTML = `<strong>Zoom link (same for every option above):</strong> <a href="${data.zoomLink}">${data.zoomLink}</a>`;
    zoomNoteEl.style.display = 'block';
  }

  slotsWrap.style.display = 'block';
}

function renderAlreadyScheduled(data) {
  introEl.style.display = 'none';
  titleEl.textContent = 'Interview Already Confirmed';
  successTitleEl.textContent = "You're already confirmed!";
  successDetailEl.textContent = `Your ${stageLabel(data.stage)} is confirmed for ${formatSlot(data.chosenSlot)}.` +
    (data.stage === 'zoom' && data.zoomLink ? ` Zoom link: ${data.zoomLink}` : '');
  successEl.classList.add('visible');
}

async function loadDetails() {
  if (!token) {
    showError('This scheduling link is missing its token. Please use the link from your email exactly as sent.');
    return;
  }

  try {
    const res = await fetch(`/api/schedule/${encodeURIComponent(token)}`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || 'This scheduling link is invalid or has expired.');
    }

    introEl.textContent = `Hi ${(data.fullName || '').trim().split(/\s+/)[0] || 'there'}, please pick a time below for your ${stageLabel(data.stage)}${data.position ? ` for the ${data.position} position` : ''}.`;

    if (data.alreadyScheduled) {
      renderAlreadyScheduled(data);
      return;
    }

    renderSlots(data);
  } catch (err) {
    showError(err.message);
  }
}

confirmBtn.addEventListener('click', async () => {
  if (!selectedSlot) return;
  confirmBtn.disabled = true;
  confirmBtn.textContent = 'Confirming…';

  try {
    const res = await fetch(`/api/schedule/${encodeURIComponent(token)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chosenSlot: selectedSlot }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || 'Something went wrong confirming your time. Please try again.');
    }

    slotsWrap.style.display = 'none';
    introEl.style.display = 'none';
    successDetailEl.textContent = `Your ${stageLabel(data.stage)} is confirmed for ${formatSlot(data.chosenSlot)}. A confirmation email is on its way to you.`;
    successEl.classList.add('visible');
  } catch (err) {
    confirmBtn.disabled = false;
    confirmBtn.textContent = 'Confirm This Time';
    showError(err.message);
  }
});

loadDetails();
