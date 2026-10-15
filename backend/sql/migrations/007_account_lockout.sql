-- ============================================================
-- 007_account_lockout.sql
--
-- FEATURE: Account lockout after repeated failed login attempts.
-- Adds per-account tracking so /api/auth/login can lock a specific
-- teacher/admin account for a standard cool-down period after 5
-- consecutive wrong-password attempts, independent of the existing
-- IP-based loginLimiter (rate limiting throttles a network address;
-- this protects one account even if attempts come from many IPs).
--
-- Run this AFTER schema.sql and migrations 001-006 in the Supabase
-- SQL Editor. Safe to re-run (idempotent).
-- ============================================================

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS failed_login_attempts INT NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS lockout_until          TIMESTAMPTZ;

COMMENT ON COLUMN users.failed_login_attempts IS
    'Consecutive wrong-password attempts since the last successful login or the last lockout. Reset to 0 on success or once a lockout is triggered.';
COMMENT ON COLUMN users.lockout_until IS
    'If set and in the future, login is blocked for this account until this timestamp (standard 15-minute cool-down after 5 failed attempts).';

-- Fast lookup: /api/auth/login queries by email on every attempt to check
-- and update lockout state.
CREATE INDEX IF NOT EXISTS idx_users_email_lockout ON users (email, lockout_until);
