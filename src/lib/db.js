// Our Home -- D1 data access helpers.
//
// Every function here takes `env` (for env.DB) so route handlers stay thin.
// Column names are snake_case to match d1/schema.sql; the incoming form
// payload from the browser uses camelCase field names, so FIELD_MAP below
// is the single source of truth for that translation.

// Maps the application form's `name="..."` attributes (camelCase) to the
// `applications` table columns (snake_case). Keep this in sync with both
// applications/index.html and d1/schema.sql.
export const FIELD_MAP = {
  fullName: 'full_name',
  email: 'email',
  phone: 'phone',
  addressStreet: 'address_street',
  addressCity: 'address_city',
  addressState: 'address_state',
  addressZip: 'address_zip',

  position: 'position',
  employmentType: 'employment_type',
  startDate: 'start_date',
  referralSource: 'referral_source',

  daysAvailable: 'days_available',       // array -> comma-joined
  shiftPreference: 'shift_preference',   // array -> comma-joined
  hoursDesired: 'hours_desired',
  overnightOk: 'overnight_ok',

  ageEligible: 'age_eligible',
  workAuthorized: 'work_authorized',
  driversLicense: 'drivers_license',
  backgroundCheckConsent: 'background_check_consent',
  groupHomeExperience: 'group_home_experience',

  educationLevel: 'education_level',
  schoolName: 'school_name',
  certifications: 'certifications',
  childExperience: 'child_experience',

  employer1Name: 'employer1_name',
  employer1Title: 'employer1_title',
  employer1From: 'employer1_from',
  employer1To: 'employer1_to',
  employer1Supervisor: 'employer1_supervisor',
  employer1Reason: 'employer1_reason',

  employer2Name: 'employer2_name',
  employer2Title: 'employer2_title',
  employer2From: 'employer2_from',
  employer2To: 'employer2_to',
  employer2Supervisor: 'employer2_supervisor',
  employer2Reason: 'employer2_reason',

  reference1Name: 'reference1_name',
  reference1Relationship: 'reference1_relationship',
  reference1Phone: 'reference1_phone',
  reference1Email: 'reference1_email',

  reference2Name: 'reference2_name',
  reference2Relationship: 'reference2_relationship',
  reference2Phone: 'reference2_phone',
  reference2Email: 'reference2_email',

  signature: 'signature',
  signatureDate: 'signature_date',
};

const ARRAY_FIELDS = new Set(['daysAvailable', 'shiftPreference']);

// Fields that must be present (and non-empty) for a submission to be valid.
// Mirrors the `required` attributes in applications/index.html.
export const REQUIRED_FIELDS = [
  'fullName',
  'email',
  'employmentType',
  'overnightOk',
  'ageEligible',
  'workAuthorized',
  'driversLicense',
  'backgroundCheckConsent',
  'groupHomeExperience',
  'educationLevel',
];

/** Normalizes a raw submitted payload (camelCase, values may be arrays) into
 *  { columns, values, missing } ready for insertion / validation. */
export function normalizeApplication(payload) {
  const missing = REQUIRED_FIELDS.filter((f) => {
    const v = payload[f];
    if (Array.isArray(v)) return v.length === 0;
    return v === undefined || v === null || String(v).trim() === '';
  });

  const row = {};
  for (const [formField, column] of Object.entries(FIELD_MAP)) {
    let value = payload[formField];
    if (ARRAY_FIELDS.has(formField)) {
      value = Array.isArray(value) ? value.join(',') : (value || '');
    }
    if (value === undefined || value === '') value = null;
    row[column] = value;
  }

  return { row, missing };
}

export async function insertApplication(env, row, { pdfProvider, pdfKey, pdfUrl }) {
  const columns = [...Object.keys(row), 'pdf_provider', 'pdf_key', 'pdf_url'];
  const values = [...Object.values(row), pdfProvider, pdfKey, pdfUrl];
  const placeholders = columns.map(() => '?').join(', ');

  const result = await env.DB
    .prepare(`INSERT INTO applications (${columns.join(', ')}) VALUES (${placeholders})`)
    .bind(...values)
    .run();

  return result.meta.last_row_id;
}

const OVERVIEW_COLUMNS = [
  'id', 'full_name', 'email', 'phone', 'position', 'employment_type',
  'status', 'submitted_at', 'phone_interview_sent_at', 'zoom_sent_at',
  'phone_interview_slots', 'phone_interview_scheduled_at', 'phone_interview_resent_at',
  'zoom_interview_slots', 'zoom_interview_scheduled_at', 'zoom_link',
];

export async function listApplications(env) {
  const { results } = await env.DB
    .prepare(`SELECT ${OVERVIEW_COLUMNS.join(', ')} FROM applications ORDER BY submitted_at DESC`)
    .all();
  return results;
}

export async function getApplication(env, id) {
  return env.DB.prepare('SELECT * FROM applications WHERE id = ?').bind(id).first();
}

// Full rows (every column) for every application -- used by the PDF
// regeneration tool, which needs the same shape getApplication() returns.
export async function listAllApplicationsFull(env) {
  const { results } = await env.DB.prepare('SELECT * FROM applications ORDER BY id ASC').all();
  return results;
}

export async function updateStatus(env, id, { status, timestampColumn, actor }) {
  const setClauses = ['status = ?', 'status_updated_at = datetime(\'now\')', 'status_updated_by = ?'];
  const values = [status, actor];
  if (timestampColumn) {
    setClauses.push(`${timestampColumn} = datetime('now')`);
  }
  await env.DB
    .prepare(`UPDATE applications SET ${setClauses.join(', ')} WHERE id = ?`)
    .bind(...values, id)
    .run();
}

// Permanently removes an application row. The caller (handleDeleteApplication
// in routes/admin.js) is responsible for deleting the associated PDF out of
// R2 first -- this only touches D1.
export async function deleteApplication(env, id) {
  await env.DB.prepare('DELETE FROM applications WHERE id = ?').bind(id).run();
}

export async function logActivity(env, { applicationId, actor, action, detail }) {
  await env.DB
    .prepare('INSERT INTO activity_log (application_id, actor, action, detail) VALUES (?, ?, ?, ?)')
    .bind(applicationId, actor || null, action, detail || null)
    .run();
}

// ---------------- Interview self-scheduling ----------------
//
// Flow: an admin offers 3 candidate times (+ a Zoom link, for the zoom
// stage) from the dashboard. That's an "offer" (saveInterviewOffer). The
// applicant follows an emailed link containing a random per-stage token to
// a public page (getApplicationByToken looks the application up by it),
// picks one of the 3 times, and that pick is recorded
// (recordInterviewSchedule), which is what actually confirms the
// interview and flips status to "*_scheduled".

// Per-stage column/status names, so the offer/lookup/record helpers below
// don't have to repeat the phone-vs-zoom branching every time.
const STAGE_CONFIG = {
  phone: {
    slotsColumn: 'phone_interview_slots',
    tokenColumn: 'phone_interview_token',
    scheduledAtColumn: 'phone_interview_scheduled_at',
    sentTimestampColumn: 'phone_interview_sent_at',
    sentStatus: 'phone_interview_sent',
    scheduledStatus: 'phone_interview_scheduled',
  },
  zoom: {
    slotsColumn: 'zoom_interview_slots',
    tokenColumn: 'zoom_interview_token',
    scheduledAtColumn: 'zoom_interview_scheduled_at',
    // Column name predates the "_interview_" naming convention used
    // elsewhere; kept as-is to avoid an extra migration/rename.
    sentTimestampColumn: 'zoom_sent_at',
    sentStatus: 'zoom_interview_sent',
    scheduledStatus: 'zoom_interview_scheduled',
  },
};

/** Random, unguessable token for a public scheduling link. Not a JWT or
 *  anything parseable -- just an opaque lookup key. */
export function randomToken() {
  return crypto.randomUUID().replace(/-/g, '');
}

/** Records that an admin offered 3 candidate times for `stage`
 *  ('phone' | 'zoom'), generates/stores the scheduling token, and moves
 *  status to the corresponding "*_sent" value. For the zoom stage, also
 *  stores the single Zoom link that's reused across all 3 offered times. */
export async function saveInterviewOffer(env, id, { stage, slots, token, zoomLink, actor }) {
  const cfg = STAGE_CONFIG[stage];
  if (!cfg) throw new Error(`Unknown interview stage: ${stage}`);

  const setClauses = [
    `${cfg.slotsColumn} = ?`,
    `${cfg.tokenColumn} = ?`,
    `${cfg.sentTimestampColumn} = datetime('now')`,
    'status = ?',
    "status_updated_at = datetime('now')",
    'status_updated_by = ?',
  ];
  const values = [JSON.stringify(slots), token, cfg.sentStatus, actor];

  if (stage === 'zoom') {
    setClauses.push('zoom_link = ?');
    values.push(zoomLink || null);
  }

  await env.DB
    .prepare(`UPDATE applications SET ${setClauses.join(', ')} WHERE id = ?`)
    .bind(...values, id)
    .run();
}

/** Looks an application up by a public scheduling token, checking both the
 *  phone and zoom token columns. Returns { row, stage } or null. */
export async function getApplicationByToken(env, token) {
  if (!token) return null;
  const row = await env.DB
    .prepare('SELECT * FROM applications WHERE phone_interview_token = ? OR zoom_interview_token = ?')
    .bind(token, token)
    .first();
  if (!row) return null;
  const stage = row.phone_interview_token === token ? 'phone' : 'zoom';
  return { row, stage };
}

/** Marks that the original phone interview invite email has been resent
 *  once. Callers are expected to check phone_interview_resent_at is not
 *  already set before calling this -- it's a one-time-only action. */
export async function markPhoneInterviewResent(env, id) {
  await env.DB
    .prepare("UPDATE applications SET phone_interview_resent_at = datetime('now') WHERE id = ?")
    .bind(id)
    .run();
}

/** Records the applicant's chosen time for `stage` and moves status to the
 *  corresponding "*_scheduled" value. This -- not the original offer -- is
 *  what actually confirms the interview. */
export async function recordInterviewSchedule(env, id, { stage, chosenSlot }) {
  const cfg = STAGE_CONFIG[stage];
  if (!cfg) throw new Error(`Unknown interview stage: ${stage}`);

  await env.DB
    .prepare(
      `UPDATE applications SET ${cfg.scheduledAtColumn} = ?, status = ?, ` +
      `status_updated_at = datetime('now'), status_updated_by = 'applicant' WHERE id = ?`
    )
    .bind(chosenSlot, cfg.scheduledStatus, id)
    .run();
}
