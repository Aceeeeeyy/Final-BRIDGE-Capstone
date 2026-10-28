-- ============================================================
-- 011 — Competencies belong to ONE school
-- ------------------------------------------------------------
-- Schools are independent: an Administrator manages the competency
-- list of their own school only. Before this migration the list was a
-- single shared table, so one school's admin could rename/retire a
-- competency for every school.
--
-- What this does (safe to re-run):
--   1. adds competencies.school_name
--   2. copies every existing (shared) competency into EACH school, so no
--      school starts with an empty list
--   3. re-points questions / competency_results / interventions to their
--      own school's copy, based on the school of the teacher who created
--      the assessment — all history is preserved
--   4. removes the old shared rows once nothing references them
--   5. names are unique PER SCHOOL (case-insensitive), not globally
-- ============================================================

BEGIN;

ALTER TABLE competencies ADD COLUMN IF NOT EXISTS school_name TEXT;

-- The global UNIQUE(competency_name) must go: two schools may both have
-- "Tenses of Verbs".
ALTER TABLE competencies DROP CONSTRAINT IF EXISTS competencies_competency_name_key;

DO $$
DECLARE
  legacy RECORD;
  sch    TEXT;
  schools TEXT[];
BEGIN
  -- The three supported schools (keep in sync with signupSchema) plus any
  -- school that already has users.
  SELECT ARRAY(
    SELECT DISTINCT s FROM (
      SELECT unnest(ARRAY[
        'Talon Elementary School',
        'Talon 3 Elementary School',
        'Pamplona Elementary School Central'
      ]) AS s
      UNION
      SELECT school_name FROM users WHERE school_name IS NOT NULL
    ) x
  ) INTO schools;

  FOR legacy IN SELECT * FROM competencies WHERE school_name IS NULL LOOP
    -- 2. one copy per school (skip if a previous run already made it)
    FOREACH sch IN ARRAY schools LOOP
      INSERT INTO competencies (competency_name, description, is_active, created_by, created_at, school_name)
      SELECT legacy.competency_name, legacy.description, legacy.is_active, legacy.created_by, legacy.created_at, sch
      WHERE NOT EXISTS (
        SELECT 1 FROM competencies c
        WHERE c.school_name = sch AND lower(c.competency_name) = lower(legacy.competency_name)
      );
    END LOOP;

    -- 3. re-point history to the owning school's copy
    UPDATE questions q
       SET competency_id = n.competency_id
      FROM assessments a
      JOIN users u ON u.user_id = a.created_by
      JOIN competencies n ON n.school_name = u.school_name
                         AND lower(n.competency_name) = lower(legacy.competency_name)
     WHERE q.assessment_id = a.assessment_id
       AND q.competency_id = legacy.competency_id;

    UPDATE competency_results r
       SET competency_id = n.competency_id
      FROM assessments a
      JOIN users u ON u.user_id = a.created_by
      JOIN competencies n ON n.school_name = u.school_name
                         AND lower(n.competency_name) = lower(legacy.competency_name)
     WHERE r.assessment_id = a.assessment_id
       AND r.competency_id = legacy.competency_id;

    UPDATE interventions i
       SET competency_id = n.competency_id
      FROM assessments a
      JOIN users u ON u.user_id = a.created_by
      JOIN competencies n ON n.school_name = u.school_name
                         AND lower(n.competency_name) = lower(legacy.competency_name)
     WHERE i.assessment_id = a.assessment_id
       AND i.competency_id = legacy.competency_id;

    -- 4. drop the shared row only if nothing still points at it
    DELETE FROM competencies c
     WHERE c.competency_id = legacy.competency_id
       AND NOT EXISTS (SELECT 1 FROM questions           WHERE competency_id = c.competency_id)
       AND NOT EXISTS (SELECT 1 FROM competency_results  WHERE competency_id = c.competency_id)
       AND NOT EXISTS (SELECT 1 FROM interventions       WHERE competency_id = c.competency_id);
  END LOOP;

  -- Anything left with no school is data whose owner could not be resolved
  -- (e.g. an assessment whose creator was deleted). Keep it, but retired,
  -- so it can never be picked in any school.
  UPDATE competencies SET is_active = FALSE WHERE school_name IS NULL;

  IF NOT EXISTS (SELECT 1 FROM competencies WHERE school_name IS NULL) THEN
    ALTER TABLE competencies ALTER COLUMN school_name SET NOT NULL;
  ELSE
    RAISE NOTICE '011: some competencies still have no school (orphaned history). They were retired; school_name left nullable.';
  END IF;
END $$;

-- 5. unique per school, ignoring case
CREATE UNIQUE INDEX IF NOT EXISTS uq_competencies_school_name
    ON competencies (school_name, lower(competency_name));

COMMIT;
