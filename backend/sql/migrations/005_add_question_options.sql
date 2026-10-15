-- ============================================================
-- 005_add_question_options.sql
--
-- BUG FIX: the question builder was only ever saving the correct-answer
-- LETTER (correct_answer, e.g. "A" or "A,C") to the database. The actual
-- wording typed into option boxes A/B/C/D was kept in React state only and
-- was never sent to the backend, so it vanished the moment a teacher left
-- the question (or reopened the draft later) — the answer key survived,
-- the option text didn't.
--
-- This adds a `options` JSONB column to `questions` to store the option
-- text itself, e.g. ["Paris", "London", "Rome", "Berlin"], where array
-- index 0 corresponds to letter "A", index 1 to "B", and so on — matching
-- how `correct_answer` already encodes letters.
--
-- SAFE TO RUN MORE THAN ONCE: the column is only added if missing.
-- ============================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'questions' AND column_name = 'options'
  ) THEN
    ALTER TABLE questions ADD COLUMN options JSONB;
  END IF;
END $$;

COMMENT ON COLUMN questions.options IS 'Answer choice wording as a JSON array, e.g. ["Paris","London","Rome","Berlin"]. Array index 0 = letter "A", index 1 = "B", etc. — matching how correct_answer encodes letters. Existing rows created before this migration will have NULL here since their option wording was never captured.';
