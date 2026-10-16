import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type TestApp, createPlace, createTestApp, login } from './helpers.js';

const WEB_INDEX = `<!doctype html>
<html lang="ar" dir="rtl">
  <head>
    <meta charset="UTF-8" />
    <title>S5Y</title>
    <!--s5y-head-->
    <script type="module" crossorigin src="/assets/index-AbCdEf12.js"></script>
  </head>
  <body><div id="root"></div></body>
</html>
`;

const ADMIN_INDEX = `<!doctype html>
<html lang="ar" dir="rtl">
  <head>
    <meta charset="UTF-8" />
    <!--s5y-admin-head-->
    <title>لوحة التحكم</title>
    <script type="module" crossorigin src="./assets/main-ZyXwVu98.js"></script>
  </head>
  <body><div id="root"></div></body>
</html>
`;

let t: TestApp;
let dist: string;
let cookie: string;

beforeAll(async () => {
  dist = await fs.mkdtemp(path.join(os.tmpdir(), 's5y-api-dist-'));
  const web = path.join(dist, 'web');
  const adminDir = path.join(dist, 'admin');
  await fs.mkdir(path.join(web, 'assets'), { recursive: true });
  await fs.mkdir(path.join(adminDir, 'assets'), { recursive: true });
  await fs.writeFile(path.join(web, 'index.html'), WEB_INDEX);
  await fs.writeFile(path.join(web, 'assets', 'index-AbCdEf12.js'), 'console.log("web")');
  await fs.writeFile(path.join(web, 'favicon.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
  await fs.writeFile(path.join(adminDir, 'index.html'), ADMIN_INDEX);
  await fs.writeFile(path.join(adminDir, 'assets', 'main-ZyXwVu98.js'), 'console.log("admin")');

  t = await createTestApp({ env: { WEB_DIST: web, ADMIN_DIST: adminDir, ADMIN_PATH: '/hq-7f3a' } });
  cookie = await login(t.app);
  await createPlace(t.app, cookie, {
    name: 'Nakhla <Café> & "Roastery"',
    slug: 'nakhla',
    summary: 'قهوة مختصة <b>بغداد</b>',
    category: 'كافيه',
    location: 'بغداد',
  });
  await createPlace(t.app, cookie, { name: 'Hidden', slug: 'hidden-place', published: false });
});

afterAll(async () => {
  await t.close();
  await fs.rm(dist, { recursive: true, force: true });
});

describe('public SPA', () => {
  it('serves index.html with injected SEO tags for the home page', async () => {
    const res = await t.app.inject({ method: 'GET', url: '/' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.headers['cache-control']).toBe('no-cache');
    expect(res.headers['content-security-policy']).toContain("script-src 'self'");
    expect(res.headers['content-security-policy']).toContain("frame-ancestors 'none'");
    const html = res.body;
    expect(html).not.toContain('<!--s5y-head-->');
    expect(html.match(/<title>/g)).toHaveLength(1);
    expect(html).toContain('<title>S5Y — صانع محتوى وتصوير فيديو</title>');
    expect(html).toContain('<link rel="canonical" href="https://s5y.example/">');
    expect(html).toContain('<meta property="og:locale" content="ar_IQ">');
    expect(html).toContain('application/ld+json');
    expect(html).not.toContain('hq-7f3a');
    expect(html).not.toContain('s5y-admin');
  });

  it('injects per-place meta with escaping', async () => {
    const res = await t.app.inject({ method: 'GET', url: '/work/nakhla' });
    expect(res.statusCode).toBe(200);
    const html = res.body;
    expect(html).toContain('<title>Nakhla &lt;Café&gt; &amp; &quot;Roastery&quot; — كافيه · بغداد | S5Y</title>');
    expect(html).toContain('content="قهوة مختصة &lt;b&gt;بغداد&lt;/b&gt;"');
    expect(html).toContain('<link rel="canonical" href="https://s5y.example/work/nakhla">');
    expect(html).not.toContain('<b>بغداد</b>');
  });

  it('returns the SPA with 404 for unknown or unpublished places', async () => {
    for (const url of ['/work/unknown-place', '/work/hidden-place', '/work/%3Cscript%3E']) {
      const res = await t.app.inject({ method: 'GET', url });
      expect(res.statusCode, url).toBe(404);
      expect(res.headers['content-type']).toContain('text/html');
      expect(res.body).toContain('<div id="root"></div>');
      expect(res.body).toContain('<meta name="robots" content="noindex">');
      expect(res.body).not.toContain('<script>');
    }
  });

  it('falls back to the SPA for client routes but not for API, media or missing assets', async () => {
    const home = await t.app.inject({ method: 'GET', url: '/?utm=ig' });
    expect(home.statusCode).toBe(200);
    const route = await t.app.inject({ method: 'GET', url: '/about?utm=ig' });
    expect(route.statusCode).toBe(404); // not a client route: the SPA renders its 404 page
    expect(route.body).toContain('<div id="root"></div>');
    expect(route.body).toContain('<meta name="robots" content="noindex">');
    const api = await t.app.inject({ method: 'GET', url: '/api/nope' });
    expect(api.statusCode).toBe(404);
    expect(api.json()).toEqual({ error: { code: 'NOT_FOUND', message: expect.any(String) } });
    const apiPost = await t.app.inject({ method: 'POST', url: '/api/public/nope', payload: {} });
    expect(apiPost.statusCode).toBe(404);
    expect(apiPost.headers['content-type']).toContain('application/json');
    expect((await t.app.inject({ method: 'GET', url: '/media/videos/x/video.mp4' })).statusCode).toBe(404);
    expect((await t.app.inject({ method: 'GET', url: '/assets/missing-12345678.js' })).headers['content-type']).toContain('application/json');
  });

  it('serves assets emitted by a rebuild without a restart', async () => {
    await fs.writeFile(path.join(dist, 'web', 'assets', 'chunk-NeW12345.js'), 'export {}');
    const res = await t.app.inject({ method: 'GET', url: '/assets/chunk-NeW12345.js' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('public, max-age=31536000, immutable');
  });

  it('serves hashed assets as immutable and other files with a short cache', async () => {
    const asset = await t.app.inject({ method: 'GET', url: '/assets/index-AbCdEf12.js' });
    expect(asset.statusCode).toBe(200);
    expect(asset.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    const favicon = await t.app.inject({ method: 'GET', url: '/favicon.svg' });
    expect(favicon.headers['cache-control']).toBe('public, max-age=3600');
    const rawIndex = await t.app.inject({ method: 'GET', url: '/index.html' });
    expect(rawIndex.body).not.toContain('<!--s5y-head-->');
  });
});

describe('admin dashboard', () => {
  it('serves the admin under ADMIN_PATH with base href, base meta and noindex', async () => {
    for (const url of ['/hq-7f3a', '/hq-7f3a/', '/hq-7f3a/places/abc']) {
      const res = await t.app.inject({ method: 'GET', url });
      expect(res.statusCode, url).toBe(200);
      expect(res.headers['x-robots-tag']).toBe('noindex, nofollow');
      expect(res.headers['cache-control']).toBe('no-cache');
      const html = res.body;
      expect(html).toContain('<base href="/hq-7f3a/">');
      expect(html).toContain('<meta name="s5y-admin-base" content="/hq-7f3a">');
      expect(html).toContain('<meta name="robots" content="noindex,nofollow">');
      expect(html).not.toContain('<!--s5y-admin-head-->');
      expect(html.indexOf('<base')).toBeLessThan(html.indexOf('./assets/main-ZyXwVu98.js'));
    }
  });

  it('serves admin assets with noindex and 404s missing ones', async () => {
    const asset = await t.app.inject({ method: 'GET', url: '/hq-7f3a/assets/main-ZyXwVu98.js' });
    expect(asset.statusCode).toBe(200);
    expect(asset.headers['x-robots-tag']).toBe('noindex, nofollow');
    expect(asset.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    expect((await t.app.inject({ method: 'GET', url: '/hq-7f3a/assets/nope-12345678.js' })).statusCode).toBe(404);
  });

  it('does not expose the admin at the default path', async () => {
    const res = await t.app.inject({ method: 'GET', url: '/studio' });
    expect(res.body).not.toContain('s5y-admin-base');
  });
});

describe('robots.txt and sitemap.xml', () => {
  it('lists only public pages and never the admin path', async () => {
    const robots = await t.app.inject({ method: 'GET', url: '/robots.txt' });
    expect(robots.statusCode).toBe(200);
    expect(robots.body).toContain('Sitemap: https://s5y.example/sitemap.xml');
    expect(robots.body).not.toContain('hq-7f3a');

    const sitemap = await t.app.inject({ method: 'GET', url: '/sitemap.xml' });
    expect(sitemap.statusCode).toBe(200);
    expect(sitemap.headers['content-type']).toContain('application/xml');
    expect(sitemap.body).toContain('<loc>https://s5y.example/</loc>');
    expect(sitemap.body).toContain('<loc>https://s5y.example/work/nakhla</loc>');
    expect(sitemap.body).not.toContain('hidden-place');
    expect(sitemap.body).not.toContain('hq-7f3a');
  });
});

describe('dev mode without dist folders', () => {
  it('skips static serving gracefully', async () => {
    const bare = await createTestApp();
    try {
      const res = await bare.app.inject({ method: 'GET', url: '/' });
      expect(res.statusCode).toBe(404);
      expect(res.headers['content-type']).toContain('application/json');
      expect((await bare.app.inject({ method: 'GET', url: '/api/health' })).json()).toMatchObject({ ok: true, db: true });
      expect((await bare.app.inject({ method: 'GET', url: '/robots.txt' })).statusCode).toBe(200);
    } finally {
      await bare.close();
    }
  });
});
