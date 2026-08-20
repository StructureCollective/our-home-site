-- Our Home -- removes the foreign key constraint on activity_log.application_id.
--
-- Why: the delete-applicant feature is explicitly designed so the audit
-- trail survives after an applicant is deleted (see the comment in
-- handleDeleteApplication in src/routes/admin.js -- it stores the
-- applicant's name/email in the log detail "so the audit trail still
-- reads sensibly once the row itself is gone"). That's fundamentally
-- incompatible with an *enforced* foreign key: as soon as
-- migrate-0006-fix-activity-log-fk.sql correctly re-pointed this
-- constraint back at the real `applications` table, SQLite started
-- (correctly, per the constraint as declared) blocking any DELETE from
-- applications for a row that still has activity_log entries -- which
-- is every row, since the delete handler logs its own
-- 'application_deleted' entry immediately before deleting. That
-- surfaced as "Internal error" when clicking Delete in the dashboard.
--
-- Fix: drop the foreign key so activity_log.application_id is a plain
-- reference to an application's id, not an enforced relationship --
-- rows are allowed to point at an id that no longer exists in
-- applications once that applicant is deleted. The column, its NOT NULL
-- requirement, and its index are all kept exactly as before; only the
-- REFERENCES clause is removed. Every existing row is carried across
-- untouched.
--
-- Safe to run whether or not migrate-0006-fix-activity-log-fk.sql has
-- already been applied -- this rebuilds activity_log fresh from
-- whatever is currently there either way.
--
-- Run this once against the live database:
--   npx wrangler d1 execute our-home-applications --remote --file=./d1/migrate-0007-drop-activity-log-fk.sql
--
-- (Drop --remote to run it against your local dev database instead.)
-- Verified locally: reproduced the exact "FOREIGN KEY constraint failed"
-- failure on delete before this fix, confirmed delete succeeds after it
-- with zero data loss, and confirmed the deleted applicant's full audit
-- history survives intact (orphaned, but readable) while every other
-- applicant's data and log entries are untouched.

PRAGMA foreign_keys=OFF;

CREATE TABLE activity_log_new (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  application_id   INTEGER NOT NULL,
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
