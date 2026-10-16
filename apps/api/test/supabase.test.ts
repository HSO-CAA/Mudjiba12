import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { AdminVideo, ApiErrorBody, UploadedImage } from '@s5y/shared';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { STORAGE_TOO_LARGE_MESSAGE } from '../src/media/video.js';
import { STORAGE_MESSAGES } from '../src/lib/errors.js';
import {
  LocalStorage,
  StagedSourceStorage,
  StorageAuthError,
  StorageObjectTooLargeError,
  StorageRequestError,
  SupabaseStorage,
  type StorageLog,
} from '../src/storage/index.js';
import type { SupabaseStorageOptions } from '../src/storage/supabase.js';
import { NO_FFMPEG, type TestApp, admin, createPlace, createTestApp, login, multipartBody, uploadVideo } from './helpers.js';
import { type MockSupabase, startMockSupabase } from './supabase-mock.js';

const fixtures = inject('fixturesDir');

interface LogEntry {
  level: 'info' | 'warn' | 'error';
  obj: object;
  msg: string | undefined;
}

function captureLog(): { log: StorageLog; entries: LogEntry[]; text(): string } {
  const entries: LogEntry[] = [];
  const push = (level: LogEntry['level']) => (obj: object, msg?: string) => entries.push({ level, obj, msg });
  return { log: { info: push('info'), warn: push('warn'), error: push('error') }, entries, text: () => JSON.stringify(entries) };
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

let mock: MockSupabase;
let tmp: string;
let n = 0;

async function tempFile(content: Buffer | string): Promise<string> {
  const file = path.join(tmp, `f-${++n}`);
  await fs.writeFile(file, content);
  return file;
}

const driver = (options: SupabaseStorageOptions = {}, key = mock.serviceKey, bucket = 'media') =>
  new SupabaseStorage({ url: mock.url, serviceKey: key, bucket, projectRef: null }, { retryBaseMs: 1, ...options });

beforeAll(async () => {
  mock = await startMockSupabase();
  mock.createBucket('media', { public: true });
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 's5y-supabase-'));
});
afterAll(async () => {
  await mock.close();
  await fs.rm(tmp, { recursive: true, force: true });
});

describe('Supabase storage driver', () => {
  it('init creates a missing bucket as public and logs driver, bucket and origin (never the key)', async () => {
    const { log, entries, text } = captureLog();
    await driver({}, mock.serviceKey, 'fresh-bucket').init(log);
    expect(mock.buckets.get('fresh-bucket')).toMatchObject({ public: true });
    expect(entries.some((e) => e.msg === 'created public Supabase bucket')).toBe(true);
    expect(entries.at(-1)).toMatchObject({ level: 'info', obj: { storage: 'supabase', bucket: 'fresh-bucket', origin: mock.url } });
    expect(text()).not.toContain(mock.serviceKey);
    // Idempotent, also when the "not found" answer is a real 404.
    mock.notFoundStatus = 404;
    try {
      const again = captureLog();
      await driver({}, mock.serviceKey, 'fresh-bucket').init(again.log);
      expect(again.entries.filter((e) => e.level !== 'info')).toEqual([]);
      await driver({}, mock.serviceKey, 'fresh-404').init(again.log);
      expect(mock.buckets.get('fresh-404')?.public).toBe(true);
    } finally {
      mock.notFoundStatus = 400;
    }
  });

  it('init makes a private bucket public', async () => {
    mock.createBucket('was-private', { public: false });
    const { log, entries } = captureLog();
    await driver({}, mock.serviceKey, 'was-private').init(log);
    expect(mock.buckets.get('was-private')?.public).toBe(true);
    expect(entries.some((e) => /made it public/.test(e.msg ?? ''))).toBe(true);
  });

  it('init logs an actionable error for a wrong key or an unreachable project but never throws', async () => {
    const anon = captureLog();
    await expect(driver({}, mock.anonKey, 'anon-bucket').init(anon.log)).resolves.toBeUndefined();
    const error = anon.entries.find((e) => e.level === 'error');
    expect(error?.msg).toMatch(/service_role/);
    expect(anon.text()).not.toContain(mock.anonKey);
    expect(mock.buckets.has('anon-bucket')).toBe(false);

    const bad = captureLog();
    await driver({}, 'definitely-not-a-key', 'x').init(bad.log);
    expect(bad.entries.find((e) => e.level === 'error')?.msg).toMatch(/rejected the key/);
    expect(bad.text()).not.toContain('definitely-not-a-key');

    const down = captureLog();
    const unreachable = new SupabaseStorage({ url: 'http://127.0.0.1:1', serviceKey: mock.serviceKey, bucket: 'media', projectRef: null }, { retryBaseMs: 1 });
    await unreachable.init(down.log);
    expect(down.entries.find((e) => e.level === 'error')?.msg).toMatch(/cannot reach Supabase Storage.*paused/);
    expect(down.text()).not.toContain(mock.serviceKey);
  });

  it('uploads like supabase-js (apikey + Bearer, x-upsert, cache-control, content-length) and serves public URLs with Range', async () => {
    const s = driver();
    const key = 'images/2026/10/abc.webp';
    const data = Buffer.from('RIFF....WEBPVP8 hello supabase');
    const file = await tempFile(data);
    const before = mock.requests.length;
    await s.putFile(key, file, { contentType: 'image/webp' });
    const req = mock.requests.slice(before).find((r) => r.method === 'POST')!;
    expect(req.path).toBe('/storage/v1/object/media/images/2026/10/abc.webp');
    expect(req.headers).toMatchObject({
      apikey: mock.serviceKey,
      authorization: `Bearer ${mock.serviceKey}`,
      'x-upsert': 'true',
      'cache-control': 'max-age=31536000',
      'content-type': 'image/webp',
      'content-length': String(data.length),
    });
    expect(req.headers['transfer-encoding']).toBeUndefined();
    expect(mock.object('media', key)?.data.equals(data)).toBe(true);
    expect(existsSync(file)).toBe(true); // copy, not move

    // Upsert: the same key can be written again.
    const replacement = await tempFile('second version');
    await s.putFile(key, replacement, { contentType: 'image/webp', move: true });
    expect(mock.object('media', key)?.data.toString()).toBe('second version');
    expect(existsSync(replacement)).toBe(false); // moved

    const url = s.url(key);
    expect(url).toBe(`${mock.url}/storage/v1/object/public/media/images/2026/10/abc.webp`);
    expect(s.publicOrigin).toBe(mock.url);
    const res = await fetch(url, { headers: { range: 'bytes=0-5' } });
    expect(res.status).toBe(206);
    expect(res.headers.get('content-range')).toBe('bytes 0-5/14');
    expect(res.headers.get('cache-control')).toBe('max-age=31536000');
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    expect(await res.text()).toBe('second');
  });

  it('the mock enforces upsert semantics and auth like Supabase', async () => {
    const target = `${mock.url}/storage/v1/object/media/images/2026/10/abc.webp`;
    const dup = await fetch(target, { method: 'POST', headers: { apikey: mock.serviceKey, authorization: `Bearer ${mock.serviceKey}`, 'content-type': 'image/webp' }, body: 'x' });
    expect(dup.status).toBe(400);
    expect(await dup.json()).toMatchObject({ statusCode: '409', error: 'Duplicate' });
    const anon = await fetch(target, { method: 'POST', headers: { apikey: mock.anonKey, authorization: `Bearer ${mock.anonKey}`, 'x-upsert': 'true' }, body: 'x' });
    expect(await anon.json()).toMatchObject({ statusCode: '403', message: 'new row violates row-level security policy' });
    expect((await fetch(target, { method: 'POST', body: 'x' })).status).toBe(401);
  });

  it('exists, getLocalFile and delete', async () => {
    const s = driver();
    const key = 'videos/vid1/video.mp4';
    mock.putObject('media', key, 'video bytes', 'video/mp4');
    expect(await s.exists(key)).toBe(true);
    expect(await s.exists('videos/vid1/missing.mp4')).toBe(false);
    mock.notFoundStatus = 404;
    try {
      expect(await s.exists('videos/vid1/missing.mp4')).toBe(false);
    } finally {
      mock.notFoundStatus = 400;
    }
    const local = await s.getLocalFile(key, path.join(tmp, 'dl'));
    expect(await fs.readFile(local.path, 'utf8')).toBe('video bytes');
    await local.cleanup();
    expect(existsSync(local.path)).toBe(false);
    await expect(s.getLocalFile('videos/vid1/missing.mp4', tmp)).rejects.toBeInstanceOf(StorageRequestError);

    await s.delete(key);
    expect(mock.object('media', key)).toBeUndefined();
    await expect(s.delete(key)).resolves.toBeUndefined(); // already gone is fine
    await expect(s.exists('../etc/passwd')).rejects.toThrow(/Unsafe storage key/);
  });

  it('deletePrefix lists recursively (folders have id null) with pagination and deletes in batches of ≤1000', async () => {
    for (const name of ['a', 'b', 'c', 'd', 'e', 'f', 'g']) mock.putObject('media', `videos/v1/${name}.mp4`, name);
    mock.putObject('media', 'videos/v1/sub/x.jpg', 'x');
    mock.putObject('media', 'videos/v1/sub/deeper/y.jpg', 'y');
    mock.putObject('media', 'videos/v10/keep.mp4', 'keep'); // shares the string prefix "videos/v1"
    mock.putObject('media', 'videos/v2/keep.mp4', 'keep');
    const before = mock.requests.length;
    await driver({ listPageSize: 3 }).deletePrefix('videos/v1/');
    expect(mock.keys('media').filter((k) => k.startsWith('videos/v1'))).toEqual(['videos/v10/keep.mp4']);
    expect(mock.object('media', 'videos/v2/keep.mp4')).toBeDefined();
    const lists = mock.requests.slice(before).filter((r) => r.path === '/storage/v1/object/list/media');
    expect(lists.length).toBeGreaterThanOrEqual(5); // 4 pages of the top folder (10 entries / 3) + sub + deeper

    for (let i = 0; i < 1001; i++) mock.putObject('media', `videos/big/f${String(i).padStart(4, '0')}.jpg`, 'x');
    const mark = mock.requests.length;
    await driver().deletePrefix('videos/big/');
    expect(mock.keys('media').some((k) => k.startsWith('videos/big/'))).toBe(false);
    const deletes = mock.requests.slice(mark).filter((r) => r.method === 'DELETE');
    expect(deletes).toHaveLength(2);
    await expect(driver().deletePrefix('videos/')).rejects.toThrow(/Unsafe storage prefix/);
  });

  it('maps "object too large" (HTTP 413, or 400 with statusCode "413") to StorageObjectTooLargeError', async () => {
    const file = await tempFile(Buffer.alloc(2000, 1));
    mock.maxObjectBytes = 1000;
    try {
      for (const status of [413, 400] as const) {
        mock.tooLargeStatus = status;
        const err = await driver()
          .putFile('videos/large/video.mp4', file, { contentType: 'video/mp4' })
          .catch((e: unknown) => e);
        expect(err, `HTTP ${status}`).toBeInstanceOf(StorageObjectTooLargeError);
        expect(mock.object('media', 'videos/large/video.mp4')).toBeUndefined();
      }
    } finally {
      mock.maxObjectBytes = 50 * 1024 * 1024;
      mock.tooLargeStatus = 413;
    }
    expect(existsSync(file)).toBe(true);

    // A bucket-level limit read by init() fails big files before uploading anything.
    mock.createBucket('limited', { public: true, file_size_limit: 500 });
    const limited = driver({}, mock.serviceKey, 'limited');
    await limited.init(captureLog().log);
    const mark = mock.requests.length;
    await expect(limited.putFile('videos/large/video.mp4', file, { contentType: 'video/mp4' })).rejects.toBeInstanceOf(StorageObjectTooLargeError);
    expect(mock.requests.slice(mark).filter((r) => r.method === 'POST')).toHaveLength(0);
  });

  it('rejected keys become StorageAuthError without the key in the message; sb_secret keys work', async () => {
    const file = await tempFile('x');
    for (const key of [mock.anonKey, mock.publishableKey, 'garbage-key-value']) {
      const err = await driver({}, key)
        .putFile('images/2026/10/auth.webp', file, { contentType: 'image/webp' })
        .catch((e: unknown) => e);
      expect(err).toBeInstanceOf(StorageAuthError);
      expect(String((err as Error).message)).not.toContain(key);
      expect(JSON.stringify(err)).not.toContain(key);
    }
    await driver({}, mock.secretKey).putFile('images/2026/10/secret.webp', file, { contentType: 'image/webp' });
    expect(mock.object('media', 'images/2026/10/secret.webp')).toBeDefined();
  });

  it('retries network errors, 5xx and 429 with a fresh file stream; never retries 4xx', async () => {
    const data = Buffer.alloc(256 * 1024, 7);
    data.write('start');
    const file = await tempFile(data);
    const s = driver();
    const count = (p: string) => mock.requests.filter((r) => r.method === 'POST' && r.path.includes(p)).length;

    mock.failNext(2, { method: 'POST', pathIncludes: '/videos/retry1/', status: 503 });
    await s.putFile('videos/retry1/video.mp4', file, { contentType: 'video/mp4' });
    expect(count('/videos/retry1/')).toBe(3);
    expect(mock.object('media', 'videos/retry1/video.mp4')?.data.equals(data)).toBe(true);

    mock.failNext(1, { method: 'POST', pathIncludes: '/videos/retry2/', drop: true });
    mock.failNext(1, { method: 'POST', pathIncludes: '/videos/retry2/', status: 429, retryAfter: 0 });
    await s.putFile('videos/retry2/video.mp4', file, { contentType: 'video/mp4' });
    expect(count('/videos/retry2/')).toBe(3);
    expect(mock.object('media', 'videos/retry2/video.mp4')?.data.equals(data)).toBe(true);

    mock.failNext(10, { method: 'POST', pathIncludes: '/videos/retry3/', status: 500 });
    const err = await driver({ maxAttempts: 3 })
      .putFile('videos/retry3/video.mp4', file, { contentType: 'video/mp4' })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(StorageRequestError);
    expect((err as StorageRequestError).status).toBe(500);
    expect(count('/videos/retry3/')).toBe(3);
    expect((err as Error).message).not.toContain(mock.serviceKey);
    mock.failNext(0);

    await driver({}, mock.anonKey).putFile('videos/retry4/video.mp4', file, { contentType: 'video/mp4' }).catch(() => undefined);
    expect(count('/videos/retry4/')).toBe(1);
  });
});

describe('staged video sources (remote driver + local disk)', () => {
  it('keeps video sources local and sends every other key to the remote store', async () => {
    const root = path.join(tmp, 'staged');
    const local = new LocalStorage(root);
    const remote = driver();
    const staged = new StagedSourceStorage(remote, local, true);
    expect(staged).toMatchObject({ kind: 'supabase', publicOrigin: mock.url, localMediaDir: root });

    const posts = () => mock.requests.filter((r) => r.method === 'POST' && r.path.includes('/videos/s1/')).length;
    await staged.putFile('videos/s1/source.mov', await tempFile('original'), { contentType: 'video/quicktime', move: true });
    expect(await fs.readFile(path.join(root, 'videos/s1/source.mov'), 'utf8')).toBe('original');
    expect(mock.object('media', 'videos/s1/source.mov')).toBeUndefined();
    expect(posts()).toBe(0);
    expect(staged.url('videos/s1/source.mov')).toBe('/media/videos/s1/source.mov');
    expect(await staged.exists('videos/s1/source.mov')).toBe(true);
    expect((await staged.getLocalFile('videos/s1/source.mov', tmp)).path).toBe(path.join(root, 'videos/s1/source.mov'));

    await staged.putFile('videos/s1/video.mp4', await tempFile('processed'), { contentType: 'video/mp4' });
    await staged.putFile('images/2026/10/cover.webp', await tempFile('img'), { contentType: 'image/webp' });
    expect(mock.object('media', 'videos/s1/video.mp4')?.data.toString()).toBe('processed');
    expect(mock.object('media', 'images/2026/10/cover.webp')).toBeDefined();
    expect(existsSync(path.join(root, 'videos/s1/video.mp4'))).toBe(false);
    expect(staged.url('videos/s1/video.mp4')).toBe(mock.publicUrl('media', 'videos/s1/video.mp4'));

    // Sources that already live in the bucket (uploaded by a server without ffmpeg) still work.
    mock.putObject('media', 'videos/s2/source.mp4', 'legacy', 'video/mp4');
    expect(staged.url('videos/s2/source.mp4')).toBe(mock.publicUrl('media', 'videos/s2/source.mp4'));
    expect(await staged.exists('videos/s2/source.mp4')).toBe(true);
    const legacy = await staged.getLocalFile('videos/s2/source.mp4', path.join(tmp, 'dl2'));
    expect(await fs.readFile(legacy.path, 'utf8')).toBe('legacy');
    await legacy.cleanup();

    // delete(source) only touches the disk when the file is there.
    const deletesBefore = mock.requests.filter((r) => r.method === 'DELETE').length;
    await staged.delete('videos/s1/source.mov');
    expect(existsSync(path.join(root, 'videos/s1/source.mov'))).toBe(false);
    expect(mock.requests.filter((r) => r.method === 'DELETE').length).toBe(deletesBefore);

    await staged.putFile('videos/s1/source.mov', await tempFile('again'), { contentType: 'video/quicktime' });
    await staged.deletePrefix('videos/s1/');
    expect(existsSync(path.join(root, 'videos/s1'))).toBe(false);
    expect(mock.keys('media').filter((k) => k.startsWith('videos/s1/'))).toEqual([]);
  });

  it('without ffmpeg (no staging) sources go to the remote store', async () => {
    const staged = new StagedSourceStorage(driver(), new LocalStorage(path.join(tmp, 'unstaged')), false);
    await staged.putFile('videos/s3/source.mp4', await tempFile('as-is'), { contentType: 'video/mp4' });
    expect(mock.object('media', 'videos/s3/source.mp4')?.data.toString()).toBe('as-is');
    expect(staged.url('videos/s3/source.mp4')).toBe(mock.publicUrl('media', 'videos/s3/source.mp4'));
  });
});

/* ───────────── end to end through the HTTP API ───────────── */

async function waitIdle(t: TestApp): Promise<void> {
  await t.ctx.queue.onIdle();
}

describe('STORAGE_DRIVER=supabase end to end (ffmpeg)', () => {
  let e2e: MockSupabase;
  let t: TestApp;
  let cookie: string;
  let placeId: string;
  let tinyMp4: Buffer;

  beforeAll(async () => {
    e2e = await startMockSupabase();
    t = await createTestApp({ env: { STORAGE_DRIVER: 'supabase', SUPABASE_URL: e2e.url, SUPABASE_SERVICE_ROLE_KEY: e2e.serviceKey } });
    cookie = await login(t.app);
    placeId = (await createPlace(t.app, cookie, { name: 'Supabase Lab' })).id;
    tinyMp4 = await fs.readFile(path.join(fixtures, 'tiny.mp4'));
  });
  afterAll(async () => {
    await t?.close();
    await e2e?.close();
  });

  it('creates the public bucket at boot and allows its origin in the CSP', async () => {
    expect(t.ctx.storage.kind).toBe('supabase');
    expect(e2e.buckets.get('media')).toMatchObject({ public: true });
    const res = await t.app.inject({ method: 'GET', url: '/api/health' });
    const csp = String(res.headers['content-security-policy']);
    expect(csp).toContain(`img-src 'self' data: blob: ${e2e.url}`);
    expect(csp).toContain(`media-src 'self' blob: ${e2e.url}`);
  });

  it('chunked upload → ffmpeg → READY: the source stayed on this server, the outputs are in the bucket', async () => {
    const uploaded = await uploadVideo(t.app, cookie, placeId, tinyMp4, 'clip.mp4', 'video/mp4', 3);
    const id = uploaded.id;
    expect(uploaded.status).toBe('PROCESSING');
    expect(uploaded.url).toMatch(new RegExp(`^/media/videos/${id}/source\\.mp4\\?v=`));
    await waitIdle(t);

    const res = await t.app.inject({ method: 'GET', url: `/api/admin/videos/${id}`, headers: { cookie } });
    const ready = res.json() as AdminVideo;
    expect(ready.status).toBe('READY');
    const base = escapeRe(`${e2e.url}/storage/v1/object/public/media/videos/${id}/`);
    expect(ready.url).toMatch(new RegExp(`^${base}video\\.mp4\\?v=[0-9a-z]+$`));
    expect(ready.previewUrl).toMatch(new RegExp(`^${base}preview\\.mp4\\?v=[0-9a-z]+$`));
    expect(ready.posterUrl).toMatch(new RegExp(`^${base}poster\\.jpg\\?v=[0-9a-z]+$`));

    expect(e2e.keys('media').filter((k) => k.startsWith(`videos/${id}/`))).toEqual([
      `videos/${id}/poster.jpg`,
      `videos/${id}/preview.mp4`,
      `videos/${id}/video.mp4`,
    ]);
    expect(e2e.object('media', `videos/${id}/video.mp4`)).toMatchObject({ contentType: 'video/mp4', cacheControl: 'max-age=31536000' });
    // The original never left the server, and it is gone now that the video is processed.
    expect(e2e.requests.some((r) => r.path.includes('/source.'))).toBe(false);
    expect(existsSync(path.join(t.storageDir, 'videos', id, 'source.mp4'))).toBe(false);
    expect(await fs.readdir(t.ctx.paths.uploads)).toEqual([]);

    const media = await fetch(ready.url!, { headers: { range: 'bytes=0-99' } });
    expect(media.status).toBe(206);
    expect(media.headers.get('content-type')).toBe('video/mp4');
    expect((await media.arrayBuffer()).byteLength).toBe(100);

    // Public API serves the same absolute URLs.
    await t.app.inject({ method: 'PATCH', url: `/api/admin/places/${placeId}`, headers: admin(cookie), payload: { published: true } });
    await t.app.inject({ method: 'PATCH', url: `/api/admin/videos/${id}`, headers: admin(cookie), payload: { published: true } });
    const pub = await t.app.inject({ method: 'GET', url: '/api/public/home' });
    expect(pub.body).toContain(`${e2e.url}/storage/v1/object/public/media/videos/${id}/video.mp4`);

    const del = await t.app.inject({ method: 'DELETE', url: `/api/admin/videos/${id}`, headers: admin(cookie) });
    expect(del.statusCode).toBe(204);
    expect(e2e.keys('media').filter((k) => k.startsWith(`videos/${id}/`))).toEqual([]);
    expect(existsSync(path.join(t.storageDir, 'videos', id))).toBe(false);
  });

  it('a FAILED video keeps its source on this server, served from /media, and deleting removes it', async () => {
    const broken = tinyMp4.subarray(0, 1500); // valid container header, truncated body → probe fails
    const uploaded = await uploadVideo(t.app, cookie, placeId, broken, 'broken.mp4', 'video/mp4', 1);
    await waitIdle(t);
    const failed = (await t.app.inject({ method: 'GET', url: `/api/admin/videos/${uploaded.id}`, headers: { cookie } })).json() as AdminVideo;
    expect(failed.status).toBe('FAILED');
    expect(failed.url).toMatch(new RegExp(`^/media/videos/${uploaded.id}/source\\.mp4\\?v=`));
    const served = await t.app.inject({ method: 'GET', url: `/media/videos/${uploaded.id}/source.mp4` });
    expect(served.statusCode).toBe(200);
    expect(served.headers['content-type']).toBe('video/mp4');
    expect(served.rawPayload.length).toBe(broken.length);

    await t.app.inject({ method: 'DELETE', url: `/api/admin/videos/${uploaded.id}`, headers: admin(cookie) });
    expect(existsSync(path.join(t.storageDir, 'videos', uploaded.id))).toBe(false);
  });

  it('a stream-copied (remux) output over the per-file limit is re-encoded smaller instead of failing', async () => {
    const file = path.join(tmp, 'high-bitrate.mp4');
    execFileSync('ffmpeg', [
      '-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=240x426:rate=24', '-t', '2',
      '-c:v', 'libx264', '-preset', 'ultrafast', '-b:v', '8M', '-minrate', '8M', '-maxrate', '8M', '-bufsize', '1M',
      '-pix_fmt', 'yuv420p', file,
    ]);
    const bytes = await fs.readFile(file);
    expect(bytes.length).toBeGreaterThan(400_000);
    e2e.maxObjectBytes = 300_000;
    try {
      const video = await uploadVideo(t.app, cookie, placeId, bytes, 'phone.mp4', 'video/mp4', 2);
      await waitIdle(t);
      const row = await t.ctx.prisma.video.findUniqueOrThrow({ where: { id: video.id } });
      expect(row.processingError).toBeNull();
      expect(row.status).toBe('READY');
      const stored = e2e.object('media', `videos/${video.id}/video.mp4`);
      expect(stored?.data.length).toBeLessThanOrEqual(300_000);
    } finally {
      e2e.maxObjectBytes = 50 * 1024 * 1024;
    }
  });

  it('images go to the bucket; files over the plan limit fail with clear Arabic messages', async () => {
    const png = await fs.readFile(path.join(fixtures, 'image.png'));
    const form = multipartBody('file', 'cover.png', 'image/png', png);
    const res = await t.app.inject({ method: 'POST', url: '/api/admin/uploads/image', headers: { ...admin(cookie), ...form.headers }, payload: form.payload });
    expect(res.statusCode).toBe(201);
    const image = res.json() as UploadedImage;
    expect(image.url).toBe(`${e2e.url}/storage/v1/object/public/media/${image.key}`);
    expect(e2e.object('media', image.key)?.contentType).toBe('image/webp');

    e2e.maxObjectBytes = 2000;
    try {
      const big = await t.app.inject({ method: 'POST', url: '/api/admin/uploads/image', headers: { ...admin(cookie), ...form.headers }, payload: form.payload });
      expect(big.statusCode).toBe(413);
      expect(big.json() as ApiErrorBody).toEqual({ error: { code: 'PAYLOAD_TOO_LARGE', message: STORAGE_MESSAGES.imageTooLarge } });

      const video = await uploadVideo(t.app, cookie, placeId, tinyMp4, 'big.mp4', 'video/mp4', 2);
      await waitIdle(t);
      const row = await t.ctx.prisma.video.findUniqueOrThrow({ where: { id: video.id } });
      expect(row.status).toBe('FAILED');
      expect(row.processingError).toBe(STORAGE_TOO_LARGE_MESSAGE);
      // The source is still on this server, so "reprocess" works once the limit allows it.
      expect(existsSync(path.join(t.storageDir, 'videos', video.id, 'source.mp4'))).toBe(true);
      e2e.maxObjectBytes = 50 * 1024 * 1024;
      const again = await t.app.inject({ method: 'POST', url: `/api/admin/videos/${video.id}/reprocess`, headers: admin(cookie) });
      expect(again.statusCode).toBe(200);
      await waitIdle(t);
      expect((await t.ctx.prisma.video.findUniqueOrThrow({ where: { id: video.id } })).status).toBe('READY');
    } finally {
      e2e.maxObjectBytes = 50 * 1024 * 1024;
    }
  });
});

describe('STORAGE_DRIVER=supabase without ffmpeg', () => {
  let e2e: MockSupabase;
  let t: TestApp;
  let cookie: string;
  let placeId: string;

  beforeAll(async () => {
    e2e = await startMockSupabase({ tooLargeStatus: 400 });
    t = await createTestApp({ tools: NO_FFMPEG, env: { SUPABASE_URL: e2e.url, SUPABASE_SECRET_KEY: e2e.secretKey, SUPABASE_STORAGE_BUCKET: 'portfolio' } });
    cookie = await login(t.app);
    placeId = (await createPlace(t.app, cookie, { name: 'No ffmpeg Lab' })).id;
  });
  afterAll(async () => {
    await t?.close();
    await e2e?.close();
  });

  it('auto-detects Supabase, uploads sources as-is, and turns the plan limit into a 413 + FAILED', async () => {
    expect(t.config.storage.driver).toBe('supabase');
    expect(e2e.buckets.get('portfolio')?.public).toBe(true);
    const tiny = await fs.readFile(path.join(fixtures, 'tiny.mp4'));
    const video = await uploadVideo(t.app, cookie, placeId, tiny, 'clip.mp4', 'video/mp4', 2);
    expect(video.status).toBe('READY');
    expect(video.url).toMatch(new RegExp(`^${escapeRe(`${e2e.url}/storage/v1/object/public/portfolio/videos/${video.id}/source.mp4`)}\\?v=`));
    expect(e2e.object('portfolio', `videos/${video.id}/source.mp4`)?.data.equals(tiny)).toBe(true);

    e2e.maxObjectBytes = 1000;
    const init = await t.app.inject({
      method: 'POST',
      url: '/api/admin/videos/uploads',
      headers: admin(cookie),
      payload: { placeId, fileName: 'huge.mp4', size: tiny.length, mimeType: 'video/mp4' },
    });
    const { videoId } = init.json() as { videoId: string };
    await t.app.inject({
      method: 'PATCH',
      url: `/api/admin/videos/${videoId}/upload`,
      headers: { ...admin(cookie), 'content-type': 'application/octet-stream', 'upload-offset': '0' },
      payload: tiny,
    });
    const done = await t.app.inject({ method: 'POST', url: `/api/admin/videos/${videoId}/upload/complete`, headers: admin(cookie), payload: {} });
    expect(done.statusCode).toBe(413);
    expect((done.json() as ApiErrorBody).error).toEqual({ code: 'PAYLOAD_TOO_LARGE', message: STORAGE_MESSAGES.fileTooLarge });
    const row = await t.ctx.prisma.video.findUniqueOrThrow({ where: { id: videoId } });
    expect(row).toMatchObject({ status: 'FAILED', processingError: STORAGE_MESSAGES.fileTooLarge });
    expect(existsSync(t.ctx.files.uploadTempPath(videoId))).toBe(false);
  });
});

describe('Supabase storage with a rejected key', () => {
  it('the site still starts; uploads fail with an actionable Arabic error (502)', async () => {
    const e2e = await startMockSupabase();
    // Not a recognisable key → config only warns; the mock rejects it like Supabase's gateway.
    const t = await createTestApp({ tools: NO_FFMPEG, env: { SUPABASE_URL: e2e.url, SUPABASE_SERVICE_ROLE_KEY: 'wrong-key-pasted-by-mistake' } });
    try {
      expect(t.config.warnings.join(' ')).toMatch(/does not look like a Supabase key/);
      const health = await t.app.inject({ method: 'GET', url: '/api/health' });
      expect(health.statusCode).toBe(200);
      const cookie = await login(t.app);
      const png = await fs.readFile(path.join(fixtures, 'image.png'));
      const form = multipartBody('file', 'cover.png', 'image/png', png);
      const res = await t.app.inject({ method: 'POST', url: '/api/admin/uploads/image', headers: { ...admin(cookie), ...form.headers }, payload: form.payload });
      expect(res.statusCode).toBe(502);
      expect((res.json() as ApiErrorBody).error).toEqual({ code: 'STORAGE_ERROR', message: STORAGE_MESSAGES.auth });
      expect(res.body).not.toContain('wrong-key-pasted-by-mistake');
    } finally {
      await t.close();
      await e2e.close();
    }
  });
});
