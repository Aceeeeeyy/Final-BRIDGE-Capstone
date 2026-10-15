// Exercises the real auth routes (two-step login) with Supabase mocked out.
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import express from 'express';

process.env.JWT_SECRET = 'test-secret-test-secret-test-secret-test-secret-test-secret-1234';
process.env.SUPABASE_URL = 'http://localhost';
process.env.SUPABASE_ANON_KEY = 'anon';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service';

// ── Fakes ────────────────────────────────────────────────────────────────────
const state = vi.hoisted(() => ({
  profile: null,          // row returned by users lookups
  userUpdates: [],        // every users.update(...) payload
  passwordOk: true,
  otpSendError: null,
  otpSent: [],            // emails a code was requested for
  validCode: '123456',
  otpUserId: 'u1',
}));

vi.mock('../../utils/auditLog.js', () => ({ logAction: () => {} }));

vi.mock('../../supabaseClient.js', () => {
  const chain = (table, mode) => {
    const c = {
      _payload: null,
      select() { return c; },
      eq() { return c; },
      insert() { mode = 'insert'; return c; },
      update(payload) { mode = 'update'; c._payload = payload; if (table === 'users') state.userUpdates.push(payload); return c; },
      maybeSingle: async () => ({ data: table === 'users' ? state.profile : null, error: null }),
      single: async () => ({ data: table === 'refresh_tokens' ? { token_id: 'rt1' } : state.profile, error: null }),
      then: (resolve) => resolve({ data: [{}], error: null }),
    };
    return c;
  };
  return {
    supabase: { from: (t) => chain(t) , auth: { admin: {} } },
    authClient: {
      auth: {
        signInWithPassword: async () =>
          state.passwordOk
            ? { data: { user: { email_confirmed_at: 'x' } }, error: null }
            : { data: null, error: { message: 'Invalid login credentials', code: 'invalid_credentials' } },
      },
    },
  };
});

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    auth: {
      signInWithOtp: async ({ email, options }) => {
        expect(options.shouldCreateUser).toBe(false);
        if (state.otpSendError) return { data: null, error: state.otpSendError };
        state.otpSent.push(email);
        return { data: {}, error: null };
      },
      verifyOtp: async ({ token, type }) =>
        token === state.validCode && type === 'email'
          ? { data: { user: { id: state.otpUserId } }, error: null }
          : { data: null, error: { message: 'Token has expired or is invalid' } },
      signOut: async () => ({}),
    },
  }),
}));

// ── Harness ──────────────────────────────────────────────────────────────────
let server, base;

async function post(path, body) {
  const res = await fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return { status: res.status, body: await res.json() };
}

beforeAll(async () => {
  const { default: authRoutes } = await import('../auth.js');
  const app = express();
  app.use(express.json());
  app.use('/api/auth', authRoutes);
  await new Promise((r) => { server = app.listen(0, r); });
  base = `http://127.0.0.1:${server.address().port}/api/auth`;
});
afterAll(() => server?.close());

beforeEach(() => {
  state.profile = {
    user_id: 'u1', first_name: 'Ana', last_name: 'Cruz', role: 'Teacher', school_name: 'Talon Elementary School',
    email: 'ana@example.com', email_verified: true, failed_login_attempts: 0, lockout_until: null,
  };
  state.userUpdates = [];
  state.passwordOk = true;
  state.otpSendError = null;
  state.otpSent = [];
  state.otpUserId = 'u1';
});

// Each test uses its own email so the per-IP+email rate limiters don't interfere.
let n = 0;
const uniqueEmail = () => `user${++n}@example.com`;

describe('POST /login (step 1)', () => {
  it('emails a code and returns a challenge — but NO tokens', async () => {
    const email = uniqueEmail();
    state.profile.email = email;
    const r = await post('/login', { email, password: 'whatever1' });
    expect(r.status).toBe(200);
    expect(r.body.requiresTwoFactor).toBe(true);
    expect(r.body.challengeToken).toBeTruthy();
    expect(r.body.token).toBeUndefined();
    expect(r.body.refreshToken).toBeUndefined();
    expect(state.otpSent).toEqual([email]);
  });

  it('wrong password sends no code', async () => {
    state.passwordOk = false;
    const r = await post('/login', { email: uniqueEmail(), password: 'nope' });
    expect(r.status).toBe(401);
    expect(state.otpSent).toEqual([]);
  });

  it('reports a clean 429 when the email send is rate limited', async () => {
    state.otpSendError = { status: 429, code: 'over_email_send_rate_limit', message: 'rate' };
    const r = await post('/login', { email: uniqueEmail(), password: 'whatever1' });
    expect(r.status).toBe(429);
    expect(r.body.token).toBeUndefined();
  });
});

describe('POST /login/verify (step 2)', () => {
  async function challenge() {
    const email = uniqueEmail();
    state.profile.email = email;
    return (await post('/login', { email, password: 'whatever1' })).body.challengeToken;
  }

  it('right code + challenge → tokens issued', async () => {
    const challengeToken = await challenge();
    const r = await post('/login/verify', { challengeToken, code: '123456' });
    expect(r.status).toBe(200);
    expect(r.body.token).toBeTruthy();
    expect(r.body.refreshToken).toBeTruthy();
    expect(r.body.user.role).toBe('Teacher');
  });

  it('wrong code → 400, no tokens, attempt counted', async () => {
    const challengeToken = await challenge();
    const r = await post('/login/verify', { challengeToken, code: '000000' });
    expect(r.status).toBe(400);
    expect(r.body.token).toBeUndefined();
    expect(state.userUpdates).toContainEqual({ failed_login_attempts: 1 });
  });

  it('a valid code WITHOUT a valid challenge cannot log in (password still required)', async () => {
    const r = await post('/login/verify', { challengeToken: 'x'.repeat(40), code: '123456' });
    expect(r.status).toBe(401);
    expect(r.body.code).toBe('LOGIN_CHALLENGE_EXPIRED');
    expect(r.body.token).toBeUndefined();
  });

  it('a code that belongs to a different account is rejected', async () => {
    const challengeToken = await challenge();
    state.otpUserId = 'someone-else';
    const r = await post('/login/verify', { challengeToken, code: '123456' });
    expect(r.status).toBe(400);
    expect(r.body.token).toBeUndefined();
  });

  it('locks the account after 5 wrong codes', async () => {
    const challengeToken = await challenge();
    for (let i = 1; i <= 4; i++) {
      state.profile.failed_login_attempts = i - 1;
      expect((await post('/login/verify', { challengeToken, code: '000000' })).status).toBe(400);
    }
    state.profile.failed_login_attempts = 4;
    const r = await post('/login/verify', { challengeToken, code: '000000' });
    expect(r.status).toBe(423);
    expect(state.userUpdates.some((u) => u.lockout_until)).toBe(true);
  });

  it('a locked account cannot verify even with the right code', async () => {
    const challengeToken = await challenge();
    state.profile.lockout_until = new Date(Date.now() + 5 * 60000).toISOString();
    const r = await post('/login/verify', { challengeToken, code: '123456' });
    expect(r.status).toBe(423);
    expect(r.body.token).toBeUndefined();
  });

  it('rejects a malformed code before touching Supabase', async () => {
    const challengeToken = await challenge();
    expect((await post('/login/verify', { challengeToken, code: 'abc' })).status).toBe(400);
  });
});

describe('POST /login/resend-code', () => {
  it('re-sends to the account email for a valid challenge', async () => {
    const email = uniqueEmail();
    state.profile.email = email;
    const { challengeToken } = (await post('/login', { email, password: 'whatever1' })).body;
    state.otpSent = [];
    const r = await post('/login/resend-code', { challengeToken });
    expect(r.status).toBe(200);
    expect(state.otpSent).toEqual([email]);
  });

  it('refuses without a valid challenge', async () => {
    const r = await post('/login/resend-code', { challengeToken: 'y'.repeat(40) });
    expect(r.status).toBe(401);
    expect(state.otpSent).toEqual([]);
  });
});
