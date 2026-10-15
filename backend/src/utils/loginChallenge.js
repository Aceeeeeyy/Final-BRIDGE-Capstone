import crypto from 'crypto';
import jwt from 'jsonwebtoken';

// Short-lived proof that a user has ALREADY passed the password step of login.
//
// Why this exists: the emailed login code is issued by Supabase Auth, and the
// Supabase anon key is public, so anyone can ask Supabase to email a login
// code for any address on their own. If POST /api/auth/login/verify accepted
// a code on its own, the code would be a way to log in WITHOUT the password.
// Requiring this token makes the password and the emailed code both mandatory.
//
// The token is signed with a key DERIVED from JWT_SECRET (not JWT_SECRET
// itself), so it can never be accepted as an access token by requireAuth, and
// an access token can never be accepted as a challenge.
export const LOGIN_CHALLENGE_TTL = '10m';
const PURPOSE = 'login-2fa';

function challengeKey() {
  return crypto
    .createHmac('sha256', process.env.JWT_SECRET)
    .update('bridge:login-challenge:v1')
    .digest();
}

export function signLoginChallenge(userId) {
  return jwt.sign({ purpose: PURPOSE, userId }, challengeKey(), {
    algorithm: 'HS256',
    expiresIn: LOGIN_CHALLENGE_TTL,
  });
}

/** Returns { userId } for a valid, unexpired challenge, otherwise null. */
export function verifyLoginChallenge(token) {
  try {
    const decoded = jwt.verify(token, challengeKey(), { algorithms: ['HS256'] });
    if (decoded.purpose !== PURPOSE || !decoded.userId) return null;
    return { userId: decoded.userId };
  } catch {
    return null;
  }
}
