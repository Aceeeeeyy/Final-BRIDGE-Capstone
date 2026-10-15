-- ============================================================
-- Migration 008 — Add zipgrade_id to student_roster
-- ============================================================
-- parseZipGradeRow() in grading.js builds a three-way matchKey:
--   externalId  (LRN / school ID)         — preferred
--   realName    (FirstName + LastName)     — fallback
--   zg:<id>     (ZipGrade internal ID)    — last resort
--
-- upload.js previously only implemented the first two branches, so any
-- CSV row that had no name AND no ExternalID (but did have a ZipGradeID)
-- fell through to rosterQuery.eq('real_name', '') and silently merged
-- every such anonymous row into the first student with a blank real_name.
--
-- This migration adds the zipgrade_id column so the third branch can be
-- stored and queried properly.
-- ============================================================

ALTER TABLE student_roster
  ADD COLUMN IF NOT EXISTS zipgrade_id TEXT;

-- Index mirrors the existing school_external and school_name indexes so
-- ZipGrade-ID-only roster lookups are equally fast.
CREATE INDEX IF NOT EXISTS idx_student_roster_school_zipgrade
  ON student_roster (school_name, zipgrade_id);
