-- Our Home -- adds the new "have you worked in a group home or similar
-- environment before?" application question.
--
-- Run this once against the live database before deploying the code that
-- depends on it:
--   npx wrangler d1 execute our-home-applications --remote --file=./d1/migrate-0003-group-home-experience.sql
--
-- (Drop --remote to run it against your local dev database instead.)

ALTER TABLE applications ADD COLUMN group_home_experience TEXT;
