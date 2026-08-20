-- Our Home -- fixes a dangling foreign key on activity_log left behind by
-- migrate-0004-fix-status-check.sql.
--
-- What happened: migrate-0004 ran `ALTER TABLE applications RENAME TO
-- applications_old` as part of rebuilding the applications table (to fix
-- the status CHECK constraint). SQLite's default behavior automatically
-- rewrites foreign key clauses in OTHER tables that reference a renamed
-- table -- so activity_log.application_id's `REFERENCES applications(id)`
-- was silently rewritten to `REFERENCES applications_old(id)` the moment
-- the rename happened. migrate-0004 then dropped applications_old at the
-- end (as intended, since a fresh `applications` table had already been
-- built), leaving activity_log's foreign key pointing at a table that no
-- longer exists.
--
-- That's harmless for reads, but any INSERT into activity_log validates
-- the foreign key and fails with:
--   D1_ERROR: no such table: main.applications_old: SQLITE_ERROR
-- Several admin actions log an activity entry right after doing their
-- real work and don't guard that call in a try/catch, so this surfaced
-- as an "Internal error" on: viewing/downloading a PDF, sending a phone
-- interview invite, resending a phone interview invite, and sending a
-- Zoom interview invite. In each of those cases the underlying action
-- (the email send, the status/offer update) had already completed
-- successfully -- only the activity-log entry (and the HTTP response)
-- failed. Other call sites (delete, PDF regeneration, applicant
-- self-scheduling) already wrapped logActivity in a try/catch, so those
-- kept working, just silently missing their audit-log entries.
--
-- This rebuilds activity_log with the foreign key corrected to point at
-- the real `applications` table, carrying every existing row across
-- untouched, and recreates its one index.
--
-- Run this once against the live database:
--   npx wrangler d1 execute our-home-applications --remote --file=./d1/migrate-0006-fix-activity-log-fk.sql
--
-- (Drop --remote to run it against your local dev database instead.)
-- Verified locally against a copy of the exact current production schema
-- (including the dangling reference) before delivery -- reproduces the
-- reported error, confirms the fix resolves it with zero data loss, and
-- confirms the foreign key still correctly enforces integrity afterward.

PRAGMA foreign_keys=OFF;

CREATE TABLE activity_log_new (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  application_id   INTEGER NOT NULL REFERENCES applications(id),
  actor            TEXT,          /* admin email from Cloudflare Access */
  action           TEXT NOT NULL, /* e.g. 'status_change', 'phone_interview_email_sent', 'zoom_email_sent' */
  detail           TEXT,
  created_at       TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO activity_log_new (id, application_id, actor, action, detail, created_at)
SELECT id, application_id, actor, action, detail, created_at
FROM activity_log;

DROP TABLE activity_log;

ALTER TABLE activity_log_new RENAME TO activity_log;

CREATE INDEX idx_activity_log_application_id ON activity_log(application_id);

PRAGMA foreign_keys=ON;
