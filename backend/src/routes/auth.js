import { Router } from 'express';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { createClient } from '@supabase/supabase-js';
import { supabase, authClient } from '../supabaseClient.js';
import { requireAuth } from '../middleware/auth.js';
import { validateBody, signupSchema, loginSchema, refreshSchema, forgotPasswordSchema, resetPasswordSchema, verifyEmailSchema, resendVerificationSchema, verifyLoginSchema, resendLoginCodeSchema } from '../validation/schemas.js';
import { loginLimiter, signupLimiter, refreshLimiter, forgotPasswordLimiter, forgotPasswordIpLimiter, resetPasswordLimiter, verifyEmailLimiter, resendVerificationLimiter, resendVerificationIpLimiter, verifyLoginLimiter, resendLoginCodeLimiter, resendLoginCodeIpLimiter } from '../middleware/rateLimiters.js';
import { logAction } from '../utils/auditLog.js';
import { signLoginChallenge, verifyLoginChallenge } from '../utils/loginChallenge.js';

const router = Router();

// Access tokens are now short-lived (15 min) — a stolen token from a shared
// school computer stops working almost immediately. Long-lived sessions
// are handled by refresh tokens instead (rotated on every use, revocable
// server-side, unlike a stateless JWT).
const ACCESS_TOKEN_TTL  = '15m';
const REFRESH_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// Account lockout: after this many consecutive wrong-password attempts,
// the account is blocked from logging in for the standard cool-down below,
// regardless of which IP the attempts come from. This is separate from
// loginLimiter (rate limiting), which throttles a network address instead
// of protecting one specific account.
const MAX_FAILED_LOGIN_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 15 * 60 * 1000; // 15 minutes — standard cool-down

function minutesRemaining(lockoutUntil) {
  return Math.max(1, Math.ceil((new Date(lockoutUntil).getTime() - Date.now()) / 60000));
}

function lockoutMessage(lockoutUntil) {
  const mins = minutesRemaining(lockoutUntil);
  return `Too many failed login attempts. This account is locked. Please try again in ${mins} minute${mins === 1 ? '' : 's'}.`;
}

// Fresh anon-key client for every verifyOtp() / signUp() call. Both can start a
// session on whichever client runs them, so reusing a shared client (like
// authClient) would let one user's session leak into the next request.
function createThrowawayAuthClient() {
  return createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_ANON_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

// 403 for a correct-password login on an unverified account. The machine-readable
// code lets the frontend send the user to the verify-email page.
function unverifiedLoginResponse(res, req, profile) {
  logAction({ userId: profile?.user_id ?? null, action: 'LOGIN_BLOCKED_UNVERIFIED', entityType: 'user', entityId: profile?.user_id ?? null, req });
  return res.status(403).json({ error: 'Please verify your email address before logging in.', code: 'EMAIL_NOT_VERIFIED' });
}

function hashToken(rawToken) {
  return crypto.createHash('sha256').update(rawToken).digest('hex');
}

function signAccessToken(profile) {
  return jwt.sign(
    {
      userId:     profile.user_id,
      email:      profile.email,
      role:       profile.role,
      schoolName: profile.school_name,
      firstName:  profile.first_name,
      lastName:   profile.last_name,
    },
    process.env.JWT_SECRET,
    { expiresIn: ACCESS_TOKEN_TTL }
  );
}

/**
 * Issues a new refresh token for a user, stores its hash, and returns the
 * raw token (only ever returned to the client once, at issuance/rotation
 * time — the DB only ever holds the hash).
 */
async function issueRefreshToken(userId, replacesTokenId = null) {
  const rawToken = crypto.randomBytes(48).toString('hex');
  const { data, error } = await supabase
    .from('refresh_tokens')
    .insert({
      user_id:    userId,
      token_hash: hashToken(rawToken),
      expires_at: new Date(Date.now() + REFRESH_TOKEN_TTL_MS).toISOString(),
    })
    .select('token_id')
    .single();

  if (error) throw new Error(`Failed to issue refresh token: ${error.message}`);

  if (replacesTokenId) {
    await supabase
      .from('refresh_tokens')
      .update({ revoked_at: new Date().toISOString(), replaced_by: data.token_id })
      .eq('token_id', replacesTokenId);
  }

  return rawToken;
}

// ── Two-step login helpers ────────────────────────────────────────────────────
// Step 1 (POST /login) checks the password and emails a one-time code.
// Step 2 (POST /login/verify) checks the code and only then issues tokens.

const LOGIN_CHALLENGE_EXPIRED = {
  error: 'Your login session has expired. Please log in again.',
  code: 'LOGIN_CHALLENGE_EXPIRED',
};

function isEmailRateLimit(err) {
  return err?.status === 429 || err?.code === 'over_email_send_rate_limit' || err?.code === 'over_request_rate_limit';
}

// Asks Supabase Auth to email a one-time login code to an EXISTING user.
// shouldCreateUser:false makes sure this can never create an account. The
// wording of the email ("you are trying to log in to BRIDGE") comes from the
// "Magic Link" email template in the Supabase dashboard — see CHANGELOG.md.
// Returns the Supabase error, or null on success.
async function sendLoginCode(email) {
  const { error } = await createThrowawayAuthClient().auth.signInWithOtp({
    email,
    options: { shouldCreateUser: false },
  });
  return error ?? null;
}

// Counts one wrong emailed code against the SAME per-account counter as wrong
// passwords, so the 6-digit code can't be guessed past the lockout threshold.
async function recordFailedLoginCode(profile, req) {
  const attempts = (profile.failed_login_attempts || 0) + 1;
  logAction({ userId: profile.user_id, action: 'LOGIN_CODE_FAILED', entityType: 'user', entityId: profile.user_id, req });

  if (attempts >= MAX_FAILED_LOGIN_ATTEMPTS) {
    const lockoutUntil = new Date(Date.now() + LOCKOUT_DURATION_MS).toISOString();
    await supabase
      .from('users')
      .update({ failed_login_attempts: 0, lockout_until: lockoutUntil })
      .eq('user_id', profile.user_id);
    logAction({ userId: profile.user_id, action: 'ACCOUNT_LOCKED', entityType: 'user', entityId: profile.user_id, metadata: { attempts, source: 'login_code' }, req });
    return { locked: true, lockoutUntil };
  }

  await supabase
    .from('users')
    .update({ failed_login_attempts: attempts })
    .eq('user_id', profile.user_id);
  return { locked: false, remaining: MAX_FAILED_LOGIN_ATTEMPTS - attempts };
}

// Final step of a successful login: clear lockout state, issue the tokens.
async function finishLogin(res, req, profile) {
  if (profile.failed_login_attempts > 0 || profile.lockout_until) {
    await supabase
      .from('users')
      .update({ failed_login_attempts: 0, lockout_until: null })
      .eq('user_id', profile.user_id);
  }

  const token = signAccessToken(profile);
  const refreshToken = await issueRefreshToken(profile.user_id);

  logAction({ userId: profile.user_id, action: 'LOGIN', entityType: 'user', entityId: profile.user_id, metadata: { twoFactor: true }, req });

  return res.json({
    token,
    refreshToken,
    expiresIn: ACCESS_TOKEN_TTL,
    user: {
      userId:     profile.user_id,
      firstName:  profile.first_name,
      lastName:   profile.last_name,
      email:      profile.email,
      role:       profile.role,
      schoolName: profile.school_name,
    },
  });
}

// ── POST /api/auth/signup ─────────────────────────────────────────────────────
// Creates the Supabase Auth user (unconfirmed) AND the public users row, then
// has Supabase email a 6-digit confirmation code. No tokens are issued here:
// the account cannot log in until POST /api/auth/verify-email succeeds.
// role / schoolName come ONLY from the validated request body. They are never
// sent to Supabase as user_metadata (anyone with the public anon key can call
// Supabase signUp directly with arbitrary metadata, so it can't be trusted).
router.post('/signup', signupLimiter, validateBody(signupSchema), async (req, res) => {
  const { firstName, middleName, lastName, email, password, role, schoolName } = req.body;
  const signupClient = createThrowawayAuthClient();

  try {
    // 1. Is this email already registered? (service-role client, users.email is UNIQUE)
    const { data: existing, error: lookupError } = await supabase
      .from('users')
      .select('user_id, email_verified')
      .eq('email', email)
      .maybeSingle();
    if (lookupError) {
      console.error('[SIGNUP] Account lookup failed:', lookupError.message);
      return res.status(500).json({ error: 'Could not process your request. Please try again.' });
    }

    // Registered AND verified: same behavior as before.
    if (existing?.email_verified) {
      return res.status(409).json({ error: 'Email is already in use.' });
    }

    let userId;

    if (existing) {
      // 2a. Registered but never verified (abandoned or retried signup): take
      // the new details and password, then resend the code instead of failing.
      // created_at is bumped so the 24-hour cleanup window restarts.
      userId = existing.user_id;

      const { error: updateError } = await supabase
        .from('users')
        .update({
          first_name:  firstName,
          middle_name: middleName || null,
          last_name:   lastName,
          role,
          school_name: schoolName,
          created_at:  new Date().toISOString(),
        })
        .eq('user_id', userId);
      if (updateError) {
        console.error('[SIGNUP] Profile update failed:', updateError.message);
        return res.status(500).json({ error: updateError.message });
      }

      const { error: pwError } = await supabase.auth.admin.updateUserById(userId, { password });
      if (pwError) {
        console.error('[SIGNUP] Password update failed:', pwError.message);
        return res.status(500).json({ error: 'Could not process your request. Please try again.' });
      }

      const { error: resendError } = await signupClient.auth.resend({ type: 'signup', email });
      if (resendError) {
        console.error('[SIGNUP] Resend failed:', resendError.message);
        if (resendError.status === 429 || resendError.code === 'over_email_send_rate_limit') {
          return res.status(429).json({ error: 'A code was requested too recently. Please wait a minute and try again.' });
        }
        return res.status(500).json({ error: 'Could not send the verification code. Please try again.' });
      }
    } else {
      // 2b. New email: create the (unconfirmed) auth user. Supabase emails the
      // confirmation code because "Confirm email" is enabled. No options.data
      // on purpose — nothing privileged travels through user_metadata.
      const { data: signUpData, error: signUpError } = await signupClient.auth.signUp({ email, password });
      if (signUpError) {
        console.error('[SIGNUP] Supabase Auth error:', signUpError.message);
        if (signUpError.code === 'user_already_exists' || signUpError.message.includes('already registered')) {
          return res.status(409).json({ error: 'Email is already in use.' });
        }
        if (signUpError.status === 429 || signUpError.code === 'over_email_send_rate_limit') {
          return res.status(429).json({ error: 'A code was requested too recently. Please wait a minute and try again.' });
        }
        return res.status(500).json({ error: 'Could not create your account. Please try again.' });
      }

      // A session means "Confirm email" is OFF in the Supabase dashboard, so
      // this user is already confirmed. Never hand that out: undo and fail loudly.
      if (signUpData.session) {
        console.error('[SIGNUP] Supabase returned a session. "Confirm email" must be enabled in the dashboard.');
        if (signUpData.user?.id) await supabase.auth.admin.deleteUser(signUpData.user.id);
        return res.status(500).json({ error: 'Email verification is not configured. Please contact your administrator.' });
      }

      // For an email that is already registered AND confirmed in Supabase Auth,
      // Supabase returns an obfuscated user (fake id) with an empty identities
      // array instead of an error. It has no profile row (checked above), so
      // treat it as taken and never use that id.
      if (!signUpData.user || signUpData.user.identities?.length === 0) {
        return res.status(409).json({ error: 'Email is already in use.' });
      }

      userId = signUpData.user.id;

      // Upsert (not insert) because the on_auth_user_created DB trigger may
      // have already created a placeholder row for this user_id the instant
      // signUp() ran above — this overwrites it with the real form data.
      const { error: insertError } = await supabase.from('users').upsert({
        user_id:        userId,
        first_name:     firstName,
        middle_name:    middleName || null,
        last_name:      lastName,
        email,
        role,
        school_name:    schoolName,
        email_verified: false,
      });
      if (insertError) {
        // Roll back the auth user if profile insert fails
        await supabase.auth.admin.deleteUser(userId);
        return res.status(500).json({ error: insertError.message });
      }
    }

    logAction({ userId, action: 'SIGNUP', entityType: 'user', entityId: userId, metadata: { role, schoolName, resubmitted: Boolean(existing) }, req });
    logAction({ userId, action: 'EMAIL_VERIFICATION_REQUESTED', entityType: 'user', entityId: userId, metadata: { source: 'signup' }, req });

    return res.status(201).json({ requiresVerification: true, email });
  } catch (err) {
    console.error('[SIGNUP] Unexpected error:', err.message);
    return res.status(500).json({ error: 'Unexpected server error during signup.' });
  }
});

// ── POST /api/auth/verify-email ──────────────────────────────────────────────
// Verifies the emailed signup code and flags the profile as verified. Does NOT
// log the user in: they go to /login afterwards. Every failure returns the
// same message so the endpoint can't be used to probe accounts.
router.post('/verify-email', verifyEmailLimiter, validateBody(verifyEmailSchema), async (req, res) => {
  const { email, code } = req.body;
  const otpClient = createThrowawayAuthClient();

  try {
    // 1. Verify the code on the throwaway anon client (never the service-role one).
    const { data: otpData, error: otpError } = await otpClient.auth.verifyOtp({
      email,
      token: code,
      type: 'signup',
    });
    const userId = otpData?.user?.id;
    if (otpError || !userId) {
      return res.status(400).json({ error: 'Invalid or expired code.' });
    }

    // 2. Drop the session verifyOtp just started; the user must log in normally.
    // Local scope only ends this session, nothing else on the account.
    await otpClient.auth.signOut({ scope: 'local' }).catch(() => {});

    // 3. Flag the profile as verified.
    const { data: updated, error: updateError } = await supabase
      .from('users')
      .update({ email_verified: true })
      .eq('user_id', userId)
      .select('user_id');
    if (updateError || !updated?.length) {
      console.error('[VERIFY_EMAIL] Profile update failed:', updateError?.message ?? 'no profile row');
      return res.status(500).json({ error: 'Your email was confirmed, but we could not finish activating your account. Please contact your administrator.' });
    }

    logAction({ userId, action: 'EMAIL_VERIFIED', entityType: 'user', entityId: userId, req });

    return res.json({ message: 'Email verified. You can now log in.' });
  } catch (err) {
    console.error('[VERIFY_EMAIL] Unexpected error:', err.message);
    return res.status(500).json({ error: 'Unexpected server error during email verification.' });
  }
});

// ── POST /api/auth/resend-verification ───────────────────────────────────────
// Sends a fresh signup code, but only for an existing UNVERIFIED account.
// Always answers with the same generic 200 (whether or not the email exists,
// is already verified, or the send failed) so it reveals nothing about accounts.
router.post('/resend-verification', resendVerificationIpLimiter, resendVerificationLimiter, validateBody(resendVerificationSchema), async (req, res) => {
  const { email } = req.body;
  const generic = { message: 'If that email is waiting to be verified, a new code has been sent.' };

  try {
    const { data: profile, error: lookupError } = await supabase
      .from('users')
      .select('user_id')
      .eq('email', email)
      .eq('email_verified', false)
      .maybeSingle();
    if (lookupError) {
      console.error('[RESEND_VERIFICATION] Account lookup failed:', lookupError.message);
      return res.json(generic);
    }

    if (profile) {
      const { error: sendError } = await createThrowawayAuthClient().auth.resend({ type: 'signup', email });
      if (sendError) {
        console.error('[RESEND_VERIFICATION] Supabase Auth error:', sendError.message);
      } else {
        logAction({ userId: profile.user_id, action: 'EMAIL_VERIFICATION_REQUESTED', entityType: 'user', entityId: profile.user_id, metadata: { source: 'resend' }, req });
      }
    }
  } catch (err) {
    console.error('[RESEND_VERIFICATION] Unexpected error:', err.message);
  }

  return res.json(generic);
});

// ── POST /api/auth/login ──────────────────────────────────────────────────────
// Step 1 of 2. Checks email + password, then emails a one-time code and returns
// { requiresTwoFactor, challengeToken }. Tokens are only issued by
// POST /api/auth/login/verify once the emailed code has been entered.
router.post('/login', loginLimiter, validateBody(loginSchema), async (req, res) => {
  try {
    const { email, password } = req.body;

    // 1. Fetch the account's profile + lockout state up front (by email —
    // we don't have a user_id until Supabase Auth confirms the password).
    // A miss here (unknown email) is treated identically to a wrong password
    // on the first attempt: both return the same generic message, so a single
    // probe can't reveal whether an address is registered. Subsequent failed
    // attempts on a known account do surface the remaining-attempt count
    // (see below), but that requires the attacker to already be targeting a
    // specific address they know is real — a tradeoff that's explicit and
    // documented rather than accidental.
    const { data: profile, error: profileError } = await supabase
      .from('users')
      .select('user_id, first_name, last_name, role, school_name, email, email_verified, failed_login_attempts, lockout_until')
      .eq('email', email)
      .maybeSingle();

    if (profileError) {
      console.error('[LOGIN] Profile lookup error:', profileError);
      return res.status(500).json({ error: 'Failed to process login.' });
    }

    // 2. Reject immediately if this account is currently locked out —
    // don't even spend a Supabase Auth call on it.
    if (profile?.lockout_until && new Date(profile.lockout_until) > new Date()) {
      logAction({ userId: profile.user_id, action: 'LOGIN_BLOCKED_LOCKOUT', entityType: 'user', entityId: profile.user_id, req });
      return res.status(423).json({ error: lockoutMessage(profile.lockout_until) });
    }

    // 3. Verify with Supabase Auth — uses authClient (anon key), NOT the
    // service-role client, so this client's session swap never affects
    // the service-role client used for the profile fetch above.
    const { data: authData, error: authError } = await authClient.auth.signInWithPassword({
      email,
      password,
    });
    if (authError) {
      // Supabase only reports "email not confirmed" once the password was
      // correct. This is not a wrong-password attempt, so it must not count
      // toward failed_login_attempts or trigger a lockout.
      if (authError.code === 'email_not_confirmed' || /email not confirmed/i.test(authError.message)) {
        return unverifiedLoginResponse(res, req, profile);
      }

      console.error('[LOGIN] Supabase Auth error:', authError.message);
      logAction({ action: 'LOGIN_FAILED', entityType: 'user', metadata: { email }, req });

      // Track consecutive failures per account and lock it out once the
      // threshold is hit. Only possible when the email matches a real
      // account — an unknown email has no row to update.
      if (profile) {
        const attempts = (profile.failed_login_attempts || 0) + 1;
        if (attempts >= MAX_FAILED_LOGIN_ATTEMPTS) {
          const lockoutUntil = new Date(Date.now() + LOCKOUT_DURATION_MS).toISOString();
          await supabase
            .from('users')
            .update({ failed_login_attempts: 0, lockout_until: lockoutUntil })
            .eq('user_id', profile.user_id);

          logAction({ userId: profile.user_id, action: 'ACCOUNT_LOCKED', entityType: 'user', entityId: profile.user_id, metadata: { attempts }, req });
          return res.status(423).json({ error: lockoutMessage(lockoutUntil) });
        }

        await supabase
          .from('users')
          .update({ failed_login_attempts: attempts })
          .eq('user_id', profile.user_id);

        // Only surface the per-account attempt count once there is already a
        // recorded prior failure (attempts > 1). On the very first wrong
        // password against a real account, returning the same generic message
        // as an unknown email prevents an attacker from distinguishing the two
        // by probing once per address — they'd need multiple attempts on the
        // same address before any difference is visible.
        if (attempts > 1) {
          const remaining = MAX_FAILED_LOGIN_ATTEMPTS - attempts;
          return res.status(401).json({
            error: `Invalid email or password. ${remaining} attempt${remaining === 1 ? '' : 's'} remaining before this account is temporarily locked.`,
          });
        }
      }

      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    // Password was correct but the app still has this account as unverified.
    // If Supabase Auth itself has the address confirmed (email_confirmed_at is
    // only ever set by Supabase after a code/link is redeemed, never from
    // user input), the owner did prove the address, e.g. verify-email's profile
    // update failed or they confirmed another way. Sync the flag and carry on.
    // Otherwise reject: same 403, no tokens.
    if (profile && !profile.email_verified) {
      if (!authData?.user?.email_confirmed_at) {
        return unverifiedLoginResponse(res, req, profile);
      }
      const { error: syncError } = await supabase
        .from('users')
        .update({ email_verified: true })
        .eq('user_id', profile.user_id);
      if (syncError) {
        console.error('[LOGIN] Could not sync email_verified:', syncError.message);
        return res.status(500).json({ error: 'Failed to process login.' });
      }
      profile.email_verified = true;
      logAction({ userId: profile.user_id, action: 'EMAIL_VERIFIED', entityType: 'user', entityId: profile.user_id, metadata: { source: 'login_sync' }, req });
    }

    if (!profile) {
      // Extremely unlikely (Supabase Auth succeeded but no matching public
      // profile row), but guard against it rather than crash below.
      console.error('[LOGIN] Auth succeeded but no profile row found for', email);
      return res.status(500).json({ error: 'Failed to load user profile.' });
    }

    // 4. Password is correct and the email is verified, but the user is NOT
    // logged in yet: email a one-time code and hand back a short-lived signed
    // challenge proving the password step passed. No access/refresh tokens are
    // issued until POST /api/auth/login/verify succeeds. Failed-attempt state is
    // deliberately left alone here; it is cleared once the code is verified.
    const sendError = await sendLoginCode(profile.email);
    if (sendError) {
      console.error('[LOGIN] Could not send login code:', sendError.message);
      if (isEmailRateLimit(sendError)) {
        return res.status(429).json({ error: 'A login code was requested too recently. Please check your inbox or wait a minute and try again.' });
      }
      return res.status(500).json({ error: 'Could not send the login code. Please try again.' });
    }

    logAction({ userId: profile.user_id, action: 'LOGIN_CODE_SENT', entityType: 'user', entityId: profile.user_id, metadata: { source: 'login' }, req });

    return res.json({
      requiresTwoFactor: true,
      email: profile.email,
      challengeToken: signLoginChallenge(profile.user_id),
    });
  } catch (err) {
    console.error('[LOGIN] Unexpected error:', err);
    return res.status(500).json({ error: err.message ?? 'Unexpected server error during login.' });
  }
});

// ── POST /api/auth/login/verify ──────────────────────────────────────────────
// Step 2 of 2. Needs the challengeToken from /login (proves the password was
// just checked) AND the 6-digit code emailed to the account. Only then does it
// return the short-lived access token plus a refresh token.
router.post('/login/verify', verifyLoginLimiter, validateBody(verifyLoginSchema), async (req, res) => {
  const { challengeToken, code } = req.body;

  try {
    const challenge = verifyLoginChallenge(challengeToken);
    if (!challenge) return res.status(401).json(LOGIN_CHALLENGE_EXPIRED);

    const { data: profile, error: profileError } = await supabase
      .from('users')
      .select('user_id, first_name, last_name, role, school_name, email, email_verified, failed_login_attempts, lockout_until')
      .eq('user_id', challenge.userId)
      .maybeSingle();
    if (profileError) {
      console.error('[LOGIN_VERIFY] Profile lookup error:', profileError.message);
      return res.status(500).json({ error: 'Failed to process login.' });
    }
    if (!profile) return res.status(401).json(LOGIN_CHALLENGE_EXPIRED);

    if (profile.lockout_until && new Date(profile.lockout_until) > new Date()) {
      logAction({ userId: profile.user_id, action: 'LOGIN_BLOCKED_LOCKOUT', entityType: 'user', entityId: profile.user_id, req });
      return res.status(423).json({ error: lockoutMessage(profile.lockout_until) });
    }
    if (!profile.email_verified) return unverifiedLoginResponse(res, req, profile);

    // Verify the code on a throwaway anon client (never the service-role one).
    const otpClient = createThrowawayAuthClient();
    const { data: otpData, error: otpError } = await otpClient.auth.verifyOtp({
      email: profile.email,
      token: code,
      type: 'email',
    });

    // The code must also belong to THIS account, not just be some valid code.
    if (otpError || !otpData?.user?.id || otpData.user.id !== profile.user_id) {
      const outcome = await recordFailedLoginCode(profile, req);
      if (outcome.locked) return res.status(423).json({ error: lockoutMessage(outcome.lockoutUntil) });
      return res.status(400).json({
        error: `Invalid or expired code. ${outcome.remaining} attempt${outcome.remaining === 1 ? '' : 's'} remaining before this account is temporarily locked.`,
      });
    }

    // Drop the Supabase session verifyOtp just started; BRIDGE issues its own tokens.
    await otpClient.auth.signOut({ scope: 'local' }).catch(() => {});

    return await finishLogin(res, req, profile);
  } catch (err) {
    console.error('[LOGIN_VERIFY] Unexpected error:', err);
    return res.status(500).json({ error: 'Unexpected server error during login.' });
  }
});

// ── POST /api/auth/login/resend-code ─────────────────────────────────────────
// Sends a fresh login code. Needs the challengeToken from /login, so it can
// only be used by someone who just passed the password step.
router.post('/login/resend-code', resendLoginCodeIpLimiter, resendLoginCodeLimiter, validateBody(resendLoginCodeSchema), async (req, res) => {
  const { challengeToken } = req.body;

  try {
    const challenge = verifyLoginChallenge(challengeToken);
    if (!challenge) return res.status(401).json(LOGIN_CHALLENGE_EXPIRED);

    const { data: profile, error: profileError } = await supabase
      .from('users')
      .select('user_id, email, email_verified, lockout_until')
      .eq('user_id', challenge.userId)
      .maybeSingle();
    if (profileError) {
      console.error('[LOGIN_RESEND] Profile lookup error:', profileError.message);
      return res.status(500).json({ error: 'Could not send the login code. Please try again.' });
    }
    if (!profile || !profile.email_verified) return res.status(401).json(LOGIN_CHALLENGE_EXPIRED);

    if (profile.lockout_until && new Date(profile.lockout_until) > new Date()) {
      return res.status(423).json({ error: lockoutMessage(profile.lockout_until) });
    }

    const sendError = await sendLoginCode(profile.email);
    if (sendError) {
      console.error('[LOGIN_RESEND] Could not send login code:', sendError.message);
      if (isEmailRateLimit(sendError)) {
        return res.status(429).json({ error: 'A login code was requested too recently. Please wait a minute and try again.' });
      }
      return res.status(500).json({ error: 'Could not send the login code. Please try again.' });
    }

    logAction({ userId: profile.user_id, action: 'LOGIN_CODE_SENT', entityType: 'user', entityId: profile.user_id, metadata: { source: 'resend' }, req });

    return res.json({ message: 'A new login code has been sent to your email.' });
  } catch (err) {
    console.error('[LOGIN_RESEND] Unexpected error:', err.message);
    return res.status(500).json({ error: 'Unexpected server error. Please try again.' });
  }
});

// ── POST /api/auth/refresh ────────────────────────────────────────────────────
// Exchanges a valid, unexpired, unrevoked refresh token for a new access
// token + a NEW refresh token (rotation: the old one is immediately revoked,
// so a leaked-and-then-reused refresh token is detectable/one-shot).
router.post('/refresh', refreshLimiter, validateBody(refreshSchema), async (req, res) => {
  const { refreshToken } = req.body;
  const tokenHash = hashToken(refreshToken);

  const { data: stored, error } = await supabase
    .from('refresh_tokens')
    .select('token_id, user_id, expires_at, revoked_at')
    .eq('token_hash', tokenHash)
    .maybeSingle();

  if (error || !stored || stored.revoked_at || new Date(stored.expires_at) < new Date()) {
    return res.status(401).json({ error: 'Invalid or expired refresh token. Please log in again.' });
  }

  const { data: profile, error: profileError } = await supabase
    .from('users')
    .select('user_id, first_name, last_name, role, school_name, email')
    .eq('user_id', stored.user_id)
    .single();

  if (profileError || !profile) return res.status(401).json({ error: 'User not found.' });

  const newAccessToken = signAccessToken(profile);
  const newRefreshToken = await issueRefreshToken(profile.user_id, stored.token_id);

  return res.json({
    token: newAccessToken,
    refreshToken: newRefreshToken,
    expiresIn: ACCESS_TOKEN_TTL,
  });
});

// ── POST /api/auth/logout ─────────────────────────────────────────────────────
// Revokes the given refresh token server-side. This is what makes logging
// out on a shared computer actually mean something — the stateless access
// token still naturally expires within 15 minutes either way.
router.post('/logout', async (req, res) => {
  const { refreshToken } = req.body || {};
  if (refreshToken) {
    await supabase
      .from('refresh_tokens')
      .update({ revoked_at: new Date().toISOString() })
      .eq('token_hash', hashToken(refreshToken));
  }
  return res.json({ message: 'Logged out.' });
});

// ── POST /api/auth/forgot-password ───────────────────────────────────────────
// Checks the email is registered, then asks Supabase Auth to email a recovery
// code (Supabase sends the email, using the custom SMTP + "Reset Password"
// template). An unregistered email gets a 404 so the UI can stop before the
// code step. This does reveal which emails are registered, so the endpoint is
// throttled both per IP + email and per IP alone (see rateLimiters.js).
router.post('/forgot-password', forgotPasswordIpLimiter, forgotPasswordLimiter, validateBody(forgotPasswordSchema), async (req, res) => {
  const { email } = req.body;

  try {
    // 1. Is this email registered? (service-role client, users.email is UNIQUE)
    const { data: profile, error: lookupError } = await supabase
      .from('users')
      .select('user_id')
      .eq('email', email)
      .maybeSingle();

    if (lookupError) {
      console.error('[FORGOT_PASSWORD] Account lookup failed:', lookupError.message);
      return res.status(500).json({ error: 'Could not process your request. Please try again.' });
    }

    if (!profile) {
      logAction({ action: 'PASSWORD_RESET_REQUESTED', entityType: 'user', metadata: { email, registered: false }, req });
      return res.status(404).json({ error: 'No account is registered with that email address.' });
    }

    // 2. Ask Supabase Auth to send the code.
    const { error: sendError } = await authClient.auth.resetPasswordForEmail(email);
    if (sendError) {
      console.error('[FORGOT_PASSWORD] Supabase Auth error:', sendError.message);
      if (sendError.status === 429 || sendError.code === 'over_email_send_rate_limit') {
        return res.status(429).json({ error: 'A code was requested too recently. Please wait a minute and try again.' });
      }
      return res.status(500).json({ error: 'Could not send the reset code. Please try again.' });
    }

    logAction({ userId: profile.user_id, action: 'PASSWORD_RESET_REQUESTED', entityType: 'user', entityId: profile.user_id, metadata: { email, registered: true }, req });

    return res.json({ message: 'A code has been sent to your email.' });
  } catch (err) {
    console.error('[FORGOT_PASSWORD] Unexpected error:', err.message);
    return res.status(500).json({ error: 'Unexpected server error. Please try again.' });
  }
});

// ── POST /api/auth/reset-password ────────────────────────────────────────────
// Verifies the emailed code, sets the new password, then kills every existing
// session for that account and clears any lockout.
router.post('/reset-password', resetPasswordLimiter, validateBody(resetPasswordSchema), async (req, res) => {
  const { email, code, newPassword } = req.body;
  const otpClient = createThrowawayAuthClient();

  try {
    // 1. Verify the code on the throwaway anon client (never the service-role one).
    const { data: otpData, error: otpError } = await otpClient.auth.verifyOtp({
      email,
      token: code,
      type: 'recovery',
    });
    const userId = otpData?.user?.id;
    if (otpError || !userId) {
      return res.status(400).json({ error: 'Invalid or expired code.' });
    }

    // 2. Set the new password with the service-role client.
    const { error: updateError } = await supabase.auth.admin.updateUserById(userId, { password: newPassword });
    if (updateError) {
      console.error('[RESET_PASSWORD] Password update failed:', updateError.message);
      if (updateError.code === 'same_password') {
        return res.status(400).json({ error: 'New password must be different from your current password.' });
      }
      return res.status(500).json({ error: 'Could not reset password. Please request a new code and try again.' });
    }

    // 3. Revoke every live refresh token so sessions on other devices end
    // (their access tokens still expire on their own within 15 minutes).
    const { error: revokeError } = await supabase
      .from('refresh_tokens')
      .update({ revoked_at: new Date().toISOString() })
      .eq('user_id', userId)
      .is('revoked_at', null);
    if (revokeError) {
      console.error('[RESET_PASSWORD] Refresh token revoke failed:', revokeError.message);
      return res.status(500).json({ error: 'Your password was changed, but we could not sign out your other sessions. Please contact your administrator.' });
    }

    // 4. A successful reset also clears any failed-attempt count / lockout.
    const { error: unlockError } = await supabase
      .from('users')
      .update({ failed_login_attempts: 0, lockout_until: null })
      .eq('user_id', userId);
    if (unlockError) console.error('[RESET_PASSWORD] Lockout reset failed:', unlockError.message);

    // 5. Drop the recovery session the throwaway client just created.
    await otpClient.auth.signOut().catch(() => {});

    logAction({ userId, action: 'PASSWORD_RESET_COMPLETED', entityType: 'user', entityId: userId, req });

    return res.json({ message: 'Password updated. You can now log in.' });
  } catch (err) {
    console.error('[RESET_PASSWORD] Unexpected error:', err.message);
    return res.status(500).json({ error: 'Unexpected server error during password reset.' });
  }
});

// ── GET /api/auth/me ──────────────────────────────────────────────────────────
// Returns the currently authenticated user's profile.
router.get('/me', requireAuth, async (req, res) => {
  const { data, error } = await supabase
    .from('users')
    .select('user_id, first_name, middle_name, last_name, email, role, school_name, created_at')
    .eq('user_id', req.user.userId)
    .single();

  if (error || !data) return res.status(404).json({ error: 'User not found.' });
  return res.json(data);
});

export default router;
