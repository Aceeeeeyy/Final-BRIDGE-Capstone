-- ============================================================
-- BRIDGE — Migration 003: Security fixes + real-world features
-- Run this AFTER schema.sql (and 001/002 if present) in the
-- Supabase SQL Editor. Safe to re-run (idempotent where possible).
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- FIX 1 — Real anonymization of student data (RA 10173)
-- ────────────────────────────────────────────────────────────
-- Previously, students.code_name was populated with the student's actual
-- FirstName + LastName from the ZipGrade CSV — contradicting the paper's
-- claim (Ch. I, Scope and Limitations) that data is "anonymized through the
-- use of code names." This migration:
--   1. Adds a restricted-access roster table to hold the real-name <->
--      system-code mapping (needed so re-uploading a later CSV for the same
--      student links to the same record instead of creating a duplicate).
--   2. Adds a per-school atomic code generator (S0001, S0002, ...).
--   3. Backfills any students already in the database: their existing
--      code_name (which, pre-fix, held a real name) is moved into the
--      roster and replaced with a freshly generated code.

CREATE TABLE IF NOT EXISTS student_roster (
    roster_id    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    student_id   UUID NOT NULL UNIQUE REFERENCES students(student_id) ON DELETE CASCADE,
    real_name    TEXT,           -- FirstName + LastName from ZipGrade, if present
    external_id  TEXT,           -- LRN / school ID from ZipGrade's ExternalID column, if present
    school_name  TEXT NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- RLS is enabled with NO select/insert/update policies attached, which
-- means Postgres denies all access by default to anon/authenticated
-- Supabase roles. Only the backend's service-role client (used exclusively
-- server-side, never shipped to the browser) can read or write this table.
-- This is the "separate access-restricted table" the real-name<->code
-- mapping lives in, kept apart from every other table the dashboard,
-- reports, and AI prompts read from.
ALTER TABLE student_roster ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_student_roster_school_external ON student_roster (school_name, external_id);
CREATE INDEX IF NOT EXISTS idx_student_roster_school_name     ON student_roster (school_name, real_name);

-- Per-school sequence table backing next_student_code() below.
CREATE TABLE IF NOT EXISTS student_code_counters (
    school_name TEXT PRIMARY KEY,
    last_seq    INTEGER NOT NULL DEFAULT 0
);
ALTER TABLE student_code_counters ENABLE ROW LEVEL SECURITY;

-- Atomically issues the next "S0001"-style code for a school. Single
-- UPDATE...RETURNING is safe under concurrent uploads (no read-then-write
-- race), unlike computing MAX(code_name)+1 in application code.
CREATE OR REPLACE FUNCTION next_student_code(p_school_name TEXT)
RETURNS TEXT AS $$
DECLARE
    v_seq INTEGER;
BEGIN
    INSERT INTO student_code_counters (school_name, last_seq)
    VALUES (p_school_name, 1)
    ON CONFLICT (school_name)
    DO UPDATE SET last_seq = student_code_counters.last_seq + 1
    RETURNING last_seq INTO v_seq;

    RETURN 'S' || LPAD(v_seq::TEXT, 4, '0');
END;
$$ LANGUAGE plpgsql;

-- One-time backfill: any student row created before this migration has its
-- real name sitting in code_name. Move it to student_roster and replace it
-- with a generated code. Idempotent — skips students that already have a
-- roster row (i.e. re-running this migration is safe).
DO $$
DECLARE
    r RECORD;
    v_new_code TEXT;
BEGIN
    FOR r IN SELECT student_id, code_name, school_name FROM students LOOP
        IF NOT EXISTS (SELECT 1 FROM student_roster WHERE student_id = r.student_id) THEN
            v_new_code := next_student_code(r.school_name);
            INSERT INTO student_roster (student_id, real_name, school_name)
                VALUES (r.student_id, r.code_name, r.school_name);
            UPDATE students SET code_name = v_new_code WHERE student_id = r.student_id;
        END IF;
    END LOOP;
END $$;

-- ────────────────────────────────────────────────────────────
-- FIX 5 — Refresh tokens (short-lived access token)
-- ────────────────────────────────────────────────────────────
-- Access tokens now expire in 15 minutes (see auth.js). refresh_tokens
-- backs the rotation flow: each refresh revokes the old token and issues a
-- new access+refresh pair, so a token copied off a shared school computer
-- stops working within minutes instead of staying valid for the whole
-- 8-hour school day.
CREATE TABLE IF NOT EXISTS refresh_tokens (
    token_id     UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id      UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    token_hash   TEXT NOT NULL UNIQUE,   -- SHA-256 hash; the raw token is never stored
    expires_at   TIMESTAMPTZ NOT NULL,
    revoked_at   TIMESTAMPTZ,
    replaced_by  UUID REFERENCES refresh_tokens(token_id),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE refresh_tokens ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user ON refresh_tokens (user_id);

-- ────────────────────────────────────────────────────────────
-- FIX 7 — Audit log
-- ────────────────────────────────────────────────────────────
-- Tracks who did what and when for actions that touch minors' assessment
-- data or AI-generated recommendations — this is what turns the paper's
-- RA 10173 compliance claim into something a school's Data Protection
-- Officer could actually review.
CREATE TABLE IF NOT EXISTS audit_logs (
    log_id       UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id      UUID REFERENCES users(user_id) ON DELETE SET NULL,
    action       TEXT NOT NULL,       -- e.g. 'LOGIN', 'CSV_UPLOAD', 'AI_INTERVENTION_GENERATE'
    entity_type  TEXT,                -- e.g. 'assessment', 'intervention', 'competency'
    entity_id    UUID,
    metadata     JSONB,               -- free-form context (row counts, ip, error summaries, etc.)
    ip_address   TEXT,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_audit_logs_user    ON audit_logs (user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON audit_logs (created_at DESC);

-- ────────────────────────────────────────────────────────────
-- FIX 9 — Teacher review step for AI interventions
-- ────────────────────────────────────────────────────────────
CREATE TYPE intervention_review_status AS ENUM ('Pending Review', 'Accepted', 'Edited', 'Rejected');

ALTER TABLE interventions
    ADD COLUMN IF NOT EXISTS review_status         intervention_review_status NOT NULL DEFAULT 'Pending Review',
    ADD COLUMN IF NOT EXISTS final_recommendation   TEXT,              -- teacher-edited text, when review_status = 'Edited'
    ADD COLUMN IF NOT EXISTS reviewed_by             UUID REFERENCES users(user_id),
    ADD COLUMN IF NOT EXISTS reviewed_at             TIMESTAMPTZ;

-- ────────────────────────────────────────────────────────────
-- FIX 10 — Configurable competency taxonomy
-- ────────────────────────────────────────────────────────────
-- Competencies were previously two hardcoded, immutable seed rows. This
-- makes them CRUD-manageable by Administrators (see routes/competencies.js)
-- while keeping the two MATATAG competencies used in the study intact.
-- is_active supports soft-delete: questions/results already reference a
-- competency_id, so a competency can be retired without breaking history.
ALTER TABLE competencies
    ADD COLUMN IF NOT EXISTS is_active   BOOLEAN NOT NULL DEFAULT TRUE,
    ADD COLUMN IF NOT EXISTS created_by  UUID REFERENCES users(user_id),
    ADD COLUMN IF NOT EXISTS created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW();
