-- ============================================================
-- 006_ai_report_gating_cleanup.sql
--
-- BACKGROUND: earlier versions of BRIDGE inserted a `reports` row the
-- instant an AI Intervention was GENERATED, regardless of whether the
-- teacher ever reviewed it. That meant Pending Review and even Rejected
-- recommendations could leave a "report" record behind. The app code has
-- since been fixed so a report is only ever created when a teacher clicks
-- Save (Accepted/Edited) on a recommendation — see the /review endpoint in
-- aiIntervention.js. This migration:
--
--   1. Adds `intervention_id` to `reports` so every future AI Intervention
--      report is traceable to exactly the intervention it was created
--      for (and can never be duplicated for the same intervention, via a
--      UNIQUE constraint).
--   2. Deletes the stale 'AI Recommendation' report rows left behind by
--      the old behavior — specifically, any such report that cannot be
--      matched to a currently Accepted/Edited intervention.
--   3. De-duplicates any leftover 'AI Recommendation' reports on
--      assessments that DO have an accepted intervention (the old code
--      could insert one on every single Generate/Regenerate click),
--      keeping only the most recent one per assessment.
--
-- SAFE TO RUN MORE THAN ONCE.
-- ============================================================

-- ─── 1. Add intervention_id, if missing ───────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'reports' AND column_name = 'intervention_id'
  ) THEN
    ALTER TABLE reports ADD COLUMN intervention_id UUID REFERENCES interventions(intervention_id) ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'reports_intervention_id_key'
  ) THEN
    ALTER TABLE reports ADD CONSTRAINT reports_intervention_id_key UNIQUE (intervention_id);
  END IF;
END $$;

COMMENT ON COLUMN reports.intervention_id IS 'The specific intervention this report was generated for (AI Recommendation reports only). NULL for report types unrelated to an intervention, or for legacy rows created before this column existed.';

-- ─── 2. Delete orphaned AI Recommendation reports ─────────────────────────
-- A report of type 'AI Recommendation' that isn't linked to a specific
-- intervention (intervention_id IS NULL — i.e. it predates this migration)
-- and whose assessment has NO currently Accepted/Edited intervention at
-- all is definitely stale: it can only have come from the old
-- generate-time insert for a recommendation that was never accepted
-- (left Pending Review, or was Regenerated/Rejected).
DELETE FROM reports r
WHERE r.report_type = 'AI Recommendation'
  AND r.intervention_id IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM interventions i
    WHERE i.assessment_id = r.assessment_id
      AND i.review_status IN ('Accepted', 'Edited')
  );

-- ─── 3. De-duplicate remaining legacy AI Recommendation reports ───────────
-- For assessments that DO have an accepted intervention, the old code
-- could still have left more than one 'AI Recommendation' report behind
-- (one per Generate/Regenerate click on that assessment). Keep only the
-- single most recent one per assessment so exports and any future report
-- listing reflect "one current report," matching the new one-report-per-
-- intervention behavior.
DELETE FROM reports r
WHERE r.report_type = 'AI Recommendation'
  AND r.intervention_id IS NULL
  AND r.report_id NOT IN (
    SELECT DISTINCT ON (assessment_id) report_id
    FROM reports
    WHERE report_type = 'AI Recommendation'
      AND intervention_id IS NULL
    ORDER BY assessment_id, generated_at DESC
  );
