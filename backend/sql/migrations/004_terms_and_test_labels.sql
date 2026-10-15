-- ============================================================
-- 004_terms_and_test_labels.sql
--
-- DepEd now runs on a 3-Term calendar instead of 4 Quarters, and BRIDGE's
-- test-type labels are updated to match DepEd's own vocabulary:
--   assessment_type: 'Unit Test'           -> 'Summative Test'
--                     'Quarterly Assessment' -> 'Term Examination'
--   quarter (Q1-Q4)  -> term (Term 1-3)
--
-- SAFE TO RUN ON EITHER:
--   (a) an older database that still has 'Unit Test' / 'Quarterly
--       Assessment' and a `quarter` column, or
--   (b) a database created fresh from the CURRENT schema.sql, which
--       already ships with 'Summative Test' / 'Term Examination' and a
--       `term` column — in that case this migration is a no-op.
-- Every step below checks the current database state first, so it's also
-- safe to run more than once.
-- ============================================================

-- ─── 1. Relabel assessment_type values, only if the old labels exist ─────
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'assessment_type' AND e.enumlabel = 'Unit Test'
  ) THEN
    ALTER TYPE assessment_type RENAME VALUE 'Unit Test' TO 'Summative Test';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'assessment_type' AND e.enumlabel = 'Quarterly Assessment'
  ) THEN
    ALTER TYPE assessment_type RENAME VALUE 'Quarterly Assessment' TO 'Term Examination';
  END IF;
END $$;

-- ─── 2. Replace quarter_type (Q1-Q4) with term_type (Term 1-3), only if
--        the old `quarter` column still exists ───────────────────────────
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'assessments' AND column_name = 'quarter'
  ) THEN
    -- term_type / the term column may already exist if this migration
    -- partially ran before (e.g. it failed partway through last time).
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'term_type') THEN
      CREATE TYPE term_type AS ENUM ('Term 1', 'Term 2', 'Term 3');
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'assessments' AND column_name = 'term'
    ) THEN
      ALTER TABLE assessments ADD COLUMN term term_type;
    END IF;

    -- Map existing quarter data onto the new 3-term structure:
    --   Q1 -> Term 1, Q2 -> Term 2, Q3 -> Term 3, Q4 -> Term 3
    -- (DepEd's MATATAG 3-term calendar folds the old Q4 into Term 3.)
    -- Review/adjust this CASE mapping first if your school year data needs
    -- a different split.
    UPDATE assessments SET term = CASE quarter
        WHEN 'Q1' THEN 'Term 1'
        WHEN 'Q2' THEN 'Term 2'
        WHEN 'Q3' THEN 'Term 3'
        WHEN 'Q4' THEN 'Term 3'
    END::term_type
    WHERE term IS NULL;

    ALTER TABLE assessments ALTER COLUMN term SET NOT NULL;
    ALTER TABLE assessments DROP COLUMN quarter;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'quarter_type') THEN
    DROP TYPE quarter_type;
  END IF;
END $$;

COMMENT ON COLUMN assessments.term IS 'DepEd MATATAG term (Term 1, Term 2, or Term 3) this assessment belongs to.';
