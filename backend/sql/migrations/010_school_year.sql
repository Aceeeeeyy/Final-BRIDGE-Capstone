-- ============================================================
-- 010_school_year.sql
--
-- Adds `school_year` to assessments so the Competency Trend can tell
-- "Term 1 of SY 2025-2026" apart from "Term 1 of SY 2026-2027". Before
-- this, every Term 1 result ever recorded was merged into a single point.
--
-- The Philippine school year opens in June, so existing rows are
-- backfilled from created_at: Jun-Dec -> "<year>-<year+1>",
-- Jan-May -> "<year-1>-<year>". Review the backfill if a test was
-- created in a different school year than the one it belongs to.
--
-- (students.section already exists; upload.js now fills it from
-- ZipGrade's QuizClass column when present.)
-- SAFE TO RUN MORE THAN ONCE.
-- ============================================================

ALTER TABLE assessments ADD COLUMN IF NOT EXISTS school_year TEXT;

UPDATE assessments
SET school_year = CASE
      WHEN EXTRACT(MONTH FROM created_at) >= 6
        THEN EXTRACT(YEAR FROM created_at)::int     || '-' || (EXTRACT(YEAR FROM created_at)::int + 1)
      ELSE (EXTRACT(YEAR FROM created_at)::int - 1) || '-' ||  EXTRACT(YEAR FROM created_at)::int
    END
WHERE school_year IS NULL;

ALTER TABLE assessments ALTER COLUMN school_year SET NOT NULL;

COMMENT ON COLUMN assessments.school_year IS 'DepEd school year this assessment belongs to, e.g. 2026-2027.';
