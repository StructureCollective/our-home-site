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

export function phoneInterviewEmail({ fullName, position, message }) {
  const first = (fullName || '').trim().split(/\s+/)[0] || 'there';
  return wrapEmail(`
    <p>Hi ${first},</p>
    <p>Thank you for applying${position ? ` for the <strong>${position}</strong> position` : ''} with Our Home. We'd love to learn more about you and would like to schedule a short phone interview.</p>
    ${message ? `<p>${message}</p>` : '<p>Please reply to this email with a few times that work well for you in the next week, and we\'ll get something on the calendar.</p>'}
    <p>Looking forward to speaking with you!</p>
  `);
}

export function zoomInterviewEmail({ fullName, zoomLink, interviewTime, message }) {
  const first = (fullName || '').trim().split(/\s+/)[0] || 'there';
  return wrapEmail(`
    <p>Hi ${first},</p>
    <p>Thanks for taking the time to speak with us. We'd like to move forward with a video interview.</p>
    ${interviewTime ? `<p><strong>When:</strong> ${interviewTime}</p>` : ''}
    ${zoomLink ? `<p><strong>Zoom link:</strong> <a href="${zoomLink}">${zoomLink}</a></p>` : ''}
    ${message ? `<p>${message}</p>` : ''}
    <p>Please let us know if you have any trouble with the link or need to reschedule.</p>
  `);
}
