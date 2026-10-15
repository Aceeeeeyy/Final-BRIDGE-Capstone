-- ============================================================
-- 009_email_verification.sql
--
-- FEATURE: Email verification at signup. Every new Teacher/Administrator
-- must confirm their address with a 6-digit code (sent by Supabase Auth)
-- before the account can log in. This migration adds the app-side flag,
-- protects existing accounts, and adds a cleanup for abandoned signups.
--
-- Run this AFTER schema.sql and migrations 001-008 in the Supabase
-- SQL Editor. Safe to re-run (idempotent): the backfill only happens the
-- one time the column is actually created, so re-running it later will
-- NOT mark genuinely unverified accounts as verified.
-- ============================================================

-- 1. Column + one-time backfill. Every account that exists right now signed
--    up under the old flow (email_confirm: true), so it is marked verified and
--    nobody is locked out. New rows default to FALSE.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'email_verified'
    ) THEN
        ALTER TABLE public.users ADD COLUMN email_verified BOOLEAN NOT NULL DEFAULT FALSE;
        -- Every row is FALSE at this instant, so the WHERE matches all existing
        -- accounts (it is only here so the SQL editor doesn't flag a bare UPDATE).
        UPDATE public.users SET email_verified = TRUE WHERE email_verified = FALSE;
    END IF;
END $$;

COMMENT ON COLUMN public.users.email_verified IS
    'TRUE once the owner proved the address with the emailed 6-digit code (POST /api/auth/verify-email). Login and every user listing require TRUE.';

-- 2. Safety-net trigger: a user created directly in Supabase Auth (dashboard,
--    SQL) that is already confirmed there should not be locked out, so the
--    placeholder profile takes its flag from auth.users.email_confirmed_at.
--    A normal signup is unconfirmed at this point, so it starts as FALSE.
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

-- 3. Cleanup of abandoned signups. Deletes the Supabase Auth user for every
--    account still unverified after 24 hours; the users row (and anything
--    cascading from it) goes with it, freeing the email address again.
--    Returns how many accounts were removed.
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

-- Not callable from the public API (anon / authenticated roles).
REVOKE ALL ON FUNCTION public.cleanup_unverified_users() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cleanup_unverified_users() TO service_role;

-- 4. Scheduling (OPTIONAL). If pg_cron is enabled (Dashboard -> Database ->
--    Extensions), uncomment to run the cleanup hourly. Without it, run
--    SELECT public.cleanup_unverified_users(); manually now and then.
--
-- SELECT cron.schedule(
--     'cleanup-unverified-users',
--     '0 * * * *',
--     $$SELECT public.cleanup_unverified_users();$$
-- );
