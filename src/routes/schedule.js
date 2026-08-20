// Our Home -- public interview self-scheduling API.
//
// Reached from the link an applicant gets by email after an admin offers
// interview times (see handleSendPhoneInterview / handleSendZoom in
// src/routes/admin.js). Deliberately NOT behind Cloudflare Access -- an
// applicant isn't a staff member. Protected only by an unguessable
// per-stage token, the same pattern as any "pick a time" link.

import {
  getApplicationByToken,
  recordInterviewSchedule,
  logActivity,
} from '../lib/db.js';
import {
  sendEmail,
  interviewScheduledApplicantEmail,
  interviewScheduledAdminEmail,
} from '../lib/email.js';

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function adminEmailList(env) {
  return (env.ADMIN_EMAILS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function slotsAndScheduledAt(row, stage) {
  const slotsRaw = stage === 'phone' ? row.phone_interview_slots : row.zoom_interview_slots;
  const scheduledAt = stage === 'phone' ? row.phone_interview_scheduled_at : row.zoom_interview_scheduled_at;
  let slots = [];
  try { slots = JSON.parse(slotsRaw || '[]'); } catch { slots = []; }
  return { slots, scheduledAt };
}

// GET /api/schedule/:token -- what the public page loads to show the
// applicant their 3 offered times, or their already-confirmed time.
export async function handleScheduleGet(request, env, token) {
  const found = await getApplicationByToken(env, token);
  if (!found) return json({ error: 'This scheduling link is invalid or has expired.' }, 404);

  const { row, stage } = found;
  const { slots, scheduledAt } = slotsAndScheduledAt(row, stage);

  return json({
    fullName: row.full_name,
    position: row.position,
    stage,
    slots,
    zoomLink: stage === 'zoom' ? row.zoom_link : null,
    alreadyScheduled: Boolean(scheduledAt),
    chosenSlot: scheduledAt || null,
  });
}

// POST /api/schedule/:token -- applicant picks one of the 3 offered times.
// Body: { chosenSlot }. Recording the pick is what actually confirms the
// interview (flips status to "*_scheduled") and triggers confirmation
// emails to the applicant and every admin.
export async function handleSchedulePost(request, env, token) {
  const found = await getApplicationByToken(env, token);
  if (!found) return json({ error: 'This scheduling link is invalid or has expired.' }, 404);

  const { row, stage } = found;
  const { slots, scheduledAt } = slotsAndScheduledAt(row, stage);

  if (scheduledAt) {
    return json({ error: 'A time has already been confirmed for this interview.' }, 409);
  }

  const body = await request.json().catch(() => ({}));
  const chosenSlot = body.chosenSlot;
  if (!chosenSlot || !slots.includes(chosenSlot)) {
    return json({ error: 'Please choose one of the offered times.' }, 400);
  }

  await recordInterviewSchedule(env, row.id, { stage, chosenSlot });

  try {
    await sendEmail(env, {
      to: row.email,
      subject: stage === 'zoom'
        ? 'Our Home -- your video interview is confirmed'
        : 'Our Home -- your phone interview is confirmed',
      html: interviewScheduledApplicantEmail({
        fullName: row.full_name,
        stage,
        chosenSlot,
        zoomLink: stage === 'zoom' ? row.zoom_link : null,
      }),
    });
  } catch (err) {
    // The schedule is already recorded -- don't fail the request over a
    // confirmation-email hiccup, just log it.
    console.error('Applicant confirmation email failed:', err);
  }

  for (const adminEmail of adminEmailList(env)) {
    try {
      await sendEmail(env, {
        to: adminEmail,
        subject: `${row.full_name} confirmed a ${stage === 'zoom' ? 'Zoom' : 'phone'} interview time`,
        html: interviewScheduledAdminEmail({
          fullName: row.full_name,
          email: row.email,
          stage,
          chosenSlot,
          applicationId: row.id,
        }),
      });
    } catch (err) {
      console.error(`Admin confirmation email to ${adminEmail} failed:`, err);
    }
  }

  try {
    await logActivity(env, {
      applicationId: row.id,
      actor: row.email,
      action: stage === 'zoom' ? 'zoom_interview_scheduled' : 'phone_interview_scheduled',
      detail: JSON.stringify({ chosenSlot }),
    });
  } catch {
    // Non-fatal.
  }

  return json({ success: true, stage, chosenSlot });
}
