// Our Home -- POST /api/apply
//
// Public endpoint (not behind Access): receives the job application form,
// renders it to a PDF, stores the PDF in R2, and records the submission in D1.

import { generateApplicationPdf } from '../lib/pdf.js';
import { normalizeApplication, insertApplication, getApplication } from '../lib/db.js';

function slugify(name) {
  return String(name || 'applicant')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 40) || 'applicant';
}

export async function handleApply(request, env) {
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  let payload;
  try {
    payload = await request.json();
  } catch {
    return jsonError('Invalid request body -- expected JSON.', 400);
  }

  if (!payload.certifyAccurate || !payload.certifyVerify) {
    return jsonError('You must check both certification boxes before submitting.', 400);
  }

  const { row, missing } = normalizeApplication(payload);
  if (missing.length > 0) {
    return jsonError(`Missing required field(s): ${missing.join(', ')}`, 400);
  }

  // Insert first (without PDF info) so we have an id to put on the PDF and
  // in the R2 object key, then update with the PDF location.
  const id = await insertApplication(env, row, { pdfProvider: 'r2', pdfKey: null, pdfUrl: null });
  const full = await getApplication(env, id);

  let pdfBytes;
  try {
    pdfBytes = await generateApplicationPdf(full, { env, request });
  } catch (err) {
    return jsonError('Could not generate the application PDF. Please try again or contact us directly.', 500);
  }

  const key = `applications/${id}-${slugify(row.full_name)}.pdf`;
  await env.PDF_BUCKET.put(key, pdfBytes, {
    httpMetadata: { contentType: 'application/pdf' },
  });

  await env.DB.prepare('UPDATE applications SET pdf_key = ? WHERE id = ?').bind(key, id).run();

  return new Response(JSON.stringify({ success: true, id }), {
    status: 201,
    headers: { 'Content-Type': 'application/json' },
  });
}

function jsonError(message, status) {
  return new Response(JSON.stringify({ success: false, error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
