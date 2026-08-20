// Our Home -- /api/admin/* endpoints.
//
// All of these are only reachable in practice via ourhomenc.com/api/admin*,
// which the Cloudflare Access application protects. Each handler additionally
// checks requireAdmin() (see ../lib/access.js) as defense in depth.

import { requireAdmin } from '../lib/access.js';
import {
  listApplications,
  getApplication,
  updateStatus,
  logActivity,
} from '../lib/db.js';
import { sendEmail, phoneInterviewEmail, zoomInterviewEmail } from '../lib/email.js';

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// GET /api/admin/me -- lets the admin UI show who's logged in.
export async function handleMe(request, env) {
  const { email, response } = requireAdmin(request, env);
  if (!email) return response;
  return json({ email });
}

// GET /api/admin/applications
export async function handleList(request, env) {
  const { email, response } = requireAdmin(request, env);
  if (!email) return response;

  const applications = await listApplications(env);
  return json({ applications });
}

// GET /api/admin/applications/:id
export async function handleDetail(request, env, id) {
  const { email, response } = requireAdmin(request, env);
  if (!email) return response;

  const application = await getApplication(env, id);
  if (!application) return json({ error: 'Not found' }, 404);
  return json({ application });
}

// GET /api/admin/applications/:id/pdf
export async function handlePdf(request, env, id) {
  const { email, response } = requireAdmin(request, env);
  if (!email) return response;

  const application = await getApplication(env, id);
  if (!application || !application.pdf_key) return new Response('Not found', { status: 404 });

  const object = await env.PDF_BUCKET.get(application.pdf_key);
  if (!object) return new Response('PDF not found in storage', { status: 404 });

  await logActivity(env, {
    applicationId: id,
    actor: email,
    action: 'pdf_viewed',
  });

  return new Response(object.body, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="application-${id}.pdf"`,
    },
  });
}

// POST /api/admin/applications/:id/send-phone-interview
export async function handleSendPhoneInterview(request, env, id) {
  const { email, response } = requireAdmin(request, env);
  if (!email) return response;

  const application = await getApplication(env, id);
  if (!application) return json({ error: 'Not found' }, 404);

  if (application.status !== 'submitted') {
    return json({ error: `Cannot send a phone interview invite -- current status is "${application.status}".` }, 409);
  }

  const body = await request.json().catch(() => ({}));
  const subject = (body.subject && body.subject.trim()) || 'Our Home -- next steps on your application';

  try {
    await sendEmail(env, {
      to: application.email,
      subject,
      html: phoneInterviewEmail({
        fullName: application.full_name,
        position: application.position,
        message: body.message,
      }),
    });
  } catch (err) {
    return json({ error: `Email failed to send: ${err.message}` }, 502);
  }

  await updateStatus(env, id, {
    status: 'phone_interview_sent',
    timestampColumn: 'phone_interview_sent_at',
    actor: email,
  });
  await logActivity(env, {
    applicationId: id,
    actor: email,
    action: 'phone_interview_email_sent',
    detail: JSON.stringify({ subject, message: body.message || null }),
  });

  return json({ success: true });
}

// POST /api/admin/applications/:id/send-zoom
export async function handleSendZoom(request, env, id) {
  const { email, response } = requireAdmin(request, env);
  if (!email) return response;

  const application = await getApplication(env, id);
  if (!application) return json({ error: 'Not found' }, 404);

  if (application.status !== 'phone_interview_sent') {
    return json({ error: 'Zoom interview can only be sent after the phone interview email has been sent.' }, 409);
  }

  const body = await request.json().catch(() => ({}));
  if (!body.zoomLink) {
    return json({ error: 'zoomLink is required.' }, 400);
  }

  try {
    await sendEmail(env, {
      to: application.email,
      subject: 'Our Home -- your video interview details',
      html: zoomInterviewEmail({
        fullName: application.full_name,
        zoomLink: body.zoomLink,
        interviewTime: body.interviewTime,
        message: body.message,
      }),
    });
  } catch (err) {
    return json({ error: `Email failed to send: ${err.message}` }, 502);
  }

  await updateStatus(env, id, {
    status: 'zoom_sent',
    timestampColumn: 'zoom_sent_at',
    actor: email,
  });
  await logActivity(env, {
    applicationId: id,
    actor: email,
    action: 'zoom_email_sent',
    detail: JSON.stringify({ zoomLink: body.zoomLink, interviewTime: body.interviewTime || null }),
  });

  return json({ success: true });
}
