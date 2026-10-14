import type { AdminUser, ApiErrorBody } from '@s5y/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { verifyPassword } from '../src/lib/crypto.js';
import { OWNER, type TestApp, admin, createTestApp, login, randomIp, sessionCookie } from './helpers.js';

let t: TestApp;

beforeAll(async () => {
  t = await createTestApp();
});
afterAll(async () => {
  await t.close();
});

const loginRequest = (email: string, password: string, ip = randomIp()) =>
  t.app.inject({
    method: 'POST',
    url: '/api/admin/auth/login',
    headers: { 'x-s5y-admin': '1' },
    remoteAddress: ip,
    payload: { email, password },
  });

describe('first boot', () => {
  it('creates the owner from ADMIN_EMAIL/ADMIN_PASSWORD with a scrypt hash', async () => {
    const user = await t.ctx.prisma.user.findUniqueOrThrow({ where: { email: OWNER.email } });
    expect(user.role).toBe('OWNER');
    expect(user.passwordHash).toMatch(/^scrypt\$32768\$8\$1\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/);
    expect(await verifyPassword(OWNER.password, user.passwordHash)).toBe(true);
    expect(await verifyPassword('wrong-password', user.passwordHash)).toBe(false);
  });
});

describe('login', () => {
  it('signs in with valid credentials and sets a strict httpOnly cookie', async () => {
    const res = await loginRequest(OWNER.email.toUpperCase(), OWNER.password);
    expect(res.statusCode).toBe(200);
    const body = res.json() as { user: AdminUser };
    expect(body.user).toMatchObject({ email: OWNER.email, name: OWNER.name, role: 'OWNER' });
    expect(body.user.lastLoginAt).not.toBeNull();
    expect(body.user).not.toHaveProperty('passwordHash');
    const cookie = res.cookies.find((c) => c.name === 's5y_sid');
    expect(cookie).toBeDefined();
    expect(cookie?.httpOnly).toBe(true);
    expect(cookie?.sameSite).toBe('Strict');
    expect(cookie?.path).toBe('/');
    expect(cookie?.maxAge).toBe(30 * 24 * 3600);
    expect(cookie?.value).toMatch(/^[A-Za-z0-9_-]{43}$/);
    // Only the SHA-256 of the token is stored.
    const session = await t.ctx.prisma.session.findFirstOrThrow({ orderBy: { createdAt: 'desc' } });
    expect(session.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(session.tokenHash).not.toContain(cookie?.value);
  });

  it('rejects wrong passwords and unknown accounts with the same 401', async () => {
    const wrong = await loginRequest(OWNER.email, 'not-the-password');
    const unknown = await loginRequest('nobody@s5y.test', 'whatever-password');
    for (const res of [wrong, unknown]) {
      expect(res.statusCode).toBe(401);
      const body = res.json() as ApiErrorBody;
      expect(body.error.code).toBe('UNAUTHORIZED');
      expect(body.error.message).toMatch(/[؀-ۿ]/);
    }
    expect((wrong.json() as ApiErrorBody).error.message).toBe((unknown.json() as ApiErrorBody).error.message);
    await t.ctx.prisma.user.update({ where: { email: OWNER.email }, data: { failedLogins: 0 } });
  });

  it('rejects malformed JSON with a 400', async () => {
    const res = await t.app.inject({
      method: 'POST',
      url: '/api/admin/auth/login',
      headers: { 'x-s5y-admin': '1', 'content-type': 'application/json' },
      remoteAddress: randomIp(),
      payload: '{"email": ',
    });
    expect(res.statusCode).toBe(400);
    expect((res.json() as ApiErrorBody).error.code).toBe('BAD_REQUEST');
    const poisoned = await t.app.inject({
      method: 'POST',
      url: '/api/admin/auth/login',
      headers: { 'x-s5y-admin': '1', 'content-type': 'application/json' },
      remoteAddress: randomIp(),
      payload: '{"__proto__": {"admin": true}, "email": "a", "password": "b"}',
    });
    expect(poisoned.statusCode).toBe(400);
  });

  it('validates the body', async () => {
    const res = await t.app.inject({
      method: 'POST',
      url: '/api/admin/auth/login',
      headers: { 'x-s5y-admin': '1' },
      remoteAddress: randomIp(),
      payload: { email: '' },
    });
    expect(res.statusCode).toBe(400);
    expect((res.json() as ApiErrorBody).error.code).toBe('VALIDATION_ERROR');
  });

  it('locks the account for 15 minutes after 8 consecutive failures', async () => {
    const ip = randomIp();
    for (let i = 1; i <= 7; i++) {
      const res = await loginRequest(OWNER.email, `bad-password-${i}`, ip);
      expect(res.statusCode).toBe(401);
    }
    const eighth = await loginRequest(OWNER.email, 'bad-password-8', ip);
    expect(eighth.statusCode).toBe(423);
    expect((eighth.json() as ApiErrorBody).error.code).toBe('ACCOUNT_LOCKED');
    // Even the right password is refused while locked.
    const locked = await loginRequest(OWNER.email, OWNER.password);
    expect(locked.statusCode).toBe(423);
    const user = await t.ctx.prisma.user.findUniqueOrThrow({ where: { email: OWNER.email } });
    expect(user.lockedUntil!.getTime() - Date.now()).toBeGreaterThan(14 * 60_000);

    // After the lock expires the right password works again.
    await t.ctx.prisma.user.update({ where: { id: user.id }, data: { lockedUntil: new Date(Date.now() - 1000) } });
    expect((await loginRequest(OWNER.email, OWNER.password)).statusCode).toBe(200);
  });

  it('rate-limits login attempts per IP (10 per 15 minutes)', async () => {
    const ip = randomIp();
    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) statuses.push((await loginRequest('nobody@s5y.test', 'x-password', ip)).statusCode);
    expect(statuses.slice(0, 10).every((s) => s === 401)).toBe(true);
    expect(statuses[10]).toBe(429);
    const res = await loginRequest('nobody@s5y.test', 'x-password', ip);
    expect((res.json() as ApiErrorBody).error.code).toBe('RATE_LIMITED');
  });
});

describe('session', () => {
  it('requires a session for admin endpoints', async () => {
    const res = await t.app.inject({ method: 'GET', url: '/api/admin/auth/me' });
    expect(res.statusCode).toBe(401);
    expect((res.json() as ApiErrorBody).error.code).toBe('UNAUTHORIZED');
    const forged = await t.app.inject({ method: 'GET', url: '/api/admin/places', headers: { cookie: 's5y_sid=forged-token' } });
    expect(forged.statusCode).toBe(401);
  });

  it('returns the current user from /me with no-store caching', async () => {
    const cookie = await login(t.app);
    const res = await t.app.inject({ method: 'GET', url: '/api/admin/auth/me', headers: { cookie } });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { user: AdminUser }).user.email).toBe(OWNER.email);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['x-robots-tag']).toContain('noindex');
  });

  it('slides the expiry forward when the session was not seen for a while', async () => {
    const cookie = await login(t.app);
    const session = await t.ctx.prisma.session.findFirstOrThrow({ orderBy: { createdAt: 'desc' } });
    const old = new Date(Date.now() - 60 * 60_000);
    await t.ctx.prisma.session.update({ where: { id: session.id }, data: { lastSeenAt: old, expiresAt: new Date(Date.now() + 1000 * 60) } });
    const res = await t.app.inject({ method: 'GET', url: '/api/admin/auth/me', headers: { cookie } });
    expect(res.statusCode).toBe(200);
    expect(res.cookies.find((c) => c.name === 's5y_sid')).toBeDefined();
    const refreshed = await t.ctx.prisma.session.findUniqueOrThrow({ where: { id: session.id } });
    expect(refreshed.expiresAt.getTime()).toBeGreaterThan(Date.now() + 29 * 24 * 3600_000);
  });

  it('rejects expired sessions', async () => {
    const cookie = await login(t.app);
    const session = await t.ctx.prisma.session.findFirstOrThrow({ orderBy: { createdAt: 'desc' } });
    await t.ctx.prisma.session.update({ where: { id: session.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    const res = await t.app.inject({ method: 'GET', url: '/api/admin/auth/me', headers: { cookie } });
    expect(res.statusCode).toBe(401);
    expect(await t.ctx.prisma.session.findUnique({ where: { id: session.id } })).toBeNull();
  });

  it('logs out and clears the cookie (empty JSON body accepted)', async () => {
    const cookie = await login(t.app);
    const res = await t.app.inject({
      method: 'POST',
      url: '/api/admin/auth/logout',
      headers: { ...admin(cookie), 'content-type': 'application/json' },
    });
    expect(res.statusCode).toBe(204);
    const cleared = res.cookies.find((c) => c.name === 's5y_sid');
    expect(cleared?.value).toBe('');
    const me = await t.app.inject({ method: 'GET', url: '/api/admin/auth/me', headers: { cookie } });
    expect(me.statusCode).toBe(401);
  });
});

describe('CSRF header', () => {
  it('rejects state-changing admin requests without X-S5Y-Admin: 1', async () => {
    const cookie = await login(t.app);
    const res = await t.app.inject({ method: 'POST', url: '/api/admin/places', headers: { cookie }, payload: { name: 'X' } });
    expect(res.statusCode).toBe(403);
    expect((res.json() as ApiErrorBody).error.code).toBe('FORBIDDEN');
    const wrong = await t.app.inject({
      method: 'POST',
      url: '/api/admin/places',
      headers: { cookie, 'x-s5y-admin': 'yes' },
      payload: { name: 'X' },
    });
    expect(wrong.statusCode).toBe(403);
    const noHeaderLogin = await t.app.inject({
      method: 'POST',
      url: '/api/admin/auth/login',
      remoteAddress: randomIp(),
      payload: { email: OWNER.email, password: OWNER.password },
    });
    expect(noHeaderLogin.statusCode).toBe(403);
    // GETs don't need it.
    expect((await t.app.inject({ method: 'GET', url: '/api/admin/places', headers: { cookie } })).statusCode).toBe(200);
  });
});

describe('password change', () => {
  it('validates input and the current password', async () => {
    const cookie = await login(t.app);
    const short = await t.app.inject({
      method: 'POST',
      url: '/api/admin/auth/password',
      headers: admin(cookie),
      payload: { currentPassword: OWNER.password, newPassword: 'short' },
    });
    expect(short.statusCode).toBe(400);
    expect((short.json() as ApiErrorBody).error.code).toBe('VALIDATION_ERROR');
    const wrongCurrent = await t.app.inject({
      method: 'POST',
      url: '/api/admin/auth/password',
      headers: admin(cookie),
      payload: { currentPassword: 'not-current-password', newPassword: 'Another-Long-Password' },
    });
    expect(wrongCurrent.statusCode).toBe(400);
    const details = (wrongCurrent.json() as ApiErrorBody).error.details as { path: string[] }[];
    expect(details[0]?.path).toEqual(['currentPassword']);
  });

  it('changes the password and revokes every other session', async () => {
    const a = await login(t.app);
    const b = await login(t.app);
    const res = await t.app.inject({
      method: 'POST',
      url: '/api/admin/auth/password',
      headers: admin(a),
      payload: { currentPassword: OWNER.password, newPassword: 'Brand-New-Password-1' },
    });
    expect(res.statusCode).toBe(204);
    expect((await t.app.inject({ method: 'GET', url: '/api/admin/auth/me', headers: { cookie: a } })).statusCode).toBe(200);
    expect((await t.app.inject({ method: 'GET', url: '/api/admin/auth/me', headers: { cookie: b } })).statusCode).toBe(401);
    expect((await loginRequestRaw(OWNER.password)).statusCode).toBe(401);
    const fresh = await loginRequestRaw('Brand-New-Password-1');
    expect(fresh.statusCode).toBe(200);
    expect(sessionCookie(fresh)).toMatch(/^s5y_sid=/);
  });
});

function loginRequestRaw(password: string) {
  return loginRequest(OWNER.email, password);
}
