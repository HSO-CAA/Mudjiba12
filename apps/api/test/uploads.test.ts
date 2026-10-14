import fs from 'node:fs/promises';
import path from 'node:path';
import type { AdminPlace, AdminPlaceDetail, AdminVideo, AdminVideoWithPlace, ApiErrorBody, UploadedImage, VideoUploadSession } from '@s5y/shared';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { probe } from '../src/media/ffmpeg.js';
import { NO_FFMPEG, type TestApp, admin, createPlace, createTestApp, login, multipartBody, uploadVideo } from './helpers.js';

const fixtures = inject('fixturesDir');
let t: TestApp;
let cookie: string;
let place: AdminPlace;
let tinyMp4: Buffer;

beforeAll(async () => {
  t = await createTestApp();
  cookie = await login(t.app);
  place = await createPlace(t.app, cookie, { name: 'Upload Lab' });
  tinyMp4 = await fs.readFile(path.join(fixtures, 'tiny.mp4'));
});
afterAll(async () => {
  await t.close();
});

const patchChunk = (videoId: string, offset: number, chunk: Buffer, contentType = 'application/octet-stream') =>
  t.app.inject({
    method: 'PATCH',
    url: `/api/admin/videos/${videoId}/upload`,
    headers: { ...admin(cookie), 'content-type': contentType, 'upload-offset': String(offset) },
    payload: chunk,
  });

const initUpload = (payload: Record<string, unknown>) =>
  t.app.inject({ method: 'POST', url: '/api/admin/videos/uploads', headers: admin(cookie), payload });

describe('chunked resumable upload', () => {
  let session: VideoUploadSession;

  it('validates the init request', async () => {
    const bad = await initUpload({ placeId: place.id, fileName: 'notes.txt', size: 100, mimeType: 'text/plain' });
    expect(bad.statusCode).toBe(415);
    expect((bad.json() as ApiErrorBody).error.code).toBe('UNSUPPORTED_MEDIA_TYPE');
    const tooBig = await initUpload({ placeId: place.id, fileName: 'a.mp4', size: 3 * 1024 ** 3, mimeType: 'video/mp4' });
    expect(tooBig.statusCode).toBe(413);
    const noPlace = await initUpload({ placeId: 'cmissing0000000000000000', fileName: 'a.mp4', size: 10, mimeType: 'video/mp4' });
    expect(noPlace.statusCode).toBe(404);
    const zero = await initUpload({ placeId: place.id, fileName: 'a.mp4', size: 0, mimeType: 'video/mp4' });
    expect(zero.statusCode).toBe(400);
  });

  it('accepts by extension when the browser sends an empty MIME type', async () => {
    const res = await initUpload({ placeId: place.id, fileName: 'IMG_0001.MOV', size: tinyMp4.length, mimeType: '', title: 'Reel 1' });
    expect(res.statusCode).toBe(201);
    session = res.json() as VideoUploadSession;
    expect(session).toEqual({ videoId: expect.any(String), chunkSize: 8 * 1024 * 1024, offset: 0, size: tinyMp4.length });
    const video = await t.ctx.prisma.video.findUniqueOrThrow({ where: { id: session.videoId } });
    expect(video.status).toBe('UPLOADING');
    expect(video.mimeType).toBe('video/quicktime');
    expect(video.title).toBe('Reel 1');
  });

  it('enforces Upload-Offset, chunk bounds and content type', async () => {
    const id = session.videoId;
    const a = tinyMp4.subarray(0, 1000);

    const mismatch = await patchChunk(id, 500, a);
    expect(mismatch.statusCode).toBe(409);
    const body = mismatch.json() as ApiErrorBody;
    expect(body.error.code).toBe('OFFSET_MISMATCH');
    expect(body.error.details).toEqual({ offset: 0 });

    const missingHeader = await t.app.inject({
      method: 'PATCH',
      url: `/api/admin/videos/${id}/upload`,
      headers: { ...admin(cookie), 'content-type': 'application/octet-stream' },
      payload: a,
    });
    expect(missingHeader.statusCode).toBe(400);

    const json = await t.app.inject({
      method: 'PATCH',
      url: `/api/admin/videos/${id}/upload`,
      headers: { ...admin(cookie), 'upload-offset': '0' },
      payload: { not: 'bytes' },
    });
    expect(json.statusCode).toBe(415);

    const pastEnd = await patchChunk(id, 0, Buffer.concat([tinyMp4, Buffer.alloc(10)]));
    expect(pastEnd.statusCode).toBe(400);

    const ok = await patchChunk(id, 0, a);
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toEqual({ offset: 1000 });

    // A retried chunk (lost response) is detected and the client re-syncs.
    const retry = await patchChunk(id, 0, a);
    expect(retry.statusCode).toBe(409);
    expect((retry.json() as ApiErrorBody).error.details).toEqual({ offset: 1000 });
  });

  it('refuses to complete an incomplete upload and resumes from the server offset', async () => {
    const id = session.videoId;
    const early = await t.app.inject({ method: 'POST', url: `/api/admin/videos/${id}/upload/complete`, headers: admin(cookie), payload: {} });
    expect(early.statusCode).toBe(409);
    expect((early.json() as ApiErrorBody).error.details).toMatchObject({ offset: 1000 });

    const resume = await t.app.inject({ method: 'GET', url: `/api/admin/videos/${id}/upload`, headers: { cookie } });
    expect(resume.statusCode).toBe(200);
    const state = resume.json() as VideoUploadSession;
    expect(state.offset).toBe(1000);

    const rest = await patchChunk(id, state.offset, tinyMp4.subarray(state.offset));
    expect(rest.json()).toEqual({ offset: tinyMp4.length });
    const stored = await t.ctx.prisma.video.findUniqueOrThrow({ where: { id } });
    expect(Number(stored.uploadedBytes)).toBe(tinyMp4.length);
  });

  it('completes → PROCESSING → READY with video, preview and poster', async () => {
    const id = session.videoId;
    const done = await t.app.inject({
      method: 'POST',
      url: `/api/admin/videos/${id}/upload/complete`,
      headers: admin(cookie),
      payload: { durationSec: 2, width: 180, height: 320 },
    });
    expect(done.statusCode).toBe(200);
    const processing = done.json() as AdminVideo;
    expect(processing.status).toBe('PROCESSING');
    expect(processing.url).toBe(`/media/videos/${id}/source.mov`);

    // Completing twice is idempotent.
    const again = await t.app.inject({ method: 'POST', url: `/api/admin/videos/${id}/upload/complete`, headers: admin(cookie) });
    expect(again.statusCode).toBe(200);

    await t.ctx.queue.onIdle();
    const res = await t.app.inject({ method: 'GET', url: `/api/admin/videos/${id}`, headers: { cookie } });
    const ready = res.json() as AdminVideo;
    expect(ready.status).toBe('READY');
    expect(ready.processingError).toBeNull();
    expect(ready.url).toBe(`/media/videos/${id}/video.mp4`);
    expect(ready.previewUrl).toBe(`/media/videos/${id}/preview.mp4`);
    expect(ready.posterUrl).toBe(`/media/videos/${id}/poster.jpg`);
    expect(ready.posterKey).toBe(`videos/${id}/poster.jpg`);
    expect(ready.width).toBe(180);
    expect(ready.height).toBe(320);
    expect(ready.durationSec).toBeGreaterThan(1.5);

    const dir = path.join(t.storageDir, 'videos', id);
    expect((await fs.readdir(dir)).sort()).toEqual(['poster.jpg', 'preview.mp4', 'video.mp4']); // source removed
    const preview = await probe(t.ctx.tools, path.join(dir, 'preview.mp4'));
    expect(preview.audio).toBeNull();
    expect(Math.min(preview.video!.width, preview.video!.height)).toBeLessThanOrEqual(360);
    expect(await fs.readdir(t.ctx.paths.uploads)).toEqual([]);

    const list = await t.app.inject({ method: 'GET', url: `/api/admin/videos?placeId=${place.id}&status=READY`, headers: { cookie } });
    const rows = list.json() as AdminVideoWithPlace[];
    expect(rows.map((r) => r.id)).toEqual([id]);
    expect(rows[0]).toMatchObject({ placeName: 'Upload Lab', placeSlug: place.slug, sizeBytes: tinyMp4.length });
  });

  it('serves media with Range (206), ETag and immutable caching', async () => {
    const id = session.videoId;
    const url = `/media/videos/${id}/video.mp4`;
    const full = await t.app.inject({ method: 'GET', url });
    expect(full.statusCode).toBe(200);
    expect(full.headers['content-type']).toBe('video/mp4');
    expect(full.headers['accept-ranges']).toBe('bytes');
    expect(full.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    expect(full.headers['cross-origin-resource-policy']).toBe('same-site');
    const etag = full.headers.etag as string;
    expect(etag).toBeTruthy();

    const partial = await t.app.inject({ method: 'GET', url, headers: { range: 'bytes=0-99' } });
    expect(partial.statusCode).toBe(206);
    expect(partial.headers['content-range']).toMatch(/^bytes 0-99\/\d+$/);
    expect(partial.rawPayload.length).toBe(100);

    const cached = await t.app.inject({ method: 'GET', url, headers: { 'if-none-match': etag } });
    expect(cached.statusCode).toBe(304);

    const poster = await t.app.inject({ method: 'GET', url: `/media/videos/${id}/poster.jpg` });
    expect(poster.headers['content-type']).toBe('image/jpeg');
  });

  it('never serves temp uploads, dotfiles or paths outside the storage root', async () => {
    const pending = await initUpload({ placeId: place.id, fileName: 'x.mp4', size: 10, mimeType: 'video/mp4' });
    const { videoId } = pending.json() as VideoUploadSession;
    for (const url of [
      `/media/.uploads/${videoId}`,
      '/media/../package.json',
      '/media/%2e%2e/package.json',
      '/media/videos/../../package.json',
      '/media/package.json',
    ]) {
      const res = await t.app.inject({ method: 'GET', url });
      expect([403, 404], url).toContain(res.statusCode);
      expect(res.body).not.toContain('"name": "@s5y/api"');
    }
    await t.app.inject({ method: 'DELETE', url: `/api/admin/videos/${videoId}`, headers: admin(cookie) });
  });

  it('transcodes non-H.264 sources (WebM/VP9) to MP4', async () => {
    const webm = await fs.readFile(path.join(fixtures, 'tiny.webm'));
    const video = await uploadVideo(t.app, cookie, place.id, webm, 'clip.webm', 'video/webm', 3);
    expect(video.status).toBe('PROCESSING');
    await t.ctx.queue.onIdle();
    const ready = await t.ctx.prisma.video.findUniqueOrThrow({ where: { id: video.id } });
    expect(ready.status).toBe('READY');
    expect(ready.fileKey).toBe(`videos/${video.id}/video.mp4`);
    const info = await probe(t.ctx.tools, path.join(t.storageDir, ready.fileKey!));
    expect(info.video?.codec).toBe('h264');
    expect(info.video?.pixFmt).toBe('yuv420p');
  });

  it('bakes rotation metadata into the pixels (portrait output, no display matrix)', async () => {
    const rotated = await fs.readFile(path.join(fixtures, 'rotated.mp4'));
    const video = await uploadVideo(t.app, cookie, place.id, rotated, 'android.mp4');
    await t.ctx.queue.onIdle();
    const ready = await t.ctx.prisma.video.findUniqueOrThrow({ where: { id: video.id } });
    expect(ready).toMatchObject({ status: 'READY', width: 180, height: 320 });
    const info = await probe(t.ctx.tools, path.join(t.storageDir, ready.fileKey!));
    expect(info.video).toMatchObject({ rotation: 0, width: 180, height: 320 });
  });

  it('marks broken files FAILED with a readable reason and supports reprocess', async () => {
    const junk = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypmp42'), Buffer.alloc(4000, 7)]);
    const video = await uploadVideo(t.app, cookie, place.id, junk, 'broken.mp4');
    await t.ctx.queue.onIdle();
    const failed = (await t.app.inject({ method: 'GET', url: `/api/admin/videos/${video.id}`, headers: { cookie } })).json() as AdminVideo;
    expect(failed.status).toBe('FAILED');
    expect(failed.processingError).toMatch(/[؀-ۿ]/);

    const again = await t.app.inject({ method: 'POST', url: `/api/admin/videos/${video.id}/reprocess`, headers: admin(cookie) });
    expect(again.statusCode).toBe(200);
    expect((again.json() as AdminVideo).status).toBe('PROCESSING');
    await t.ctx.queue.onIdle();
    expect((await t.ctx.prisma.video.findUniqueOrThrow({ where: { id: video.id } })).status).toBe('FAILED');
  });

  it('rejects files that are not video containers at completion', async () => {
    const text = Buffer.from('this is definitely not a video file, just text '.repeat(10));
    const init = await initUpload({ placeId: place.id, fileName: 'fake.mp4', size: text.length, mimeType: 'video/mp4' });
    const { videoId } = init.json() as VideoUploadSession;
    await patchChunk(videoId, 0, text);
    const done = await t.app.inject({ method: 'POST', url: `/api/admin/videos/${videoId}/upload/complete`, headers: admin(cookie), payload: {} });
    expect(done.statusCode).toBe(415);
    expect((await t.ctx.prisma.video.findUniqueOrThrow({ where: { id: videoId } })).status).toBe('FAILED');
  });

  it('updates, reorders, moves and deletes videos (files included)', async () => {
    const detail = (await t.app.inject({ method: 'GET', url: `/api/admin/places/${place.id}`, headers: { cookie } })).json() as AdminPlaceDetail;
    expect(detail.videos.length).toBeGreaterThanOrEqual(3);
    expect(detail.videoCount).toBe(detail.videos.length);
    expect(detail.thumbUrl).toMatch(/poster\.jpg$/);
    const ids = detail.videos.map((v) => v.id);

    const reordered = [...ids].reverse();
    const order = await t.app.inject({ method: 'PUT', url: `/api/admin/places/${place.id}/videos/order`, headers: admin(cookie), payload: { ids: reordered } });
    expect(order.statusCode).toBe(204);
    const after = (await t.app.inject({ method: 'GET', url: `/api/admin/places/${place.id}`, headers: { cookie } })).json() as AdminPlaceDetail;
    expect(after.videos.map((v) => v.id)).toEqual(reordered);

    const target = ids[0]!;
    const patch = await t.app.inject({
      method: 'PATCH',
      url: `/api/admin/videos/${target}`,
      headers: admin(cookie),
      payload: { title: '  ريل الافتتاح ', featured: true, published: false, posterKey: 'images/../../x.jpg' },
    });
    expect(patch.statusCode).toBe(400);
    const ok = await t.app.inject({
      method: 'PATCH',
      url: `/api/admin/videos/${target}`,
      headers: admin(cookie),
      payload: { title: '  ريل الافتتاح ', featured: true, published: false },
    });
    expect(ok.json()).toMatchObject({ title: 'ريل الافتتاح', featured: true, published: false });

    const other = await createPlace(t.app, cookie, { name: 'Second Place' });
    const moved = await t.app.inject({ method: 'PATCH', url: `/api/admin/videos/${target}`, headers: admin(cookie), payload: { placeId: other.id } });
    expect((moved.json() as AdminVideo).placeId).toBe(other.id);

    const del = await t.app.inject({ method: 'DELETE', url: `/api/admin/videos/${target}`, headers: admin(cookie) });
    expect(del.statusCode).toBe(204);
    await expect(fs.access(path.join(t.storageDir, 'videos', target))).rejects.toThrow();
    expect((await t.app.inject({ method: 'GET', url: `/api/admin/videos/${target}`, headers: { cookie } })).statusCode).toBe(404);
  });

  it('deleting a place removes its videos and files', async () => {
    const lab = await createPlace(t.app, cookie, { name: 'Temp Place' });
    const video = await uploadVideo(t.app, cookie, lab.id, tinyMp4);
    await t.ctx.queue.onIdle();
    const res = await t.app.inject({ method: 'DELETE', url: `/api/admin/places/${lab.id}`, headers: admin(cookie) });
    expect(res.statusCode).toBe(204);
    expect(await t.ctx.prisma.video.findUnique({ where: { id: video.id } })).toBeNull();
    await expect(fs.access(path.join(t.storageDir, 'videos', video.id))).rejects.toThrow();
  });
});

describe('image uploads', () => {
  it('re-encodes images to WebP and reports dimensions', async () => {
    const png = await fs.readFile(path.join(fixtures, 'image.png'));
    const { payload, headers } = multipartBody('file', 'cover.png', 'application/octet-stream', png);
    const res = await t.app.inject({ method: 'POST', url: '/api/admin/uploads/image', headers: { ...admin(cookie), ...headers }, payload });
    expect(res.statusCode).toBe(201);
    const image = res.json() as UploadedImage;
    expect(image.key).toMatch(/^images\/\d{4}\/\d{2}\/[a-z0-9]{20}\.webp$/);
    expect(image.url).toBe(`/media/${image.key}`);
    expect(image).toMatchObject({ width: 640, height: 400 });
    const file = await fs.readFile(path.join(t.storageDir, image.key));
    expect(file.subarray(8, 12).toString('latin1')).toBe('WEBP');
    const served = await t.app.inject({ method: 'GET', url: image.url });
    expect(served.headers['content-type']).toBe('image/webp');
  });

  it('sniffs magic bytes instead of trusting the declared type', async () => {
    const { payload, headers } = multipartBody('file', 'evil.png', 'image/png', Buffer.from('<script>alert(1)</script>'.repeat(4)));
    const res = await t.app.inject({ method: 'POST', url: '/api/admin/uploads/image', headers: { ...admin(cookie), ...headers }, payload });
    expect(res.statusCode).toBe(415);
    expect((res.json() as ApiErrorBody).error.code).toBe('UNSUPPORTED_MEDIA_TYPE');
  });

  it('rejects oversized files and wrong field names', async () => {
    const big = multipartBody('file', 'big.png', 'image/png', Buffer.alloc(15 * 1024 * 1024 + 10));
    const tooBig = await t.app.inject({ method: 'POST', url: '/api/admin/uploads/image', headers: { ...admin(cookie), ...big.headers }, payload: big.payload });
    expect(tooBig.statusCode).toBe(413);
    expect((tooBig.json() as ApiErrorBody).error.code).toBe('PAYLOAD_TOO_LARGE');
    const png = await fs.readFile(path.join(fixtures, 'image.png'));
    const wrong = multipartBody('image', 'a.png', 'image/png', png);
    const res = await t.app.inject({ method: 'POST', url: '/api/admin/uploads/image', headers: { ...admin(cookie), ...wrong.headers }, payload: wrong.payload });
    expect(res.statusCode).toBe(400);
  });

  it('replacing a cover deletes the old image file', async () => {
    const png = await fs.readFile(path.join(fixtures, 'image.png'));
    const upload = async () => {
      const { payload, headers } = multipartBody('file', 'c.png', 'image/png', png);
      const res = await t.app.inject({ method: 'POST', url: '/api/admin/uploads/image', headers: { ...admin(cookie), ...headers }, payload });
      return res.json() as UploadedImage;
    };
    const one = await upload();
    const two = await upload();
    const p = await createPlace(t.app, cookie, { name: 'Cover Swap', coverKey: one.key });
    expect(p.coverUrl).toBe(one.url);
    const res = await t.app.inject({ method: 'PATCH', url: `/api/admin/places/${p.id}`, headers: admin(cookie), payload: { coverKey: two.key } });
    expect((res.json() as AdminPlace).coverKey).toBe(two.key);
    await expect(fs.access(path.join(t.storageDir, one.key))).rejects.toThrow();
    await fs.access(path.join(t.storageDir, two.key));
  });
});

describe('without ffmpeg', () => {
  it('marks uploads READY immediately using the source file and client metadata', async () => {
    const bare = await createTestApp({ tools: NO_FFMPEG });
    try {
      const c = await login(bare.app);
      const p = await createPlace(bare.app, c, { name: 'No FFmpeg' });
      const init = await bare.app.inject({
        method: 'POST',
        url: '/api/admin/videos/uploads',
        headers: admin(c),
        payload: { placeId: p.id, fileName: 'clip.mp4', size: tinyMp4.length, mimeType: 'video/mp4' },
      });
      const { videoId } = init.json() as VideoUploadSession;
      await bare.app.inject({
        method: 'PATCH',
        url: `/api/admin/videos/${videoId}/upload`,
        headers: { ...admin(c), 'content-type': 'application/octet-stream', 'upload-offset': '0' },
        payload: tinyMp4,
      });
      const done = await bare.app.inject({
        method: 'POST',
        url: `/api/admin/videos/${videoId}/upload/complete`,
        headers: admin(c),
        payload: { durationSec: 2, width: 180, height: 320 },
      });
      const video = done.json() as AdminVideo;
      expect(video).toMatchObject({ status: 'READY', width: 180, height: 320, durationSec: 2, previewUrl: null });
      expect(video.url).toBe(`/media/videos/${videoId}/source.mp4`);
      const overview = await bare.app.inject({ method: 'GET', url: '/api/admin/overview', headers: { cookie: c } });
      expect(overview.json()).toMatchObject({ mediaProcessing: false });
      const reprocess = await bare.app.inject({ method: 'POST', url: `/api/admin/videos/${videoId}/reprocess`, headers: admin(c) });
      expect(reprocess.statusCode).toBe(409);

      // Images are stored as-is (original format) with header dimensions.
      const png = await fs.readFile(path.join(fixtures, 'image.png'));
      const { payload, headers } = multipartBody('file', 'cover.png', 'image/png', png);
      const img = await bare.app.inject({ method: 'POST', url: '/api/admin/uploads/image', headers: { ...admin(c), ...headers }, payload });
      expect(img.json()).toMatchObject({ width: 640, height: 400, key: expect.stringMatching(/\.png$/) });
    } finally {
      await bare.close();
    }
  });
});
