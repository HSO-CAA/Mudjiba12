import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { VideoUploadSession } from '@s5y/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from '../src/config.js';
import { admin, createPlace, createTestApp, login, randomIp, type TestApp } from './helpers.js';
import { TEST_DATABASE_URL } from './env.js';

const SECRET = 'nf-proxy-secret-0123456789abcdef';
const base = { DATABASE_URL: TEST_DATABASE_URL, NODE_ENV: 'test' };

describe('Netlify hosting configuration', () => {
  it('parses the media origin, chunk size, proxy secret and frontends switch', () => {
    const c = loadConfig({
      ...base,
      MEDIA_PUBLIC_URL: 'https://api.rawvision.example/some/path/',
      UPLOAD_CHUNK_MB: '4',
      NETLIFY_PROXY_SECRET: SECRET,
      SERVE_FRONTENDS: 'false',
    });
    expect(c).toMatchObject({ mediaPublicUrl: 'https://api.rawvision.example', uploadChunkBytes: 4 * 1024 * 1024, netlifyProxySecret: SECRET, serveFrontends: false });
    expect(loadConfig(base)).toMatchObject({ mediaPublicUrl: null, uploadChunkBytes: 8 * 1024 * 1024, netlifyProxySecret: null, serveFrontends: true });
  });

  it('rejects a weak or URL-unsafe proxy secret and out-of-range chunk sizes', () => {
    expect(() => loadConfig({ ...base, NETLIFY_PROXY_SECRET: 'short' })).toThrow(ConfigError);
    expect(() => loadConfig({ ...base, NETLIFY_PROXY_SECRET: 'has/slash/inside-0123456789abc' })).toThrow(/NETLIFY_PROXY_SECRET/);
    expect(() => loadConfig({ ...base, UPLOAD_CHUNK_MB: '0' })).toThrow(/UPLOAD_CHUNK_MB/);
    expect(() => loadConfig({ ...base, UPLOAD_CHUNK_MB: '64' })).toThrow(/UPLOAD_CHUNK_MB/);
  });
});

describe('requests forwarded by the Netlify proxy', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp({ env: { NETLIFY_PROXY_SECRET: SECRET } });
  });
  afterAll(() => t.close());

  it('serves /_nf/<secret>/… as the path behind it, and 404s a wrong secret', async () => {
    const ok = await t.app.inject({ method: 'GET', url: `/_nf/${SECRET}/api/health` });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({ ok: true });
    const wrong = await t.app.inject({ method: 'GET', url: `/_nf/${SECRET.replace(/.$/, 'x')}/api/health` });
    expect(wrong.statusCode).toBe(404);
    const robots = await t.app.inject({ method: 'GET', url: `/_nf/${SECRET}/robots.txt` });
    expect(robots.statusCode).toBe(200);
  });

  const failedLogin = (url: string, headers: Record<string, string>, remoteAddress: string, n: number) =>
    t.app.inject({
      method: 'POST',
      url,
      remoteAddress,
      headers: { 'x-s5y-admin': '1', ...headers },
      payload: { email: `nobody-${n}-${Math.random().toString(36).slice(2)}@s5y.test`, password: 'wrong-password-123' },
    });

  it('rate-limits each visitor separately when the proxy names them', async () => {
    const proxyAddress = randomIp(); // every proxied request comes from the same proxy address
    const visitorA = { 'x-nf-client-connection-ip': '203.0.113.10' };
    for (let i = 0; i < 10; i++) {
      expect((await failedLogin(`/_nf/${SECRET}/api/admin/auth/login`, visitorA, proxyAddress, i)).statusCode).toBe(401);
    }
    expect((await failedLogin(`/_nf/${SECRET}/api/admin/auth/login`, visitorA, proxyAddress, 10)).statusCode).toBe(429);
    // Another visitor behind the same proxy address still has their own budget.
    const visitorB = { 'x-nf-client-connection-ip': '198.51.100.7' };
    expect((await failedLogin(`/_nf/${SECRET}/api/admin/auth/login`, visitorB, proxyAddress, 11)).statusCode).toBe(401);
  });

  it('ignores the visitor header on requests that did not come through the verified proxy', async () => {
    const attacker = randomIp();
    for (let i = 0; i < 10; i++) {
      const spoofed = { 'x-nf-client-connection-ip': `192.0.2.${i + 1}` };
      expect((await failedLogin('/api/admin/auth/login', spoofed, attacker, i)).statusCode).toBe(401);
    }
    const res = await failedLogin('/api/admin/auth/login', { 'x-nf-client-connection-ip': '192.0.2.99' }, attacker, 10);
    expect(res.statusCode).toBe(429);
  });

  it('ignores an invalid visitor address from the proxy', async () => {
    const proxyAddress = randomIp();
    const bogus = { 'x-nf-client-connection-ip': 'not-an-ip' };
    for (let i = 0; i < 10; i++) await failedLogin(`/_nf/${SECRET}/api/admin/auth/login`, bogus, proxyAddress, i);
    // Falls back to the proxy's own address, so the shared budget is spent.
    expect((await failedLogin(`/_nf/${SECRET}/api/admin/auth/login`, bogus, proxyAddress, 10)).statusCode).toBe(429);
  });
});

describe('API-only hosting (site on Netlify, media from the API)', () => {
  let t: TestApp;
  let dists: string;
  beforeAll(async () => {
    // Real builds sit where the API would serve them: SERVE_FRONTENDS=false must still leave them alone.
    dists = await fs.mkdtemp(path.join(os.tmpdir(), 's5y-netlify-dists-'));
    for (const [dir, head] of [['web', '<!--s5y-head-->'], ['admin', '<!--s5y-admin-head-->']] as const) {
      await fs.mkdir(path.join(dists, dir), { recursive: true });
      await fs.writeFile(path.join(dists, dir, 'index.html'), `<!doctype html><html><head>${head}</head><body></body></html>`);
    }
    t = await createTestApp({
      env: {
        MEDIA_PUBLIC_URL: 'https://api.rawvision.example',
        UPLOAD_CHUNK_MB: '1',
        SERVE_FRONTENDS: 'false',
        WEB_DIST: path.join(dists, 'web'),
        ADMIN_DIST: path.join(dists, 'admin'),
      },
    });
  });
  afterAll(async () => {
    await t.close();
    await fs.rm(dists, { recursive: true, force: true });
  });

  it('returns absolute media URLs and serves media for cross-origin use', async () => {
    const key = 'images/2026/11/netlifytest123.webp';
    await fs.mkdir(path.join(t.storageDir, 'images/2026/11'), { recursive: true });
    await fs.writeFile(path.join(t.storageDir, key), Buffer.from('RIFF\u0000\u0000\u0000\u0000WEBP'));
    expect(t.ctx.storage.url(key)).toBe(`https://api.rawvision.example/media/${key}`);
    const res = await t.app.inject({ method: 'GET', url: `/media/${key}` });
    expect(res.statusCode).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBe('*');
    expect(res.headers['cross-origin-resource-policy']).toBe('cross-origin');
  });

  it('hands out the configured chunk size and enforces it', async () => {
    const cookie = await login(t.app);
    const place = await createPlace(t.app, cookie, { name: 'Chunk Test Place' });
    const init = await t.app.inject({
      method: 'POST',
      url: '/api/admin/videos/uploads',
      headers: admin(cookie),
      payload: { placeId: place.id, fileName: 'clip.mp4', size: 3 * 1024 * 1024, mimeType: 'video/mp4' },
    });
    expect(init.statusCode).toBe(201);
    const session = init.json() as VideoUploadSession;
    expect(session.chunkSize).toBe(1024 * 1024);
    const tooBig = await t.app.inject({
      method: 'PATCH',
      url: `/api/admin/videos/${session.videoId}/upload`,
      headers: { ...admin(cookie), 'content-type': 'application/octet-stream', 'upload-offset': '0' },
      payload: Buffer.alloc(1024 * 1024 + 10),
    });
    expect(tooBig.statusCode).toBe(400);
  });

  it('does not serve the site or dashboard when SERVE_FRONTENDS is off', async () => {
    expect((await t.app.inject({ method: 'GET', url: '/' })).statusCode).toBe(404);
    expect((await t.app.inject({ method: 'GET', url: '/studio' })).statusCode).toBe(404);
    expect((await t.app.inject({ method: 'GET', url: '/api/health' })).statusCode).toBe(200);
  });
});
