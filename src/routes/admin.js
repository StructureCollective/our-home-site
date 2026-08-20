// Our Home -- /api/admin/* endpoints.
//
// All of these are only reachable in practice via ourhomenc.com/api/admin*,
// which the Cloudflare Access application protects. Each handler additionally
// checks requireAdmin() (see ../lib/access.js) as defense in depth.

import { requireAdmin } from '../lib/access.js';
import {
  listApplications,
  listAllApplicationsFull,
  getApplication,
  logActivity,
  randomToken,
  saveInterviewOffer,
} from '../lib/db.js';
import { sendEmail, phoneInterviewEmail, zoomInterviewEmail } from '../lib/email.js';
import { generateApplicationPdf } from '../lib/pdf.js';

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
//
// Body: { subject?, message?, slots: [iso, iso, iso] } -- exactly 3
// candidate times the admin is offering. Generates a one-time scheduling
// token and emails the applicant a link to /schedule/?token=... where they
// pick one of the 3 (see src/routes/schedule.js).
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
  const slots = Array.isArray(body.slots) ? body.slots.filter(Boolean) : [];
  if (slots.length !== 3) {
    return json({ error: 'Please offer exactly 3 candidate interview times.' }, 400);
  }

  const token = randomToken();
  const scheduleUrl = `${new URL(request.url).origin}/schedule/?token=${token}`;

  try {
    await sendEmail(env, {
      to: application.email,
      subject,
      html: phoneInterviewEmail({
        fullName: application.full_name,
        position: application.position,
        message: body.message,
        slots,
        scheduleUrl,
      }),
    });
  } catch (err) {
    return json({ error: `Email failed to send: ${err.message}` }, 502);
  }

  await saveInterviewOffer(env, id, { stage: 'phone', slots, token, actor: email });
  await logActivity(env, {
    applicationId: id,
    actor: email,
    action: 'phone_interview_email_sent',
    detail: JSON.stringify({ subject, message: body.message || null, slots }),
  });

  return json({ success: true });
}

// POST /api/admin/applications/:id/send-zoom
//
// Body: { zoomLink, message?, slots: [iso, iso, iso] } -- one Zoom link
// reused across all 3 offered times. Only allowed once the applicant has
// confirmed (not just been offered) a phone interview time.
export async function handleSendZoom(request, env, id) {
  const { email, response } = requireAdmin(request, env);
  if (!email) return response;

  const application = await getApplication(env, id);
  if (!application) return json({ error: 'Not found' }, 404);

  if (application.status !== 'phone_interview_scheduled') {
    return json({ error: 'Zoom interview can only be sent after the applicant has confirmed a phone interview time.' }, 409);
  }

  const body = await request.json().catch(() => ({}));
  const zoomLink = body.zoomLink && String(body.zoomLink).trim();
  if (!zoomLink) {
    return json({ error: 'zoomLink is required.' }, 400);
  }
  const slots = Array.isArray(body.slots) ? body.slots.filter(Boolean) : [];
  if (slots.length !== 3) {
    return json({ error: 'Please offer exactly 3 candidate interview times.' }, 400);
  }

  const token = randomToken();
  const scheduleUrl = `${new URL(request.url).origin}/schedule/?token=${token}`;

  try {
    await sendEmail(env, {
      to: application.email,
      subject: 'Our Home -- your video interview details',
      html: zoomInterviewEmail({
        fullName: application.full_name,
        zoomLink,
        message: body.message,
        slots,
        scheduleUrl,
      }),
    });
  } catch (err) {
    return json({ error: `Email failed to send: ${err.message}` }, 502);
  }

  await saveInterviewOffer(env, id, { stage: 'zoom', slots, token, zoomLink, actor: email });
  await logActivity(env, {
    applicationId: id,
    actor: email,
    action: 'zoom_email_sent',
    detail: JSON.stringify({ zoomLink, slots }),
  });

  return json({ success: true });
}

// POST /api/admin/regenerate-pdfs -- one-off / re-runnable maintenance tool.
// Re-renders every application's PDF with the current template (e.g. after
// a styling change like the formal letterhead) and overwrites the existing
// object in R2 at its existing pdf_key, so download links keep working
// unchanged. Safe to run more than once -- it only ever overwrites, never
// creates new rows or keys.
export async function handleRegeneratePdfs(request, env) {
  const { email, response } = requireAdmin(request, env);
  if (!email) return response;

  const applications = await listAllApplicationsFull(env);

  let updated = 0;
  let skipped = 0;
  const failures = [];

  for (const row of applications) {
    if (!row.pdf_key) {
      skipped += 1;
      continue;
    }
    try {
      const pdfBytes = await generateApplicationPdf(row, { env, request });
      await env.PDF_BUCKET.put(row.pdf_key, pdfBytes, {
        httpMetadata: { contentType: 'application/pdf' },
      });
      updated += 1;
    } catch (err) {
      failures.push({ id: row.id, error: String((err && err.message) || err) });
    }
  }

  try {
    await logActivity(env, {
      applicationId: null,
      actor: email,
      action: 'pdfs_regenerated',
      detail: JSON.stringify({ updated, skipped, failed: failures.length }),
    });
  } catch {
    // Non-fatal -- don't let an activity-log hiccup mask a successful regenerate.
  }

  return json({
    success: true,
    total: applications.length,
    updated,
    skipped,
    failed: failures.length,
    failures,
  });
}
