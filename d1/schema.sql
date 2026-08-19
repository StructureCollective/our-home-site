/* Our Home -- applications database schema (Cloudflare D1 / SQLite)
   Run once in the D1 Console tab to set up the tables. */

CREATE TABLE IF NOT EXISTS applications (
  id                        INTEGER PRIMARY KEY AUTOINCREMENT,

  /* Applicant info */
  full_name                 TEXT NOT NULL,
  email                     TEXT NOT NULL,
  phone                     TEXT,
  address_street            TEXT,
  address_city              TEXT,
  address_state             TEXT,
  address_zip               TEXT,

  /* Position */
  position                  TEXT,
  employment_type           TEXT,
  start_date                TEXT,
  referral_source           TEXT,

  /* Availability */
  days_available            TEXT,   /* comma-separated, e.g. "Mon,Tue,Wed" */
  shift_preference          TEXT,   /* comma-separated, e.g. "Day,Evening" */
  hours_desired              INTEGER,
  overnight_ok               TEXT,

  /* Eligibility */
  age_eligible                TEXT,
  work_authorized             TEXT,
  drivers_license             TEXT,
  background_check_consent    TEXT,

  /* Education & certifications */
  education_level            TEXT,
  school_name                 TEXT,
  certifications               TEXT,
  child_experience             TEXT,

  /* Employment history (employer 1) */
  employer1_name              TEXT,
  employer1_title             TEXT,
  employer1_from               TEXT,
  employer1_to                 TEXT,
  employer1_supervisor         TEXT,
  employer1_reason             TEXT,

  /* Employment history (employer 2, optional) */
  employer2_name              TEXT,
  employer2_title             TEXT,
  employer2_from               TEXT,
  employer2_to                 TEXT,
  employer2_supervisor         TEXT,
  employer2_reason             TEXT,

  /* References */
  reference1_name              TEXT,
  reference1_relationship      TEXT,
  reference1_phone             TEXT,
  reference1_email             TEXT,
  reference2_name              TEXT,
  reference2_relationship      TEXT,
  reference2_phone             TEXT,
  reference2_email             TEXT,

  /* Certification / signature */
  signature                    TEXT,
  signature_date                TEXT,

  /* Completed application PDF */
  pdf_provider                  TEXT,   /* 'r2' or 'drive' */
  pdf_key                       TEXT,   /* R2 object key, or Google Drive file ID */
  pdf_url                       TEXT,   /* direct link, when available */

  /* Hiring workflow status */
  status                        TEXT NOT NULL DEFAULT 'submitted'
                                 CHECK (status IN (
                                   'submitted',
                                   'phone_interview_sent',
                                   'zoom_sent',
                                   'hired',
                                   'not_selected'
                                 )),
  phone_interview_sent_at        TEXT,
  zoom_sent_at                   TEXT,
  status_updated_at              TEXT,
  status_updated_by              TEXT,   /* admin email, from Cloudflare Access identity */

  submitted_at                   TEXT NOT NULL DEFAULT (datetime('now')),
  created_at                     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_applications_status ON applications(status);
CREATE INDEX IF NOT EXISTS idx_applications_submitted_at ON applications(submitted_at);

/* Per-action audit trail (who did what, when) -- useful with two+ admins */
CREATE TABLE IF NOT EXISTS activity_log (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  application_id   INTEGER NOT NULL REFERENCES applications(id),
  actor            TEXT,          /* admin email from Cloudflare Access */
  action           TEXT NOT NULL, /* e.g. 'status_change', 'phone_interview_email_sent', 'zoom_email_sent' */
  detail           TEXT,
  created_at       TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_activity_log_application_id ON activity_log(application_id);
