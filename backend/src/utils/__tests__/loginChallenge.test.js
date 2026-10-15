import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import jwt from 'jsonwebtoken';

beforeAll(() => {
  process.env.JWT_SECRET = 'test-secret-test-secret-test-secret-test-secret-test-secret-1234';
});

afterEach(() => vi.useRealTimers());

describe('login challenge token', () => {
  it('round-trips the user id', async () => {
    const { signLoginChallenge, verifyLoginChallenge } = await import('../loginChallenge.js');
    expect(verifyLoginChallenge(signLoginChallenge('user-1'))).toEqual({ userId: 'user-1' });
  });

  it('rejects garbage and tampered tokens', async () => {
    const { signLoginChallenge, verifyLoginChallenge } = await import('../loginChallenge.js');
    expect(verifyLoginChallenge('not-a-token')).toBeNull();
    const token = signLoginChallenge('user-1');
    expect(verifyLoginChallenge(token.slice(0, -2) + 'xx')).toBeNull();
  });

  it('is NOT accepted as an access token (requireAuth uses JWT_SECRET)', async () => {
    const { signLoginChallenge } = await import('../loginChallenge.js');
    expect(() => jwt.verify(signLoginChallenge('user-1'), process.env.JWT_SECRET)).toThrow();
  });

  it('an access token is NOT accepted as a login challenge', async () => {
    const { verifyLoginChallenge } = await import('../loginChallenge.js');
    const accessToken = jwt.sign({ userId: 'user-1', role: 'Teacher' }, process.env.JWT_SECRET, { expiresIn: '15m' });
    expect(verifyLoginChallenge(accessToken)).toBeNull();
  });

  it('expires after 10 minutes', async () => {
    const { signLoginChallenge, verifyLoginChallenge } = await import('../loginChallenge.js');
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    const token = signLoginChallenge('user-1');
    vi.setSystemTime(new Date('2026-01-01T00:09:00Z'));
    expect(verifyLoginChallenge(token)).not.toBeNull();
    vi.setSystemTime(new Date('2026-01-01T00:11:00Z'));
    expect(verifyLoginChallenge(token)).toBeNull();
  });
});
