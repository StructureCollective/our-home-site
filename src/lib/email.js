// Our Home -- outbound email via Resend (https://resend.com).
//
// Cloudflare Workers can't send SMTP, so we use Resend's plain HTTP API
// (a single fetch call, no SDK needed -- keeps the Worker bundle small).
//
// Requires a Worker secret RESEND_API_KEY (set via:
//   npx wrangler secret put RESEND_API_KEY
// ) and a "from" address on a domain verified in the Resend dashboard --
// set via the FROM_EMAIL var in wrangler.jsonc.
//
// Applicant-facing templates below are FIXED copy (approved wording) --
// the admin dashboard no longer offers a custom subject/message box. Only
// [Applicant First Name] / [Position Title] / [Scheduling Link] /
// [Interview Date] / [Interview Time and Time Zone] vary per send.

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

// Fixed subject lines for the four applicant-facing templates, plus the
// one-time phone-interview-invite resend. Keep these in sync with the
// wording the admin dashboard's help text references.
export const PHONE_INTERVIEW_SUBJECT = 'Phone Interview Invitation | Our Home';
export const PHONE_INTERVIEW_REMINDER_SUBJECT = 'Reminder: Phone Interview Invitation | Our Home';
export const ZOOM_INTERVIEW_SUBJECT = 'Schedule Your Zoom Interview | Our Home';
export const PHONE_CONFIRMATION_SUBJECT = 'Phone Interview Confirmation | Our Home';
export const ZOOM_CONFIRMATION_SUBJECT = 'Zoom Interview Confirmation | Our Home';

function wrapEmail(bodyHtml) {
  return `<!doctype html>
<html>
  <body style="font-family: -apple-system, Helvetica, Arial, sans-serif; color: #222; line-height: 1.5; max-width: 560px; margin: 0 auto; padding: 24px;">
    ${bodyHtml}
  </body>
</html>`;
}

// Shared closing block appended to every applicant-facing template.
const SIGN_OFF = `
  <p>Warm regards,<br>
  Hiring Team<br>
  Our Home | Greensboro, NC<br>
  Black &amp; Associates Global, Inc.</p>
`;

// Our Home operates out of Greensboro, NC -- every date/time shown in any
// outbound email (and on the public scheduling page) is rendered in
// Eastern Time regardless of the recipient's own timezone, so there's a
// single unambiguous "when" everyone is working from. America/New_York
// correctly resolves to EST or EDT depending on the date (handles daylight
// saving automatically).
const DISPLAY_TIME_ZONE = 'America/New_York';

// Used only by the internal admin notification email below (not part of
// the applicant-facing fixed templates).
function formatSlotForEmail(iso) {
  try {
    return new Date(iso).toLocaleString('en-US', {
      weekday: 'long', month: 'long', day: 'numeric',
      hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
      timeZone: DISPLAY_TIME_ZONE,
    });
  } catch {
    return iso;
  }
}

// Splits a chosen interview slot into separate Date / Time lines for the
// two confirmation templates.
function formatSlotDateTime(iso) {
  try {
    const d = new Date(iso);
    const date = d.toLocaleDateString('en-US', {
      weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
      timeZone: DISPLAY_TIME_ZONE,
    });
    const time = d.toLocaleTimeString('en-US', {
      hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
      timeZone: DISPLAY_TIME_ZONE,
    });
    return { date, time };
  } catch {
    return { date: iso, time: '' };
  }
}

function scheduleButtonHtml(scheduleUrl, label) {
  if (!scheduleUrl) return '';
  return `<p style="margin: 22px 0;">
    <a href="${scheduleUrl}" style="display:inline-block;background:#0b3550;color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:600;">${label}</a>
  </p>`;
}

function firstName(fullName) {
  return (fullName || '').trim().split(/\s+/)[0] || 'there';
}

// Phone interview invite -- sent once an application is reviewed.
export function phoneInterviewEmail({ fullName, position, scheduleUrl }) {
  const first = firstName(fullName);
  return wrapEmail(`
    <p>Hello ${first},</p>
    <p>Thank you for applying for the ${position || 'open'} position with Our Home. After reviewing your application, we would like to invite you to participate in an initial phone interview.</p>
    <p>Please use the link below to select an available date and time:</p>
    ${scheduleButtonHtml(scheduleUrl, 'Select an Interview Time')}
    <p>We will call you at the phone number provided on your application. This brief conversation will allow us to learn more about your experience, qualifications, and interest in the position. Candidates selected to move forward will be invited to a follow-up interview via Zoom.</p>
    <p>If you have any questions or need assistance with scheduling, please reply to this email.<br>
    We look forward to speaking with you!</p>
    ${SIGN_OFF}
  `);
}

// A one-time reminder resend of the original phone-interview invite --
// same offered times, same scheduling link -- for when an applicant says
// the first email never arrived.
export function phoneInterviewReminderEmail({ fullName, position, scheduleUrl }) {
  const first = firstName(fullName);
  return wrapEmail(`
    <p>Hello ${first},</p>
    <p>Just following up on your phone interview invitation for the ${position || 'open'} position with Our Home, in case our first email didn't reach you.</p>
    <p>Please use the link below to select an available date and time:</p>
    ${scheduleButtonHtml(scheduleUrl, 'Select an Interview Time')}
    <p>We will call you at the phone number provided on your application. If you have any questions or need assistance with scheduling, please reply to this email.<br>
    We look forward to speaking with you!</p>
    ${SIGN_OFF}
  `);
}

// Zoom interview invite -- sent after a phone interview is confirmed.
export function zoomInterviewEmail({ fullName, position, scheduleUrl }) {
  const first = firstName(fullName);
  return wrapEmail(`
    <p>Hello ${first},</p>
    <p>Thank you again for speaking with us during your initial phone interview. We enjoyed learning more about your experience and interest in the ${position || 'open'} position with Our Home.</p>
    <p>We would like to invite you to the next step in our hiring process, a Zoom interview. Please use the link below to select one of the three available interview times:</p>
    ${scheduleButtonHtml(scheduleUrl, 'Select an Interview Time')}
    <p>If you experience any difficulty scheduling your interview, please reply to this email for assistance. We look forward to speaking with you again!</p>
    ${SIGN_OFF}
  `);
}

// Sent to the applicant once they pick a phone interview time on the
// public scheduling page.
export function phoneInterviewConfirmationEmail({ fullName, position, chosenSlot }) {
  const first = firstName(fullName);
  const { date, time } = formatSlotDateTime(chosenSlot);
  return wrapEmail(`
    <p>Hello ${first},</p>
    <p>Thank you for scheduling your initial phone interview for the ${position || 'open'} position with Our Home.</p>
    <p>Your phone interview is confirmed for:<br>
    Date: ${date}<br>
    Time: ${time}</p>
    <p>A member of our team will call you at the phone number provided on your application. Please plan to be available a few minutes before your scheduled time.</p>
    <p>If you need to update your phone number or reschedule your interview, please reply to this email as soon as possible.</p>
    <p>We look forward to speaking with you!</p>
    ${SIGN_OFF}
  `);
}

// Sent to the applicant once they pick a Zoom interview time on the
// public scheduling page. This is the one place the actual Zoom link is
// shown to the applicant.
export function zoomInterviewConfirmationEmail({ fullName, position, chosenSlot, zoomLink }) {
  const first = firstName(fullName);
  const { date, time } = formatSlotDateTime(chosenSlot);
  return wrapEmail(`
    <p>Hello ${first},</p>
    <p>Thank you for scheduling your Zoom interview for the ${position || 'open'} position with Our Home.</p>
    <p>Your interview is confirmed for:<br>
    Date: ${date}<br>
    Time: ${time}</p>
    <p>The Zoom meeting link and access details are included in this confirmation email. Please join the meeting a few minutes early and confirm that your internet connection, camera, and microphone are working properly.</p>
    ${zoomLink ? `<p><strong>Zoom link:</strong> <a href="${zoomLink}">${zoomLink}</a></p>` : ''}
    <p>If you need to reschedule or experience any difficulty joining the meeting, please contact us as soon as possible.</p>
    <p>We look forward to speaking with you again!</p>
    ${SIGN_OFF}
  `);
}

// Sent to every address in ADMIN_EMAILS once an applicant confirms a
// time. Internal-only -- not one of the applicant-facing fixed templates.
export function interviewScheduledAdminEmail({ fullName, email, stage, chosenSlot, applicationId }) {
  const label = stage === 'zoom' ? 'Zoom interview' : 'Phone interview';
  return wrapEmail(`
    <p><strong>${label} confirmed</strong></p>
    <p>${fullName || 'An applicant'} (${email || 'no email on file'}) selected <strong>${formatSlotForEmail(chosenSlot)}</strong>.</p>
    ${applicationId ? `<p><a href="https://ourhomenc.com/admin/">View in the admin dashboard</a></p>` : ''}
    <p style="margin-top: 24px; color: #777; font-size: 13px;">Our Home admin notifications</p>
  `);
}
