-- Our Home -- fixes the `status` CHECK constraint, which still only allowed
-- the original five values ('submitted', 'phone_interview_sent', 'zoom_sent',
-- 'hired', 'not_selected') even after the interview-scheduling feature
-- introduced three new statuses ('phone_interview_scheduled',
-- 'zoom_interview_sent', 'zoom_interview_scheduled'). SQLite has no way to
-- alter a CHECK constraint in place, so this rebuilds the table with the
-- corrected constraint and copies every row across untouched.
--
-- This ALSO adds `group_home_experience` (the new "have you worked in a
-- group home or similar environment before?" application question), which
-- hadn't been added to the live database yet -- so this migration replaces
-- the separate migrate-0003-group-home-experience.sql; you do not need to
-- run that one if you run this one.
--
-- Run this once against the live database:
--   npx wrangler d1 execute our-home-applications --remote --file=./d1/migrate-0004-fix-status-check.sql
--
-- (Drop --remote to run it against your local dev database instead.)

PRAGMA foreign_keys=OFF;

DROP INDEX IF EXISTS idx_applications_status;
DROP INDEX IF EXISTS idx_applications_submitted_at;
DROP INDEX IF EXISTS idx_applications_phone_token;
DROP INDEX IF EXISTS idx_applications_zoom_token;

ALTER TABLE applications RENAME TO applications_old;

CREATE TABLE applications (
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
  days_available            TEXT,
  shift_preference          TEXT,
  hours_desired             INTEGER,
  overnight_ok              TEXT,

  /* Eligibility */
  age_eligible               TEXT,
  work_authorized            TEXT,
  drivers_license            TEXT,
  background_check_consent   TEXT,
  group_home_experience       TEXT,

  /* Education & certifications */
  education_level            TEXT,
  school_name                TEXT,
  certifications             TEXT,
  child_experience            TEXT,

  /* Employment history (employer 1) */
  employer1_name             TEXT,
  employer1_title            TEXT,
  employer1_from             TEXT,
  employer1_to               TEXT,
  employer1_supervisor       TEXT,
  employer1_reason           TEXT,

  /* Employment history (employer 2, optional) */
  employer2_name             TEXT,
  employer2_title            TEXT,
  employer2_from             TEXT,
  employer2_to               TEXT,
  employer2_supervisor       TEXT,
  employer2_reason           TEXT,

  /* References */
  reference1_name            TEXT,
  reference1_relationship    TEXT,
  reference1_phone           TEXT,
  reference1_email           TEXT,
  reference2_name            TEXT,
  reference2_relationship    TEXT,
  reference2_phone           TEXT,
  reference2_email           TEXT,

  /* Certification / signature */
  signature                  TEXT,
  signature_date             TEXT,

  /* Completed application PDF */
  pdf_provider               TEXT,   /* 'r2' or 'drive' */
  pdf_key                    TEXT,   /* R2 object key, or Google Drive file ID */
  pdf_url                    TEXT,   /* direct link, when available */

  /* Hiring workflow status -- corrected CHECK list */
  status                     TEXT NOT NULL DEFAULT 'submitted'
                             CHECK (status IN (
                               'submitted',
                               'phone_interview_sent',
                               'phone_interview_scheduled',
                               'zoom_interview_sent',
                               'zoom_interview_scheduled',
                               'hired',
                               'not_selected'
                             )),
  phone_interview_sent_at    TEXT,
  zoom_sent_at               TEXT,
  status_updated_at          TEXT,
  status_updated_by          TEXT,   /* admin email, from Cloudflare Access identity */

  submitted_at               TEXT NOT NULL DEFAULT (datetime('now')),
  created_at                 TEXT NOT NULL DEFAULT (datetime('now')),

  /* Interview self-scheduling */
  phone_interview_slots         TEXT,
  phone_interview_token          TEXT,
  phone_interview_scheduled_at   TEXT,
  zoom_interview_slots           TEXT,
  zoom_interview_token            TEXT,
  zoom_interview_scheduled_at    TEXT,
  zoom_link                      TEXT
);

INSERT INTO applications (
  id, full_name, email, phone, address_street, address_city, address_state, address_zip,
  position, employment_type, start_date, referral_source,
  days_available, shift_preference, hours_desired, overnight_ok,
  age_eligible, work_authorized, drivers_license, background_check_consent,
  education_level, school_name, certifications, child_experience,
  employer1_name, employer1_title, employer1_from, employer1_to, employer1_supervisor, employer1_reason,
  employer2_name, employer2_title, employer2_from, employer2_to, employer2_supervisor, employer2_reason,
  reference1_name, reference1_relationship, reference1_phone, reference1_email,
  reference2_name, reference2_relationship, reference2_phone, reference2_email,
  signature, signature_date,
  pdf_provider, pdf_key, pdf_url,
  status, phone_interview_sent_at, zoom_sent_at, status_updated_at, status_updated_by,
  submitted_at, created_at,
  phone_interview_slots, phone_interview_token, phone_interview_scheduled_at,
  zoom_interview_slots, zoom_interview_token, zoom_interview_scheduled_at, zoom_link
)
SELECT
  id, full_name, email, phone, address_street, address_city, address_state, address_zip,
  position, employment_type, start_date, referral_source,
  days_available, shift_preference, hours_desired, overnight_ok,
  age_eligible, work_authorized, drivers_license, background_check_consent,
  education_level, school_name, certifications, child_experience,
  employer1_name, employer1_title, employer1_from, employer1_to, employer1_supervisor, employer1_reason,
  employer2_name, employer2_title, employer2_from, employer2_to, employer2_supervisor, employer2_reason,
  reference1_name, reference1_relationship, reference1_phone, reference1_email,
  reference2_name, reference2_relationship, reference2_phone, reference2_email,
  signature, signature_date,
  pdf_provider, pdf_key, pdf_url,
  -- Finish the zoom_sent -> zoom_interview_sent rename that migrate-0002
  -- attempted (it would have been a no-op then if no row had reached that
  -- status yet).
  CASE WHEN status = 'zoom_sent' THEN 'zoom_interview_sent' ELSE status END,
  phone_interview_sent_at, zoom_sent_at, status_updated_at, status_updated_by,
  submitted_at, created_at,
  phone_interview_slots, phone_interview_token, phone_interview_scheduled_at,
  zoom_interview_slots, zoom_interview_token, zoom_interview_scheduled_at, zoom_link
FROM applications_old;

DROP TABLE applications_old;

CREATE INDEX idx_applications_status ON applications(status);
CREATE INDEX idx_applications_submitted_at ON applications(submitted_at);
CREATE INDEX idx_applications_phone_token ON applications(phone_interview_token);
CREATE INDEX idx_applications_zoom_token ON applications(zoom_interview_token);

PRAGMA foreign_keys=ON;
