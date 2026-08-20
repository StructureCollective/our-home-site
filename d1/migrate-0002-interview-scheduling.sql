-- Our Home -- adds interview self-scheduling.
--
-- Flow: admin offers 3 candidate times (+ a Zoom link, for the Zoom stage)
-- from the admin dashboard. The applicant gets an emailed link to a public
-- page where they pick one of the 3 times. Picking a time sends a
-- confirmation email to the applicant and to every admin, and updates the
-- application's status.
--
-- Run this once against the live database before deploying the code that
-- depends on it:
--   npx wrangler d1 execute our-home-applications --remote --file=./d1/migrate-0002-interview-scheduling.sql
--
-- (Drop --remote to run it against your local dev database instead.)

ALTER TABLE applications ADD COLUMN phone_interview_slots TEXT;        -- JSON array of 3 ISO datetimes offered
ALTER TABLE applications ADD COLUMN phone_interview_token TEXT;        -- random token for the public scheduling link
ALTER TABLE applications ADD COLUMN phone_interview_scheduled_at TEXT; -- ISO datetime the applicant picked

ALTER TABLE applications ADD COLUMN zoom_interview_slots TEXT;
ALTER TABLE applications ADD COLUMN zoom_interview_token TEXT;
ALTER TABLE applications ADD COLUMN zoom_interview_scheduled_at TEXT;
ALTER TABLE applications ADD COLUMN zoom_link TEXT;                    -- the Zoom meeting link offered alongside the 3 times

-- Keep status naming consistent now that phone interviews have both a
-- "_sent" and "_scheduled" status: phone_interview_sent /
-- phone_interview_scheduled / zoom_interview_sent / zoom_interview_scheduled.
-- Any application already sitting at the old "zoom_sent" status moves to
-- the new name so it still shows up correctly on the dashboard.
UPDATE applications SET status = 'zoom_interview_sent' WHERE status = 'zoom_sent';

CREATE INDEX IF NOT EXISTS idx_applications_phone_token ON applications(phone_interview_token);
CREATE INDEX IF NOT EXISTS idx_applications_zoom_token ON applications(zoom_interview_token);
