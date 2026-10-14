#!/usr/bin/env node
/**
 * End-to-end smoke test for a running S5Y server (Docker or `node dist/index.js`).
 * Uses only Node 22 built-ins + the `ffmpeg` binary (to make a tiny test image/video).
 *
 *   SMOKE_EMAIL=you@example.com SMOKE_PASSWORD='…' node deploy/smoke-test.mjs
 *
 * Env:
 *   SMOKE_BASE_URL   default http://localhost:4000
 *   SMOKE_ADMIN_PATH default /studio
 *   SMOKE_EMAIL / SMOKE_PASSWORD   owner account (required for the admin + upload checks)
 *   SMOKE_STATE      if set: keep the test place and write its media URLs to this JSON file
 *                    (then run again with `--recheck` to verify they survived a restart and clean up)
 *   SMOKE_TIMEOUT_S  max seconds to wait for health and for video processing (default 180)
 *   FFMPEG           ffmpeg binary (default ffmpeg)
 *
 * Creates an unpublished place called "smoke-test", uploads an image and a short iPhone-style HEVC .mov
 * in several small chunks, waits until it is READY, checks the media is served, then deletes the place.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const BASE = (process.env.SMOKE_BASE_URL ?? 'http://localhost:4000').replace(/\/+$/, '');
const ADMIN_PATH = (process.env.SMOKE_ADMIN_PATH ?? '/studio').replace(/\/+$/, '');
const EMAIL = process.env.SMOKE_EMAIL;
const PASSWORD = process.env.SMOKE_PASSWORD;
const STATE = process.env.SMOKE_STATE;
const TIMEOUT_MS = Number(process.env.SMOKE_TIMEOUT_S ?? 180) * 1000;
const FFMPEG = process.env.FFMPEG ?? 'ffmpeg';
const RECHECK = process.argv.includes('--recheck');

let failures = 0;
const ok = (msg) => console.log(`  ✔ ${msg}`);
const fail = (msg) => {
  failures++;
  console.error(`  ✖ ${msg}`);
};
const check = (cond, msg, detail = '') => (cond ? ok(msg) : fail(detail ? `${msg} — ${detail}` : msg));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let cookie = '';
async function api(method, url, { json, body, headers = {} } = {}) {
  const h = { ...headers };
  if (cookie) h.cookie = cookie;
  if (method !== 'GET' && method !== 'HEAD' && url.startsWith('/api/admin')) h['x-s5y-admin'] = '1';
  if (json !== undefined) h['content-type'] = 'application/json';
  const res = await fetch(BASE + url, { method, headers: h, body: json !== undefined ? JSON.stringify(json) : body, redirect: 'manual' });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { res, data, text };
}

async function waitForHealth() {
  const until = Date.now() + TIMEOUT_MS;
  let last = '';
  while (Date.now() < until) {
    try {
      const { res, data } = await api('GET', '/api/health');
      if (res.ok && data?.ok) return data;
      last = `HTTP ${res.status}`;
    } catch (err) {
      last = err.cause?.code ?? err.message;
    }
    await sleep(1000);
  }
  throw new Error(`server at ${BASE} not healthy after ${TIMEOUT_MS / 1000}s (${last})`);
}

async function login() {
  const { res, data } = await api('POST', '/api/admin/auth/login', { json: { email: EMAIL, password: PASSWORD } });
  const setCookie = res.headers.getSetCookie().find((c) => c.startsWith('s5y_sid='));
  check(res.status === 200 && data?.user?.email, 'admin login (X-S5Y-Admin header + session cookie)', `HTTP ${res.status} ${JSON.stringify(data)}`);
  if (!setCookie) throw new Error('login did not set the s5y_sid cookie');
  cookie = setCookie.split(';')[0];
}

async function fetchMedia(url, label, expectType) {
  const full = url.startsWith('http') ? url : BASE + url;
  const res = await fetch(full, { headers: { range: 'bytes=0-99' } });
  await res.arrayBuffer();
  const type = res.headers.get('content-type') ?? '';
  check([200, 206].includes(res.status) && type.startsWith(expectType), `${label} served (${res.status}, ${type})`, full);
}

async function publicChecks() {
  console.log('Public site');
  const home = await fetch(BASE + '/');
  const html = await home.text();
  check(home.status === 200 && html.includes('<title>') && html.includes('og:title'), 'GET / → site HTML with injected <title>/Open Graph tags');
  check(!html.includes('<!--s5y-head-->'), 'head placeholder replaced');
  check(!html.includes(ADMIN_PATH + '/') && !html.includes(`"${ADMIN_PATH}"`), 'site HTML does not mention the admin path');

  const robots = await (await fetch(BASE + '/robots.txt')).text();
  check(!robots.includes(ADMIN_PATH), 'robots.txt does not reveal the admin path');

  const { res, data } = await api('GET', '/api/public/home');
  check(res.status === 200 && data && typeof data === 'object' && 'site' in data, 'GET /api/public/home → JSON', `HTTP ${res.status}`);

  console.log('Admin dashboard');
  const adm = await fetch(BASE + ADMIN_PATH);
  const admHtml = await adm.text();
  check(adm.status === 200 && admHtml.includes(`<base href="${ADMIN_PATH}/">`), `GET ${ADMIN_PATH} → admin HTML with <base href>`);
  check(admHtml.includes('name="s5y-admin-base"'), 'admin base meta injected');
  check((adm.headers.get('x-robots-tag') ?? '').includes('noindex'), 'admin served with X-Robots-Tag: noindex');

  const noHeader = await fetch(BASE + '/api/admin/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'x@example.com', password: 'xxxxxxxxxxxx' }),
  });
  await noHeader.text();
  check(noHeader.status === 403, 'admin POST without X-S5Y-Admin is rejected (403)', `HTTP ${noHeader.status}`);
}

function makeMedia(dir) {
  const ff = (args) => execFileSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: 'pipe' });
  const image = path.join(dir, 'smoke.png');
  ff(['-f', 'lavfi', '-i', 'testsrc2=size=800x600', '-frames:v', '1', image]);
  // iPhone-style vertical HEVC in a .mov container (exercises the transcode path); fall back to H.264.
  let video = path.join(dir, 'smoke.mov');
  let mime = 'video/quicktime';
  const src = ['-f', 'lavfi', '-i', 'testsrc2=size=360x640:rate=30', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000', '-t', '4'];
  try {
    ff([...src, '-c:v', 'libx265', '-preset', 'ultrafast', '-x265-params', 'log-level=error', '-tag:v', 'hvc1', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', video]);
  } catch {
    video = path.join(dir, 'smoke.mp4');
    mime = 'video/mp4';
    ff([...src, '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', video]);
  }
  return { image, video, mime };
}

async function uploadChecks() {
  console.log('Uploads & processing');
  const dir = mkdtempSync(path.join(tmpdir(), 's5y-smoke-'));
  try {
    const media = makeMedia(dir);

    const place = await api('POST', '/api/admin/places', { json: { name: 'smoke-test', published: false } });
    check(place.res.status === 201 && place.data?.id, 'create place', `HTTP ${place.res.status} ${place.text.slice(0, 200)}`);
    const placeId = place.data.id;

    const form = new FormData();
    form.append('file', new Blob([readFileSync(media.image)], { type: 'image/png' }), 'smoke.png');
    const img = await api('POST', '/api/admin/uploads/image', { body: form });
    check(img.res.status === 201 && img.data?.url, 'image upload', `HTTP ${img.res.status} ${img.text.slice(0, 200)}`);
    if (img.data?.url) await fetchMedia(img.data.url, 'uploaded image', 'image/');
    // Use it as the place cover (so deleting the place also deletes the file).
    const cover = await api('PATCH', `/api/admin/places/${placeId}`, { json: { coverKey: img.data?.key } });
    check(cover.res.status === 200 && cover.data?.coverUrl, 'set place cover image', `HTTP ${cover.res.status} ${cover.text.slice(0, 200)}`);

    const bytes = readFileSync(media.video);
    const init = await api('POST', '/api/admin/videos/uploads', {
      json: { placeId, fileName: path.basename(media.video), size: bytes.length, mimeType: media.mime, title: 'smoke' },
    });
    check(init.res.status === 201 && init.data?.videoId, `start chunked upload (${media.mime}, ${bytes.length} bytes)`, `HTTP ${init.res.status} ${init.text.slice(0, 200)}`);
    const id = init.data.videoId;

    // Wrong offset → 409 with the server's offset (resume protocol).
    const bad = await api('PATCH', `/api/admin/videos/${id}/upload`, {
      body: bytes.subarray(0, 10),
      headers: { 'content-type': 'application/octet-stream', 'upload-offset': '5' },
    });
    check(bad.res.status === 409 && bad.data?.error?.details?.offset === 0, 'offset mismatch → 409 OFFSET_MISMATCH', `HTTP ${bad.res.status}`);

    const chunk = Math.min(init.data.chunkSize, Math.max(64 * 1024, Math.ceil(bytes.length / 4)));
    let offset = 0;
    let chunks = 0;
    while (offset < bytes.length) {
      const part = bytes.subarray(offset, offset + chunk);
      const r = await api('PATCH', `/api/admin/videos/${id}/upload`, {
        body: part,
        headers: { 'content-type': 'application/octet-stream', 'upload-offset': String(offset) },
      });
      if (r.res.status !== 200) throw new Error(`chunk at ${offset} failed: HTTP ${r.res.status} ${r.text.slice(0, 200)}`);
      offset = r.data.offset;
      chunks++;
    }
    const resume = await api('GET', `/api/admin/videos/${id}/upload`);
    check(resume.data?.offset === bytes.length, `uploaded in ${chunks} chunks, resume endpoint reports full offset`);

    const done = await api('POST', `/api/admin/videos/${id}/upload/complete`, { json: {} });
    check(done.res.status === 200 && ['PROCESSING', 'READY'].includes(done.data?.status), `complete → ${done.data?.status}`, `HTTP ${done.res.status} ${done.text.slice(0, 200)}`);

    const until = Date.now() + TIMEOUT_MS;
    let video = done.data;
    while (video?.status === 'PROCESSING' && Date.now() < until) {
      await sleep(1000);
      video = (await api('GET', `/api/admin/videos/${id}`)).data;
    }
    check(video?.status === 'READY', `video processed → ${video?.status}`, video?.processingError ?? 'timed out');
    if (video?.status === 'READY') {
      check(video.width > 0 && video.height > video.width && video.durationSec > 3, `metadata ${video.width}x${video.height}, ${video.durationSec}s`);
      await fetchMedia(video.url, 'video.mp4', 'video/mp4');
      if (video.previewUrl) await fetchMedia(video.previewUrl, 'preview.mp4', 'video/mp4');
      else fail('preview generated');
      if (video.posterUrl) await fetchMedia(video.posterUrl, 'poster', 'image/');
      else fail('poster generated');
    }

    if (STATE) {
      writeFileSync(STATE, JSON.stringify({ placeId, urls: [img.data?.url, video?.url, video?.previewUrl, video?.posterUrl].filter(Boolean) }, null, 2));
      ok(`kept test place; state written to ${STATE}`);
    } else {
      const del = await api('DELETE', `/api/admin/places/${placeId}`);
      check(del.res.status === 204, 'delete test place (and its files)');
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function recheck() {
  console.log('Re-check media after restart');
  const state = JSON.parse(readFileSync(STATE, 'utf8'));
  for (const url of state.urls) {
    const res = await fetch(url.startsWith('http') ? url : BASE + url);
    await res.arrayBuffer();
    check(res.status === 200, `still served: ${url}`, `HTTP ${res.status}`);
  }
  const del = await api('DELETE', `/api/admin/places/${state.placeId}`);
  check(del.res.status === 204, 'delete test place (and its files)');
}

try {
  console.log(`S5Y smoke test → ${BASE} (admin ${ADMIN_PATH})`);
  const health = await waitForHealth();
  check(health.db === true, `health: db=${health.db} ffmpeg=${health.ffmpeg} version=${health.version}`);
  if (!RECHECK) await publicChecks();
  if (!EMAIL || !PASSWORD) {
    console.log('  (SMOKE_EMAIL / SMOKE_PASSWORD not set — skipping admin & upload checks)');
  } else {
    await login();
    const me = await api('GET', '/api/admin/auth/me');
    check(me.res.status === 200 && me.data?.user, 'session works (GET /api/admin/auth/me)');
    if (RECHECK) {
      if (!STATE) throw new Error('--recheck needs SMOKE_STATE');
      await recheck();
    } else {
      check(health.ffmpeg === true, 'ffmpeg available to the server');
      await uploadChecks();
    }
  }
} catch (err) {
  fail(err instanceof Error ? err.message : String(err));
}

console.log(failures ? `\n✖ ${failures} check(s) failed` : '\n✔ all checks passed');
process.exit(failures ? 1 : 0);
