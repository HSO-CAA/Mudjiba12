import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { AdminPlace, ApiErrorBody, InquiryList, SettingsResponse } from '@s5y/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cleanString, cleanStringsDeep, truncate } from '../src/lib/sanitize.js';
import { imageSize, sniffImage } from '../src/media/sniff.js';
import { MAX_FAILED_LOGINS } from '../src/services/auth.js';
import { OWNER, type TestApp, admin, createPlace, createTestApp, login, multipartBody, randomIp, sessionCookie } from './helpers.js';

let t: TestApp;
let cookie: string;

beforeAll(async () => {
  t = await createTestApp();
  cookie = await login(t.app);
});
afterAll(async () => {
  await t.close();
});

const loginRequest = (app: TestApp, email: string, password: string, extra: { ip?: string; headers?: Record<string, string> } = {}) =>
  app.app.inject({
    method: 'POST',
    url: '/api/admin/auth/login',
    headers: { 'x-s5y-admin': '1', ...extra.headers },
    remoteAddress: extra.ip ?? randomIp(),
    payload: { email, password },
  });

const unlockOwner = () =>
  t.ctx.prisma.user.update({ where: { email: OWNER.email }, data: { failedLogins: 0, lockedUntil: null } });

/** Honeypot inquiry: rate-limited like a real one but nothing is stored. */
const botInquiry = (app: TestApp, remoteAddress: string, headers: Record<string, string> = {}) =>
  app.app.inject({
    method: 'POST',
    url: '/api/public/inquiries',
    remoteAddress,
    headers,
    payload: { name: 'Bot', message: 'spam spam spam', phone: '07700000000', website: 'http://spam.example' },
  });

describe('login lockout', () => {
  it('reserves attempts atomically: parallel wrong passwords cannot bypass the lock', async () => {
    await unlockOwner();
    const results = await Promise.all(
      Array.from({ length: 30 }, (_, i) => loginRequest(t, OWNER.email, `parallel-wrong-${i}`)),
    );
    const statuses = results.map((r) => r.statusCode);
    // Exactly MAX_FAILED_LOGINS passwords were actually checked: 7 × 401, the 8th locked, the rest never verified.
    expect(statuses.filter((s) => s === 401)).toHaveLength(MAX_FAILED_LOGINS - 1);
    expect(statuses.filter((s) => s === 423)).toHaveLength(30 - (MAX_FAILED_LOGINS - 1));
    const user = await t.ctx.prisma.user.findUniqueOrThrow({ where: { email: OWNER.email } });
    expect(user.lockedUntil!.getTime() - Date.now()).toBeGreaterThan(14 * 60_000);
    expect((await loginRequest(t, OWNER.email, OWNER.password)).statusCode).toBe(423);
    await unlockOwner();
    expect((await loginRequest(t, OWNER.email, OWNER.password)).statusCode).toBe(200);
  });

  it('counts email case/whitespace variants against the same account', async () => {
    await unlockOwner();
    for (const email of ['OWNER@S5Y.TEST', '  owner@s5y.test\t', 'Owner@S5y.Test']) {
      expect((await loginRequest(t, email, 'wrong-password-x')).statusCode).toBe(401);
    }
    const user = await t.ctx.prisma.user.findUniqueOrThrow({ where: { email: OWNER.email } });
    expect(user.failedLogins).toBe(3);
    await unlockOwner();
  });
});

describe('sessions', () => {
  it('signing in again from the same browser revokes the session it presented', async () => {
    const first = await login(t.app);
    const res = await loginRequest(t, OWNER.email, OWNER.password, { headers: { cookie: first } });
    expect(res.statusCode).toBe(200);
    const second = sessionCookie(res);
    expect(second).not.toBe(first);
    expect((await t.app.inject({ method: 'GET', url: '/api/admin/auth/me', headers: { cookie: first } })).statusCode).toBe(401);
    expect((await t.app.inject({ method: 'GET', url: '/api/admin/auth/me', headers: { cookie: second } })).statusCode).toBe(200);
  });

  it('every /api/admin route except login/logout requires a session', async () => {
    const routes: [string, string][] = [
      ['GET', '/api/admin/auth/me'], ['POST', '/api/admin/auth/password'], ['GET', '/api/admin/overview'],
      ['GET', '/api/admin/places'], ['POST', '/api/admin/places'], ['PUT', '/api/admin/places/order'],
      ['GET', '/api/admin/places/x'], ['PATCH', '/api/admin/places/x'], ['DELETE', '/api/admin/places/x'],
      ['PUT', '/api/admin/places/x/videos/order'], ['GET', '/api/admin/plans'], ['POST', '/api/admin/plans'],
      ['PUT', '/api/admin/plans/order'], ['PATCH', '/api/admin/plans/x'], ['DELETE', '/api/admin/plans/x'],
      ['GET', '/api/admin/videos'], ['POST', '/api/admin/videos/uploads'], ['GET', '/api/admin/videos/x'],
      ['PATCH', '/api/admin/videos/x'], ['DELETE', '/api/admin/videos/x'], ['GET', '/api/admin/videos/x/upload'],
      ['HEAD', '/api/admin/videos/x/upload'], ['PATCH', '/api/admin/videos/x/upload'], ['POST', '/api/admin/videos/x/upload/complete'],
      ['POST', '/api/admin/videos/x/reprocess'], ['POST', '/api/admin/uploads/image'], ['GET', '/api/admin/inquiries'],
      ['PATCH', '/api/admin/inquiries/x'], ['DELETE', '/api/admin/inquiries/x'], ['GET', '/api/admin/settings'],
      ['HEAD', '/api/admin/settings'], ['PUT', '/api/admin/settings'], ['GET', '/api/admin/%73ettings'],
    ];
    for (const [method, url] of routes) {
      for (const headers of [{ 'x-s5y-admin': '1' }, { 'x-s5y-admin': '1', cookie: 's5y_sid=forged-token' }]) {
        const res = await t.app.inject({ method: method as 'GET', url, headers, remoteAddress: randomIp() });
        expect(res.statusCode, `${method} ${url}`).toBe(401);
      }
    }
  });
});

describe('client strings that PostgreSQL cannot store', () => {
  it('cleans NUL characters and lone surrogates instead of failing with a 500', async () => {
    const created = await t.app.inject({
      method: 'POST',
      url: '/api/public/inquiries',
      remoteAddress: randomIp(),
      payload: { name: 'Ali\u0000 Hasan', message: 'hello \ud800 there', phone: '07700000000', source: `${'a'.repeat(119)}😀` },
    });
    expect(created.statusCode).toBe(201);
    const row = await t.ctx.prisma.inquiry.findUniqueOrThrow({ where: { id: (created.json() as { id: string }).id } });
    expect(row.name).toBe('Ali Hasan');
    expect(row.message).toBe('hello \ufffd there');
    // The 120-char cut never splits the emoji's surrogate pair.
    expect(row.source).toBe('a'.repeat(119));

    const badLogin = await loginRequest(t, 'own\u0000er@s5y.test', 'x\u0000');
    expect(badLogin.statusCode).toBe(401);

    const search = await t.app.inject({ method: 'GET', url: '/api/admin/inquiries?q=%00Ali', headers: { cookie } });
    expect(search.statusCode).toBe(200);
    expect((search.json() as InquiryList).total).toBeGreaterThanOrEqual(1);

    const place = await createPlace(t.app, cookie, { name: 'Surrogate \udc00 place\u0000' });
    expect(place.name).toBe('Surrogate \ufffd place');
    const patched = await t.app.inject({
      method: 'PATCH',
      url: `/api/admin/places/${place.id}`,
      headers: admin(cookie),
      payload: { services: ['\u0000تصوير'], summary: '\ud83d' },
    });
    expect(patched.statusCode).toBe(200);
    expect((patched.json() as AdminPlace).services).toEqual(['تصوير']);

    const current = (await t.app.inject({ method: 'GET', url: '/api/admin/settings', headers: { cookie } })).json() as SettingsResponse;
    const saved = await t.app.inject({
      method: 'PUT',
      url: '/api/admin/settings',
      headers: admin(cookie),
      payload: { ...current.settings, brand: { ...current.settings.brand, name: 'S5Y\u0000' } },
    });
    expect(saved.statusCode).toBe(200);
    expect((saved.json() as SettingsResponse).settings.brand.name).toBe('S5Y');

    const beacon = await t.app.inject({
      method: 'POST',
      url: '/api/public/track',
      remoteAddress: randomIp(),
      headers: { 'content-type': 'text/plain' },
      payload: '{"type":"pageview","path":"/\\u0000"}',
    });
    expect(beacon.statusCode).toBe(204);
  });

  it('handles very deeply nested bodies without crashing', async () => {
    const deep = `${'{"a":'.repeat(100_000)}"\\u0000"${'}'.repeat(100_000)}`;
    const res = await t.app.inject({
      method: 'POST',
      url: '/api/public/inquiries',
      remoteAddress: randomIp(),
      headers: { 'content-type': 'application/json' },
      payload: deep,
    });
    expect(res.statusCode).toBe(400);
    expect((res.json() as ApiErrorBody).error.code).toBe('VALIDATION_ERROR');
  });

  it('sanitizer helpers', () => {
    expect(cleanString('ok 😀')).toBe('ok 😀');
    expect(cleanString('a\u0000b\udbff')).toBe('ab\ufffd');
    expect(truncate('ab😀', 3)).toBe('ab');
    expect(truncate('ab😀', 4)).toBe('ab😀');
    const body = JSON.parse('{"__proto__":{"x":"\\u0000"},"list":["\\u0000a",{"b":"\\ud800"}]}') as Record<string, unknown>;
    cleanStringsDeep(body);
    expect(body).toEqual(JSON.parse('{"__proto__":{"x":""},"list":["a",{"b":"\\ufffd"}]}'));
    expect(({} as Record<string, unknown>).x).toBeUndefined();
  });
});

describe('client IP and rate limits', () => {
  it('TRUST_PROXY=false ignores spoofed X-Forwarded-For', async () => {
    const ip = randomIp();
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) statuses.push((await botInquiry(t, ip, { 'x-forwarded-for': `198.51.100.${i + 1}` })).statusCode);
    expect(statuses).toEqual([201, 201, 201, 201, 201, 429]);
  });

  it('TRUST_PROXY=true only believes X-Forwarded-For from private-network proxies', async () => {
    const p = await createTestApp({ env: { TRUST_PROXY: 'true' } });
    try {
      // A client reaching the app port directly can't pick its own IP…
      const direct: number[] = [];
      for (let i = 0; i < 6; i++) direct.push((await botInquiry(p, '203.0.113.7', { 'x-forwarded-for': `198.51.100.${i + 1}` })).statusCode);
      expect(direct).toEqual([201, 201, 201, 201, 201, 429]);
      // …while clients behind the reverse proxy (Docker network / same host) each get their own bucket.
      const proxied: number[] = [];
      for (let i = 0; i < 6; i++) proxied.push((await botInquiry(p, '172.18.0.2', { 'x-forwarded-for': `198.51.100.${i + 1}` })).statusCode);
      expect(proxied.every((s) => s === 201)).toBe(true);
      // Nginx-style appended chains: the left-most (client-written) entry is not trusted.
      const viaNginx = await loginRequest(p, OWNER.email, OWNER.password, { ip: '127.0.0.1', headers: { 'x-forwarded-for': '6.6.6.6, 198.51.100.77' } });
      expect(viaNginx.statusCode).toBe(200);
      const session = await p.ctx.prisma.session.findFirstOrThrow({ orderBy: { createdAt: 'desc' } });
      expect(session.ip).toBe('198.51.100.77');
    } finally {
      await p.close();
    }
  });

  it('keys IPv6 clients by /64 so rotating addresses does not reset the limit', async () => {
    const statuses: number[] = [];
    for (let i = 1; i <= 6; i++) statuses.push((await botInquiry(t, `2001:db8:5:6::${i.toString(16)}`)).statusCode);
    expect(statuses).toEqual([201, 201, 201, 201, 201, 429]);
    expect((await botInquiry(t, '2001:db8:5:7::1')).statusCode).toBe(201);
  });
});

describe('global rate limit and static files', () => {
  let s: TestApp;
  let dist: string;

  beforeAll(async () => {
    dist = await fs.mkdtemp(path.join(os.tmpdir(), 's5y-sec-dist-'));
    await fs.mkdir(path.join(dist, 'assets'));
    await fs.writeFile(path.join(dist, 'index.html'), '<!doctype html><html><head><!--s5y-head--></head><body></body></html>');
    await fs.writeFile(path.join(dist, 'assets', 'app-abc123.js'), 'console.log(1)');
    s = await createTestApp({ env: { WEB_DIST: dist } });
    await fs.mkdir(path.join(s.storageDir, 'images', '2026', '01'), { recursive: true });
    await fs.writeFile(path.join(s.storageDir, 'images', '2026', '01', 'abcdefgh12.png'), Buffer.from('png'));
  });
  afterAll(async () => {
    await s.close();
    await fs.rm(dist, { recursive: true, force: true });
  });

  it('does not spend the per-IP budget on hashed assets and media (CGNAT visitors)', async () => {
    const ip = randomIp();
    for (let i = 0; i < 320; i++) {
      const asset = await s.app.inject({ method: 'GET', url: '/assets/app-abc123.js', remoteAddress: ip });
      const media = await s.app.inject({ method: 'GET', url: '/media/images/2026/01/abcdefgh12.png', remoteAddress: ip });
      if (i === 0) {
        expect(asset.statusCode).toBe(200);
        expect(media.statusCode).toBe(200);
        expect(asset.headers['x-ratelimit-limit']).toBeUndefined();
        expect(media.headers['x-ratelimit-limit']).toBeUndefined();
      }
    }
    const api = await s.app.inject({ method: 'GET', url: '/api/public/plans', remoteAddress: ip });
    expect(api.statusCode).toBe(200);
    expect(api.headers['x-ratelimit-remaining']).toBe('599');
  });

  it('still applies the 600/min budget to pages and the API', async () => {
    const ip = randomIp();
    let last = 0;
    for (let i = 0; i < 601; i++) last = (await s.app.inject({ method: 'GET', url: '/robots.txt', remoteAddress: ip })).statusCode;
    expect(last).toBe(429);
    expect((await s.app.inject({ method: 'GET', url: '/', remoteAddress: ip })).statusCode).toBe(429);
  });
});

describe('image dimension limits', () => {
  const box = (type: string, body: Buffer) => {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(8 + body.length, 0);
    head.write(type, 4, 'latin1');
    return Buffer.concat([head, body]);
  };
  const ispe = (w: number, h: number) => {
    const b = Buffer.alloc(12);
    b.writeUInt32BE(w, 4);
    b.writeUInt32BE(h, 8);
    return box('ispe', b);
  };
  const avif = (...sizes: [number, number][]) =>
    Buffer.concat([box('ftyp', Buffer.from('avif\0\0\0\0avifmif1', 'latin1')), box('meta', Buffer.concat(sizes.map(([w, h]) => ispe(w, h))))]);

  it('reads AVIF dimensions from ispe (largest = grid canvas)', () => {
    const buf = avif([512, 512], [4096, 2048]);
    expect(sniffImage(buf)).toBe('avif');
    expect(imageSize(buf, 'avif')).toEqual({ width: 4096, height: 2048 });
  });

  it('rejects AVIF decompression bombs before decoding', async () => {
    const { payload, headers } = multipartBody('file', 'bomb.avif', 'image/avif', avif([60_000, 60_000]));
    const res = await t.app.inject({ method: 'POST', url: '/api/admin/uploads/image', headers: { ...admin(cookie), ...headers }, payload });
    expect(res.statusCode).toBe(400);
    expect((res.json() as ApiErrorBody).error.code).toBe('BAD_REQUEST');
  });
});
