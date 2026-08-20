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
  deleteApplication,
  logActivity,
  randomToken,
  saveInterviewOffer,
  markPhoneInterviewResent,
} from '../lib/db.js';
import {
  sendEmail,
  phoneInterviewEmail,
  phoneInterviewReminderEmail,
  zoomInterviewEmail,
  PHONE_INTERVIEW_SUBJECT,
  PHONE_INTERVIEW_REMINDER_SUBJECT,
  ZOOM_INTERVIEW_SUBJECT,
} from '../lib/email.js';
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
// Body: { slots: [iso, iso, iso] } -- exactly 3 candidate times the admin
// is offering. Generates a one-time scheduling token and emails the
// applicant a link to /schedule/?token=... where they pick one of the 3
// (see src/routes/schedule.js). The email itself uses a fixed template --
// there's no admin-customizable subject or message anymore.
export async function handleSendPhoneInterview(request, env, id) {
  const { email, response } = requireAdmin(request, env);
  if (!email) return response;

  const application = await getApplication(env, id);
  if (!application) return json({ error: 'Not found' }, 404);

  if (application.status !== 'submitted') {
    return json({ error: `Cannot send a phone interview invite -- current status is "${application.status}".` }, 409);
  }

  const body = await request.json().catch(() => ({}));
  const slots = Array.isArray(body.slots) ? body.slots.filter(Boolean) : [];
  if (slots.length !== 3) {
    return json({ error: 'Please offer exactly 3 candidate interview times.' }, 400);
  }

  const token = randomToken();
  const scheduleUrl = `${new URL(request.url).origin}/schedule/?token=${token}`;

  try {
    await sendEmail(env, {
      to: application.email,
      subject: PHONE_INTERVIEW_SUBJECT,
      html: phoneInterviewEmail({
        fullName: application.full_name,
        position: application.position,
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
    detail: JSON.stringify({ slots }),
  });

  return json({ success: true });
}

// POST /api/admin/applications/:id/resend-phone-interview
//
// Re-sends the ORIGINAL phone interview invite -- same 3 offered times,
// same scheduling link -- for when an applicant says it never arrived.
// Allowed exactly once per applicant, and only while still waiting on
// them to pick a time (not after they've scheduled or moved on).
export async function handleResendPhoneInterview(request, env, id) {
  const { email, response } = requireAdmin(request, env);
  if (!email) return response;

  const application = await getApplication(env, id);
  if (!application) return json({ error: 'Not found' }, 404);

  if (application.status !== 'phone_interview_sent') {
    return json({ error: 'The phone interview invite can only be resent while waiting on the applicant to pick a time.' }, 409);
  }
  if (application.phone_interview_resent_at) {
    return json({ error: 'This invite has already been resent once.' }, 409);
  }
  if (!application.phone_interview_token || !application.phone_interview_slots) {
    return json({ error: 'No scheduling link is on file for this applicant -- try sending a new phone interview invite instead.' }, 409);
  }

  const scheduleUrl = `${new URL(request.url).origin}/schedule/?token=${application.phone_interview_token}`;

  try {
    await sendEmail(env, {
      to: application.email,
      subject: PHONE_INTERVIEW_REMINDER_SUBJECT,
      html: phoneInterviewReminderEmail({
        fullName: application.full_name,
        position: application.position,
        scheduleUrl,
      }),
    });
  } catch (err) {
    return json({ error: `Email failed to send: ${err.message}` }, 502);
  }

  await markPhoneInterviewResent(env, id);
  await logActivity(env, {
    applicationId: id,
    actor: email,
    action: 'phone_interview_email_resent',
  });

  return json({ success: true });
}

// POST /api/admin/applications/:id/send-zoom
//
// Body: { zoomLink, slots: [iso, iso, iso] } -- one Zoom link reused
// across all 3 offered times. Only allowed once the applicant has
// confirmed (not just been offered) a phone interview time. The Zoom
// link itself isn't shown to the applicant until they confirm a time --
// this invite email only carries the scheduling link.
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
      subject: ZOOM_INTERVIEW_SUBJECT,
      html: zoomInterviewEmail({
        fullName: application.full_name,
        position: application.position,
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

// DELETE /api/admin/applications/:id -- permanently removes an application
// and its stored PDF. The admin dashboard confirms with the user before
// making this call; there's no undo once it happens.
export async function handleDeleteApplication(request, env, id) {
  const { email, response } = requireAdmin(request, env);
  if (!email) return response;

  const application = await getApplication(env, id);
  if (!application) return json({ error: 'Not found' }, 404);

  // Log while the row (and the id it references) still exists, and keep
  // the applicant's name/email in the detail so the audit trail still
  // reads sensibly once the row itself is gone.
  try {
    await logActivity(env, {
      applicationId: id,
      actor: email,
      action: 'application_deleted',
      detail: JSON.stringify({ fullName: application.full_name, email: application.email }),
    });
  } catch {
    // Non-fatal.
  }

  if (application.pdf_key) {
    try {
      await env.PDF_BUCKET.delete(application.pdf_key);
    } catch {
      // Non-fatal -- proceed with deleting the DB row even if the R2
      // object was already gone or briefly unreachable.
    }
  }

  await deleteApplication(env, id);

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
