-- ============================================================
-- BRIDGE: Learning Gap Analyzer — Supabase Schema
-- Run this entire file in the Supabase SQL Editor
-- ============================================================

-- ─── Extensions ──────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ─── ENUMS ───────────────────────────────────────────────────
CREATE TYPE user_role          AS ENUM ('Teacher', 'Administrator');
CREATE TYPE assessment_type    AS ENUM ('Summative Test', 'Term Examination');
CREATE TYPE assessment_status  AS ENUM ('Draft', 'Ready for Upload', 'Completed');
CREATE TYPE term_type          AS ENUM ('Term 1', 'Term 2', 'Term 3');
CREATE TYPE descriptor_type    AS ENUM (
    'Outstanding',
    'Very Satisfactory',
    'Satisfactory',
    'Fairly Satisfactory',
    'Did Not Meet Expectations'
);
CREATE TYPE mastery_type       AS ENUM ('Mastered', 'Learning Gap');
CREATE TYPE report_type        AS ENUM (
    'Bar Chart',
    'Pie Chart',
    'Item Analysis',
    'Scores',
    'AI Recommendation'
);

-- ─── USERS ───────────────────────────────────────────────────
-- Mirrors Supabase Auth; stores extra profile info.
-- user_id is a REAL foreign key into auth.users(id) — it can never
-- drift out of sync with Supabase Auth, and deleting the auth user
-- automatically deletes the profile row too (ON DELETE CASCADE).
CREATE TABLE users (
    user_id       UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    first_name    TEXT NOT NULL,
    middle_name   TEXT,
    last_name     TEXT NOT NULL,
    email         TEXT NOT NULL UNIQUE,
    role          user_role NOT NULL DEFAULT 'Teacher',
    school_name   TEXT NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    -- Account lockout (see migration 007): tracks consecutive wrong-password
    -- attempts and, once the limit is hit, the timestamp until which login
    -- for this account is blocked.
    failed_login_attempts INT NOT NULL DEFAULT 0,
    lockout_until          TIMESTAMPTZ,
    -- Email verification (see migration 009): FALSE until the owner enters the
    -- 6-digit code emailed at signup. Login and user listings require TRUE.
    email_verified         BOOLEAN NOT NULL DEFAULT FALSE
);

-- ─── COMPETENCIES ────────────────────────────────────────────
CREATE TABLE competencies (
    competency_id   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    competency_name TEXT NOT NULL UNIQUE,
    description     TEXT
);

-- Seed the two MATATAG competencies
INSERT INTO competencies (competency_name, description) VALUES
    ('Tenses of Verbs',    'Analyzes student mastery in using correct verb tenses.'),
    ('Figures of Speech',  'Analyzes student understanding of figurative language.');

-- ─── STUDENTS ────────────────────────────────────────────────
-- Students are anonymized; real names are never stored.
CREATE TABLE students (
    student_id   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    code_name    TEXT NOT NULL,          -- e.g. "Student A", "S001"
    grade_level  TEXT NOT NULL DEFAULT 'Grade 6',
    section      TEXT,
    school_name  TEXT NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── ASSESSMENTS ─────────────────────────────────────────────
-- `status` tracks the draft lifecycle so a test-in-progress is never lost:
--   Draft            -> being built; questions are saved one at a time as the
--                        teacher adds them (see POST /assessments/:id/questions)
--   Ready for Upload -> published; locked from further question edits; ready
--                        to receive a CSV of scores at any time, even much later
--   Completed        -> at least one CSV score upload has been processed
CREATE TABLE assessments (
    assessment_id    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    assessment_title TEXT NOT NULL,
    assessment_type  assessment_type NOT NULL,
    term             term_type NOT NULL,
    school_year      TEXT NOT NULL,         -- e.g. '2026-2027' (see migration 010)
    total_items      INTEGER NOT NULL DEFAULT 0 CHECK (total_items >= 0),
    status           assessment_status NOT NULL DEFAULT 'Draft',
    created_by       UUID NOT NULL REFERENCES users(user_id) ON DELETE SET NULL,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── QUESTIONS ───────────────────────────────────────────────
CREATE TABLE questions (
    question_id      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    assessment_id    UUID NOT NULL REFERENCES assessments(assessment_id) ON DELETE CASCADE,
    question_number  INTEGER NOT NULL CHECK (question_number > 0),
    question_text    TEXT,                 -- optional: store question wording
    options          JSONB,                -- answer choice wording, e.g. ["Paris","London","Rome","Berlin"] where array index 0 = "A", 1 = "B", etc.
    competency_id    UUID NOT NULL REFERENCES competencies(competency_id),
    correct_answer   TEXT NOT NULL,        -- e.g. "A", "B", "C", "D" or comma-separated for multi
    UNIQUE (assessment_id, question_number)
);

-- ─── STUDENT ANSWERS ─────────────────────────────────────────
CREATE TABLE student_answers (
    answer_id       UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    student_id      UUID NOT NULL REFERENCES students(student_id) ON DELETE CASCADE,
    assessment_id   UUID NOT NULL REFERENCES assessments(assessment_id) ON DELETE CASCADE,
    question_id     UUID NOT NULL REFERENCES questions(question_id) ON DELETE CASCADE,
    student_answer  TEXT,                 -- NULL if left blank
    is_correct      BOOLEAN NOT NULL DEFAULT FALSE,
    UNIQUE (student_id, question_id)
);

-- ─── COMPETENCY RESULTS ──────────────────────────────────────
-- Computed per student × assessment × competency
CREATE TABLE competency_results (
    result_id      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    student_id     UUID NOT NULL REFERENCES students(student_id) ON DELETE CASCADE,
    assessment_id  UUID NOT NULL REFERENCES assessments(assessment_id) ON DELETE CASCADE,
    competency_id  UUID NOT NULL REFERENCES competencies(competency_id),
    total_items    INTEGER NOT NULL,
    correct_items  INTEGER NOT NULL,
    percentage     NUMERIC(5,2) NOT NULL,   -- 0.00 – 100.00
    descriptor     descriptor_type NOT NULL,
    mastery_status mastery_type NOT NULL,
    UNIQUE (student_id, assessment_id, competency_id)
);

-- ─── ASSESSMENT SUMMARY ──────────────────────────────────────
-- Overall score per student per assessment (for Score Tracking widget)
CREATE TABLE assessment_scores (
    score_id       UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    student_id     UUID NOT NULL REFERENCES students(student_id) ON DELETE CASCADE,
    assessment_id  UUID NOT NULL REFERENCES assessments(assessment_id) ON DELETE CASCADE,
    raw_score      INTEGER NOT NULL,
    total_items    INTEGER NOT NULL,
    percentage     NUMERIC(5,2) NOT NULL,
    descriptor     descriptor_type NOT NULL,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (student_id, assessment_id)
);

-- ─── INTERVENTIONS ───────────────────────────────────────────
CREATE TABLE interventions (
    intervention_id   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    assessment_id     UUID NOT NULL REFERENCES assessments(assessment_id) ON DELETE CASCADE,
    competency_id     UUID NOT NULL REFERENCES competencies(competency_id),
    generated_by      UUID NOT NULL REFERENCES users(user_id),
    weakness_summary  TEXT,              -- system-generated summary of gaps
    ai_recommendation TEXT,             -- AI response text
    ai_provider       TEXT,             -- which AI service generated this (Claude, ChatGPT, DeepSeek, Gemini)
    ai_model          TEXT,             -- specific model id used (e.g. claude-sonnet-4-6, gpt-4o)
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── REPORTS ─────────────────────────────────────────────────
CREATE TABLE reports (
    report_id      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    assessment_id  UUID NOT NULL REFERENCES assessments(assessment_id) ON DELETE CASCADE,
    intervention_id UUID REFERENCES interventions(intervention_id) ON DELETE CASCADE,
    generated_by   UUID NOT NULL REFERENCES users(user_id),
    report_type    report_type NOT NULL,
    report_title   TEXT NOT NULL,
    file_path      TEXT,                 -- optional: path if PDF stored in Supabase Storage
    generated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (intervention_id)             -- at most one report record per intervention (NULLs excluded)
);

-- ─── ROW-LEVEL SECURITY ──────────────────────────────────────
-- Enable RLS on every table; all access goes through the API
-- (service-role key bypasses RLS — keep it server-side only)
ALTER TABLE users               ENABLE ROW LEVEL SECURITY;
ALTER TABLE competencies        ENABLE ROW LEVEL SECURITY;
ALTER TABLE students            ENABLE ROW LEVEL SECURITY;
ALTER TABLE assessments         ENABLE ROW LEVEL SECURITY;
ALTER TABLE questions           ENABLE ROW LEVEL SECURITY;
ALTER TABLE student_answers     ENABLE ROW LEVEL SECURITY;
ALTER TABLE competency_results  ENABLE ROW LEVEL SECURITY;
ALTER TABLE assessment_scores   ENABLE ROW LEVEL SECURITY;
ALTER TABLE interventions       ENABLE ROW LEVEL SECURITY;
ALTER TABLE reports             ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users to read competencies (they're static reference data)
CREATE POLICY "Competencies readable by authenticated"
    ON competencies FOR SELECT
    USING (auth.role() = 'authenticated');

-- NOTE: All other table policies are enforced at the API layer
-- using the service-role key. Add user-specific policies here
-- if you later want direct Supabase client access from the frontend.

-- ─── SAFETY NET: auto-provision profile row ──────────────────
-- If a user is ever created directly in Supabase Auth (dashboard,
-- SQL, social login, etc.) instead of through POST /api/auth/signup,
-- this trigger creates a matching public.users row automatically so
-- login never fails with "Failed to load user profile." again.
-- Your /signup route still runs normally for new accounts; this
-- only fires as a fallback (ON CONFLICT DO NOTHING) so it never
-- overwrites data your route already inserted in the same instant.
CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.users (user_id, first_name, last_name, email, role, school_name, email_verified)
    VALUES (
        NEW.id,
        COALESCE(NEW.raw_user_meta_data->>'first_name', 'New'),
        COALESCE(NEW.raw_user_meta_data->>'last_name', 'User'),
        NEW.email,
        'Teacher',
        COALESCE(NEW.raw_user_meta_data->>'school_name', 'Unspecified'),
        (NEW.email_confirmed_at IS NOT NULL)
    )
    ON CONFLICT (user_id) DO NOTHING;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_new_auth_user();

-- ─── EMAIL VERIFICATION CLEANUP ──────────────────────────────
-- Deletes accounts still unverified after 24 hours so abandoned signups
-- don't squat on email addresses (see migration 009). pg_cron is optional:
-- schedule with cron.schedule(...) or run the function by hand.
CREATE INDEX IF NOT EXISTS idx_users_unverified_created
    ON public.users (created_at) WHERE email_verified = FALSE;

CREATE OR REPLACE FUNCTION public.cleanup_unverified_users()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
    removed_count INTEGER;
BEGIN
    WITH removed AS (
        DELETE FROM auth.users
        WHERE id IN (
            SELECT user_id FROM public.users
            WHERE email_verified = FALSE
              AND created_at < NOW() - INTERVAL '24 hours'
        )
        RETURNING id
    )
    SELECT COUNT(*) INTO removed_count FROM removed;
    RETURN removed_count;
END;
$$;

REVOKE ALL ON FUNCTION public.cleanup_unverified_users() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cleanup_unverified_users() TO service_role;