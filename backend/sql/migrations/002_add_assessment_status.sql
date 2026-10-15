-- Migration: draft / status lifecycle for assessments
-- Run this in your Supabase SQL Editor if your `assessments` table already
-- exists (i.e. you ran the original schema.sql before this change).
-- Safe to run multiple times.

DO $$ BEGIN
    CREATE TYPE assessment_status AS ENUM ('Draft', 'Ready for Upload', 'Completed');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE assessments
    ADD COLUMN IF NOT EXISTS status     assessment_status NOT NULL DEFAULT 'Draft',
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- Every assessment that existed before this migration already has all of its
-- questions saved (the old flow only wrote to the DB on final save), so they
-- should be treated as published rather than as leftover drafts.
UPDATE assessments SET status = 'Ready for Upload' WHERE status = 'Draft';

-- Any assessment that already has score uploads recorded is Completed.
UPDATE assessments a
SET status = 'Completed'
WHERE EXISTS (
    SELECT 1 FROM assessment_scores s WHERE s.assessment_id = a.assessment_id
);

-- Drafts are now created before any questions exist, so total_items must be
-- allowed to be 0 while a test is still being built.
ALTER TABLE assessments DROP CONSTRAINT IF EXISTS assessments_total_items_check;
ALTER TABLE assessments ADD CONSTRAINT assessments_total_items_check CHECK (total_items >= 0);

COMMENT ON COLUMN assessments.status IS 'Draft = still being built, autosaved question-by-question. Ready for Upload = published, no scores yet. Completed = at least one CSV score upload has been processed.';
COMMENT ON COLUMN assessments.updated_at IS 'Bumped on every draft edit (title/term/question add-edit-delete); used to sort "My Tests" by most recently touched.';
