import { randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { AdminPlace, AdminVideo, VideoUploadSession } from '@s5y/shared';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { buildApp } from '../src/app.js';
import { type Config, loadConfig } from '../src/config.js';
import type { AppContext } from '../src/context.js';
import type { MediaTools } from '../src/media/ffmpeg.js';
import { TEST_DATABASE_URL } from './env.js';

export const OWNER = { email: 'owner@s5y.test', password: 'Owner-Password-2026', name: 'S5Y Test' };

export interface TestApp {
  app: FastifyInstance;
  ctx: AppContext;
  config: Config;
  storageDir: string;
  close(): Promise<void>;
}

export interface TestAppOptions {
  env?: Record<string, string>;
  tools?: MediaTools;
}

export const NO_FFMPEG: MediaTools = {
  available: false,
  ffmpeg: 'ffmpeg-missing',
  ffprobe: 'ffprobe-missing',
  version: null,
  webp: false,
  tonemap: false,
};

export async function createTestApp(options: TestAppOptions = {}): Promise<TestApp> {
  const storageDir = await fs.mkdtemp(path.join(os.tmpdir(), 's5y-api-storage-'));
  const config = loadConfig({
    NODE_ENV: 'test',
    DATABASE_URL: TEST_DATABASE_URL,
    PUBLIC_URL: 'https://s5y.example',
    ADMIN_PATH: '/studio',
    ADMIN_EMAIL: OWNER.email,
    ADMIN_PASSWORD: OWNER.password,
    ADMIN_NAME: OWNER.name,
    COOKIE_SECURE: 'false',
    STORAGE_DIR: storageDir,
    WEB_DIST: path.join(storageDir, 'no-web-dist'),
    ADMIN_DIST: path.join(storageDir, 'no-admin-dist'),
    LOG_LEVEL: 'silent',
    ...options.env,
  });
  const app = await buildApp({ config, logger: false, tools: options.tools, maintenanceIntervalMs: 0 });
  await app.ready();
  return {
    app,
    ctx: app.ctx,
    config,
    storageDir,
    async close() {
      await app.close();
      await fs.rm(storageDir, { recursive: true, force: true });
    },
  };
}

/** A fresh client IP per call keeps per-IP rate limits out of the way of unrelated tests. */
export const randomIp = (): string => `10.${randomBytes(1)[0]}.${randomBytes(1)[0]}.${(randomBytes(1)[0] ?? 0) % 250 + 1}`;

export async function login(app: FastifyInstance, credentials = OWNER): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/admin/auth/login',
    headers: { 'x-s5y-admin': '1' },
    remoteAddress: randomIp(),
    payload: { email: credentials.email, password: credentials.password },
  });
  if (res.statusCode !== 200) throw new Error(`login failed: ${res.statusCode} ${res.body}`);
  return sessionCookie(res);
}

export function sessionCookie(res: LightMyRequestResponse): string {
  const cookie = res.cookies.find((c) => c.name === 's5y_sid');
  if (!cookie) throw new Error('no session cookie');
  return `s5y_sid=${cookie.value}`;
}

export const admin = (cookie: string): Record<string, string> => ({ cookie, 'x-s5y-admin': '1' });

export function multipartBody(
  field: string,
  fileName: string,
  contentType: string,
  data: Buffer,
): { payload: Buffer; headers: Record<string, string> } {
  const boundary = `----s5y${randomBytes(8).toString('hex')}`;
  const head = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="${field}"; filename="${fileName}"\r\nContent-Type: ${contentType}\r\n\r\n`,
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  return {
    payload: Buffer.concat([head, data, tail]),
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
  };
}

export async function createPlace(app: FastifyInstance, cookie: string, body: Record<string, unknown>): Promise<AdminPlace> {
  const res = await app.inject({ method: 'POST', url: '/api/admin/places', headers: admin(cookie), payload: body });
  if (res.statusCode !== 201) throw new Error(`create place failed: ${res.statusCode} ${res.body}`);
  return res.json() as AdminPlace;
}

/** Uploads a whole file through the chunked protocol in `parts` chunks and completes it. */
export async function uploadVideo(
  app: FastifyInstance,
  cookie: string,
  placeId: string,
  file: Buffer,
  fileName = 'clip.mp4',
  mimeType = 'video/mp4',
  parts = 2,
): Promise<AdminVideo> {
  const init = await app.inject({
    method: 'POST',
    url: '/api/admin/videos/uploads',
    headers: admin(cookie),
    payload: { placeId, fileName, size: file.length, mimeType },
  });
  if (init.statusCode !== 201) throw new Error(`upload init failed: ${init.statusCode} ${init.body}`);
  const session = init.json() as VideoUploadSession;
  const step = Math.ceil(file.length / parts);
  for (let offset = 0; offset < file.length; offset += step) {
    const chunk = file.subarray(offset, Math.min(file.length, offset + step));
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/admin/videos/${session.videoId}/upload`,
      headers: { ...admin(cookie), 'content-type': 'application/octet-stream', 'upload-offset': String(offset) },
      payload: chunk,
    });
    if (res.statusCode !== 200) throw new Error(`chunk failed: ${res.statusCode} ${res.body}`);
  }
  const done = await app.inject({
    method: 'POST',
    url: `/api/admin/videos/${session.videoId}/upload/complete`,
    headers: admin(cookie),
    payload: {},
  });
  if (done.statusCode !== 200) throw new Error(`complete failed: ${done.statusCode} ${done.body}`);
  return done.json() as AdminVideo;
}
