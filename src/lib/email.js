// Our Home -- outbound email via Resend (https://resend.com).
//
// Cloudflare Workers can't send SMTP, so we use Resend's plain HTTP API
// (a single fetch call, no SDK needed -- keeps the Worker bundle small).
//
// Requires a Worker secret RESEND_API_KEY (set via:
//   npx wrangler secret put RESEND_API_KEY
// ) and a "from" address on a domain verified in the Resend dashboard --
// set via the FROM_EMAIL var in wrangler.jsonc.

export async function sendEmail(env, { to, subject, html, replyTo }) {
  if (!env.RESEND_API_KEY) {
    throw new Error('RESEND_API_KEY is not configured (wrangler secret put RESEND_API_KEY)');
  }
  if (!env.FROM_EMAIL) {
    throw new Error('FROM_EMAIL is not configured in wrangler.jsonc vars');
  }

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: env.FROM_EMAIL,
      to: [to],
      subject,
      html,
      reply_to: replyTo || env.FROM_EMAIL,
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Resend API error (${res.status}): ${detail}`);
  }

  return res.json();
}

function wrapEmail(bodyHtml) {
  return `<!doctype html>
<html>
  <body style="font-family: -apple-system, Helvetica, Arial, sans-serif; color: #222; line-height: 1.5; max-width: 560px; margin: 0 auto; padding: 24px;">
    ${bodyHtml}
    <p style="margin-top: 32px; color: #777; font-size: 13px;">-- Our Home</p>
  </body>
</html>`;
}

function formatSlotForEmail(iso) {
  try {
    return new Date(iso).toLocaleString('en-US', {
      weekday: 'long', month: 'long', day: 'numeric',
      hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
    });
  } catch {
    return iso;
  }
}

function slotListHtml(slots) {
  return (slots || []).map((s) => `<li>${formatSlotForEmail(s)}</li>`).join('');
}

function scheduleButtonHtml(scheduleUrl, label) {
  if (!scheduleUrl) return '';
  return `<p style="margin: 22px 0;">
    <a href="${scheduleUrl}" style="display:inline-block;background:#0b3550;color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:600;">${label}</a>
  </p>`;
}

export function phoneInterviewEmail({ fullName, position, message, slots, scheduleUrl }) {
  const first = (fullName || '').trim().split(/\s+/)[0] || 'there';
  return wrapEmail(`
    <p>Hi ${first},</p>
    <p>Thank you for applying${position ? ` for the <strong>${position}</strong> position` : ''} with Our Home. We'd love to learn more about you and would like to schedule a short phone interview.</p>
    ${message ? `<p>${message}</p>` : ''}
    ${slots && slots.length ? `
      <p>We've offered three times below -- please pick whichever works best for you:</p>
      <ul>${slotListHtml(slots)}</ul>
    ` : ''}
    ${scheduleButtonHtml(scheduleUrl, 'Choose Your Interview Time')}
    <p>Looking forward to speaking with you!</p>
  `);
}

export function zoomInterviewEmail({ fullName, zoomLink, message, slots, scheduleUrl }) {
  const first = (fullName || '').trim().split(/\s+/)[0] || 'there';
  return wrapEmail(`
    <p>Hi ${first},</p>
    <p>Thanks for taking the time to speak with us. We'd like to move forward with a video interview.</p>
    ${slots && slots.length ? `
      <p>We've offered three times below -- please pick whichever works best for you:</p>
      <ul>${slotListHtml(slots)}</ul>
    ` : ''}
    ${zoomLink ? `<p><strong>Zoom link (the same for whichever time you choose):</strong> <a href="${zoomLink}">${zoomLink}</a></p>` : ''}
    ${message ? `<p>${message}</p>` : ''}
    ${scheduleButtonHtml(scheduleUrl, 'Choose Your Interview Time')}
    <p>Please let us know if you have any trouble with the link or need to reschedule.</p>
  `);
}

// Sent to the applicant once they pick a time on the public scheduling page.
export function interviewScheduledApplicantEmail({ fullName, stage, chosenSlot, zoomLink }) {
  const first = (fullName || '').trim().split(/\s+/)[0] || 'there';
  const label = stage === 'zoom' ? 'video (Zoom) interview' : 'phone interview';
  return wrapEmail(`
    <p>Hi ${first},</p>
    <p>You're confirmed for your ${label} on <strong>${formatSlotForEmail(chosenSlot)}</strong>.</p>
    ${stage === 'zoom' && zoomLink ? `<p><strong>Zoom link:</strong> <a href="${zoomLink}">${zoomLink}</a></p>` : ''}
    <p>We look forward to speaking with you then. If anything comes up and you need to reschedule, just reply to this email.</p>
  `);
}

// Sent to every address in ADMIN_EMAILS once an applicant confirms a time.
export function interviewScheduledAdminEmail({ fullName, email, stage, chosenSlot, applicationId }) {
  const label = stage === 'zoom' ? 'Zoom interview' : 'Phone interview';
  return wrapEmail(`
    <p><strong>${label} confirmed</strong></p>
    <p>${fullName || 'An applicant'} (${email || 'no email on file'}) selected <strong>${formatSlotForEmail(chosenSlot)}</strong>.</p>
    ${applicationId ? `<p><a href="https://ourhomenc.com/admin/">View in the admin dashboard</a></p>` : ''}
  `);
}
