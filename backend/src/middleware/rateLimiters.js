import crypto from 'crypto';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';

// General ceiling for every /api request, per IP. This is deliberately loose
// — it exists as a backstop against runaway scripts/bots, not to shape
// normal usage — the tighter, purpose-specific limiters below do the real
// brute-force/abuse protection.
export const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 500,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please slow down and try again shortly.' },
});

// Login: the classic brute-force target. Keyed by IP + email together so
// one attacker can't lock out a legitimate teacher's account by hammering
// their email from elsewhere, while still throttling a single attacker
// spraying many emails from one IP.
export const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  // ipKeyGenerator() normalizes IPv6 addresses to a /56 subnet before use —
  // without it, an IPv6 user could cycle through addresses within their own
  // subnet to dodge this limit entirely, since each distinct address would
  // otherwise count as a "new" visitor.
  keyGenerator: (req) => `${ipKeyGenerator(req.ip)}:${(req.body?.email || '').toLowerCase()}`,
  message: { error: 'Too many login attempts. Please wait 15 minutes before trying again.' },
});

// Login code (2nd step of login): the brute-force target for the emailed
// 6-digit code. Per IP; the per-account lockout in auth.js (shared with wrong
// passwords) is what really bounds guessing across many IPs.
export const verifyLoginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => ipKeyGenerator(req.ip),
  message: { error: 'Too many code attempts. Please wait 15 minutes before trying again.' },
});

// Resend login code: each request makes Supabase send an email, so this guards
// against email-bombing one inbox and against burning the SMTP quota. Keyed by
// IP + the login challenge (one per successful password entry).
export const resendLoginCodeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) =>
    `${ipKeyGenerator(req.ip)}:${crypto.createHash('sha256').update(String(req.body?.challengeToken || '')).digest('hex').slice(0, 32)}`,
  message: { error: 'Too many login code requests. Please wait 15 minutes before trying again.' },
});

// Resend login code, per IP only, so one IP can't churn through many
// challenges to spray codes at many inboxes.
export const resendLoginCodeIpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => ipKeyGenerator(req.ip),
  message: { error: 'Too many login code requests from this network. Please wait 15 minutes before trying again.' },
});

// Forgot password: each request makes Supabase send an email, so this guards
// against email-bombing one inbox and against burning the SMTP quota. Keyed by
// IP + email, same normalization as loginLimiter.
export const forgotPasswordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `${ipKeyGenerator(req.ip)}:${(req.body?.email || '').trim().toLowerCase()}`,
  message: { error: 'Too many password reset requests. Please wait 15 minutes before trying again.' },
});

// Forgot password, per IP only. The endpoint tells the caller whether an email
// is registered, so the IP + email limiter above can't stop one IP from probing
// many different addresses. This caps that.
export const forgotPasswordIpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => ipKeyGenerator(req.ip),
  message: { error: 'Too many password reset requests from this network. Please wait 15 minutes before trying again.' },
});

// Reset password: the brute-force target for the 6-10 digit code, so it is
// capped per IP + email. Attempts from other IPs are still bounded by
// Supabase Auth's own OTP limits.
export const resetPasswordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `${ipKeyGenerator(req.ip)}:${(req.body?.email || '').trim().toLowerCase()}`,
  message: { error: 'Too many password reset attempts. Please wait 15 minutes before trying again.' },
});

// Verify email: the brute-force target for the 6-digit signup code, so it is
// capped per IP + email. Attempts from other IPs are still bounded by
// Supabase Auth's own OTP limits.
export const verifyEmailLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `${ipKeyGenerator(req.ip)}:${String(req.body?.email || '').trim().toLowerCase()}`,
  message: { error: 'Too many verification attempts. Please wait 15 minutes before trying again.' },
});

// Resend verification: each request makes Supabase send an email, so this
// guards against email-bombing one inbox and against burning the SMTP quota.
// Keyed by IP + email, same normalization as forgotPasswordLimiter.
export const resendVerificationLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `${ipKeyGenerator(req.ip)}:${String(req.body?.email || '').trim().toLowerCase()}`,
  message: { error: 'Too many verification code requests. Please wait 15 minutes before trying again.' },
});

// Resend verification, per IP only, so one IP can't spray codes at many
// different addresses (the IP + email limiter above can't stop that).
export const resendVerificationIpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => ipKeyGenerator(req.ip),
  message: { error: 'Too many verification code requests from this network. Please wait 15 minutes before trying again.' },
});

// Signup: cheap to abuse for account-creation spam if left unlimited.
export const signupLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 8,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many signup attempts from this network. Please try again later.' },
});

// Refresh: rotation means every legitimate session refreshes periodically,
// so this is looser than login but still bounded.
export const refreshLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many token refresh attempts. Please log in again.' },
});

// CSV upload: a large file processed row-by-row against the DB is the
// single most expensive request in the API — worth its own, stricter limit,
// keyed by authenticated user (this middleware runs after requireAuth) so
// one teacher's heavy upload day doesn't throttle a colleague on the same
// school network/IP.
export const uploadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  // Same ipKeyGenerator() normalization as loginLimiter above — the userId
  // branch is unaffected (it's not an IP at all), this only matters for the
  // req.ip fallback used when req.user isn't populated yet.
  keyGenerator: (req) => req.user?.userId || ipKeyGenerator(req.ip),
  message: { error: 'Too many CSV uploads in a short period. Please wait a few minutes and try again.' },
});
