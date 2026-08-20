-- Our Home -- adds a "resend phone interview email" action for the admin
-- dashboard. Lets an admin re-send the original phone-interview invite
-- (same 3 offered times, same scheduling link) if an applicant says it
-- never arrived, without generating a new link or re-offering new times.
-- Limited to once per applicant (tracked via this timestamp).
--
-- Run this once against the live database:
--   npx wrangler d1 execute our-home-applications --remote --file=./d1/migrate-0005-phone-interview-resend.sql
--
-- (Drop --remote to run it against your local dev database instead.)

ALTER TABLE applications ADD COLUMN phone_interview_resent_at TEXT;
