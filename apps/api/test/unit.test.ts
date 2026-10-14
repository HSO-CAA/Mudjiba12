import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parse as parseDotenv } from 'dotenv';
import { describe, expect, it } from 'vitest';
import { API_ROOT, ConfigError, loadConfig } from '../src/config.js';
import { hashPassword, randomId, verifyPassword } from '../src/lib/crypto.js';
import { mapError } from '../src/plugins/errors.js';
import { AppError } from '../src/lib/errors.js';
import { MediaQueue } from '../src/media/queue.js';
import { AbortedError } from '../src/media/ffmpeg.js';
import { imageSize, jpegOrientation, looksLikeVideo, sniffImage } from '../src/media/sniff.js';
import { assertSafeKey, assertSafePrefix } from '../src/storage/types.js';
import { escapeHtml, injectAdminHead, injectHead, jsonForHtml } from '../src/web/html.js';
import { z } from '../src/lib/validation.js';

const silent = { debug() {}, info() {}, warn() {}, error() {} };

describe('config', () => {
  const base = { DATABASE_URL: 'postgresql://x@localhost/db' };

  it('applies the documented defaults', () => {
    const c = loadConfig(base);
    expect(c).toMatchObject({
      env: 'development',
      port: 4000,
      host: '0.0.0.0',
      publicUrl: 'http://localhost:4000',
      adminPath: '/studio',
      cookieSecure: false,
      trustProxy: false,
      ffmpegPath: 'ffmpeg',
      ffprobePath: 'ffprobe',
      maxVideoBytes: 2048 * 1024 * 1024,
      logLevel: 'info',
    });
    expect(c.storage.driver).toBe('local');
    expect(c.storage.dir).toMatch(/apps\/api\/storage$/);
    expect(c.webDist).toMatch(/apps\/web\/dist$/);
    expect(c.adminDist).toMatch(/apps\/admin\/dist$/);
  });

  it('parses booleans, trust proxy and admin path', () => {
    expect(loadConfig({ ...base, NODE_ENV: 'production' }).cookieSecure).toBe(true);
    expect(loadConfig({ ...base, NODE_ENV: 'production', COOKIE_SECURE: 'false' }).cookieSecure).toBe(false);
    expect(loadConfig({ ...base, TRUST_PROXY: 'true' }).trustProxy).toBe(true);
    expect(loadConfig({ ...base, TRUST_PROXY: '2' }).trustProxy).toBe(2);
    expect(loadConfig({ ...base, TRUST_PROXY: '10.0.0.0/8, 127.0.0.1' }).trustProxy).toEqual(['10.0.0.0/8', '127.0.0.1']);
    expect(loadConfig({ ...base, ADMIN_PATH: 'my-secret/' }).adminPath).toBe('/my-secret');
    expect(loadConfig({ ...base, PUBLIC_URL: 'https://s5y.iq/' }).publicUrl).toBe('https://s5y.iq');
  });

  it('rejects invalid configuration with readable problems', () => {
    expect(() => loadConfig({})).toThrow(ConfigError);
    expect(() => loadConfig({ ...base, ADMIN_PATH: '/api' })).toThrow(/ADMIN_PATH/);
    expect(() => loadConfig({ ...base, ADMIN_PATH: '/a b' })).toThrow(/ADMIN_PATH/);
    expect(() => loadConfig({ ...base, STORAGE_DRIVER: 's3' })).toThrow(/S3_BUCKET/);
    expect(() => loadConfig({ ...base, ADMIN_EMAIL: 'a@b.co', ADMIN_PASSWORD: 'short' })).toThrow(/ADMIN_PASSWORD/);
  });

  it('keeps starting when the bootstrap password is removed after the first run', () => {
    expect(loadConfig({ ...base, ADMIN_EMAIL: 'a@b.co' }).admin).toMatchObject({ email: 'a@b.co', password: undefined });
  });

  it('documents every variable in .env.example (and the example is valid)', () => {
    const example = parseDotenv(readFileSync(path.join(API_ROOT, '.env.example')));
    for (const key of ['DATABASE_URL', 'PORT', 'HOST', 'NODE_ENV', 'PUBLIC_URL', 'ADMIN_PATH', 'ADMIN_EMAIL', 'ADMIN_PASSWORD', 'ADMIN_NAME', 'COOKIE_SECURE', 'TRUST_PROXY', 'STORAGE_DRIVER', 'STORAGE_DIR', 'S3_ENDPOINT', 'S3_REGION', 'S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY', 'S3_PUBLIC_URL', 'S3_FORCE_PATH_STYLE', 'FFMPEG_PATH', 'FFPROBE_PATH', 'MAX_VIDEO_MB', 'WEB_DIST', 'ADMIN_DIST', 'LOG_LEVEL']) {
      expect(example, key).toHaveProperty(key);
    }
    const config = loadConfig({ ...example, ADMIN_PASSWORD: 'a-long-enough-password' });
    expect(loadConfig(example).admin.password).toBeUndefined();
    expect(config).toMatchObject({ adminPath: '/studio', trustProxy: false, cookieSecure: false });
  });

  it('configures S3 with a public origin', () => {
    const c = loadConfig({ ...base, STORAGE_DRIVER: 's3', S3_BUCKET: 'media', S3_PUBLIC_URL: 'https://cdn.s5y.iq/' });
    expect(c.storage.s3).toMatchObject({ bucket: 'media', publicUrl: 'https://cdn.s5y.iq', region: 'auto' });
  });
});

describe('passwords and ids', () => {
  it('hashes with scrypt and verifies in constant time', async () => {
    const hash = await hashPassword('كلمة-سر-طويلة-2026');
    expect(hash.split('$')).toHaveLength(6);
    expect(await verifyPassword('كلمة-سر-طويلة-2026', hash)).toBe(true);
    expect(await verifyPassword('كلمة-سر-طويلة-2027', hash)).toBe(false);
    expect(await verifyPassword('x', 'plain-text')).toBe(false);
    expect(await verifyPassword('x', 'scrypt$999999999$8$1$AA==$AA==')).toBe(false);
    expect(await hashPassword('same')).not.toBe(await hashPassword('same'));
  });

  it('generates unbiased lowercase ids', () => {
    const id = randomId(30);
    expect(id).toMatch(/^[a-z0-9]{30}$/);
    expect(new Set(Array.from({ length: 200 }, () => randomId(12))).size).toBe(200);
  });
});

describe('storage keys', () => {
  it('accepts server-shaped keys only', () => {
    expect(() => assertSafeKey('images/2026/10/abc123.webp')).not.toThrow();
    expect(() => assertSafeKey('videos/cabc/video.mp4')).not.toThrow();
    for (const bad of ['../etc/passwd', 'images/../../x', '/images/a.jpg', 'images/.uploads/x', 'other/a.jpg', 'images\\a.jpg', 'videos/a/b.c.d']) {
      expect(() => assertSafeKey(bad), bad).toThrow();
    }
    expect(() => assertSafePrefix('videos/cabc/')).not.toThrow();
    expect(() => assertSafePrefix('videos/')).toThrow();
    expect(() => assertSafePrefix('videos/../')).toThrow();
  });
});

describe('content sniffing', () => {
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]),
    Buffer.from('IHDR'),
    Buffer.from([0, 0, 2, 128, 0, 0, 1, 144]),
  ]);

  it('detects image types from magic bytes', () => {
    expect(sniffImage(png)).toBe('png');
    expect(imageSize(png, 'png')).toEqual({ width: 640, height: 400 });
    expect(sniffImage(Buffer.from('GIF89a\x10\x00\x20\x00......', 'latin1'))).toBe('gif');
    expect(imageSize(Buffer.from('GIF89a\x10\x00\x20\x00......', 'latin1'), 'gif')).toEqual({ width: 16, height: 32 });
    expect(sniffImage(Buffer.from('RIFF\x00\x00\x00\x00WEBPVP8 ', 'latin1'))).toBe('webp');
    expect(sniffImage(Buffer.concat([Buffer.from([0, 0, 0, 0x1c]), Buffer.from('ftypavif\0\0\0\0mif1miaf')]))).toBe('avif');
    expect(sniffImage(Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypmp42\0\0\0\0isom')]))).toBeNull();
    expect(sniffImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'))).toBeNull();
    expect(sniffImage(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]))).toBe('jpeg');
  });

  it('reads JPEG EXIF orientation', () => {
    const tiff = Buffer.concat([
      Buffer.from('MM\0*', 'latin1'),
      Buffer.from([0, 0, 0, 8, 0, 1, 0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, 6, 0, 0, 0, 0, 0, 0]),
    ]);
    const app1 = Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), tiff]);
    const seg = Buffer.concat([Buffer.from([0xff, 0xe1, 0, app1.length + 2]), app1]);
    const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8]), seg, Buffer.from([0xff, 0xda, 0, 2])]);
    expect(jpegOrientation(jpeg)).toBe(6);
    expect(jpegOrientation(Buffer.from([0xff, 0xd8, 0xff, 0xda, 0, 2]))).toBe(1);
  });

  it('recognizes video containers', () => {
    expect(looksLikeVideo(Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypqt  \0\0\0\0')]))).toBe(true);
    expect(looksLikeVideo(Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0, 0, 0, 0, 0]))).toBe(true);
    expect(looksLikeVideo(Buffer.from('hello world, not a video'))).toBe(false);
  });
});

describe('html helpers', () => {
  it('escapes attribute and text content', () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;');
    expect(jsonForHtml({ a: '</script><script>alert(1)</script>' })).not.toContain('</script>');
  });

  it('injects at placeholders or falls back to <head>', () => {
    expect(injectHead('<head><title>x</title><!--s5y-head--></head>', '<!--s5y-head-->', '<title>y</title>', true)).toBe(
      '<head><title>y</title></head>',
    );
    expect(injectHead('<head></head>', '<!--s5y-head-->', '<meta>', true)).toContain('<meta>\n  </head>');
    expect(injectAdminHead('<html><head lang="ar"><script src="./a.js"></script></head>', '<base href="/x/">')).toMatch(
      /<head lang="ar">\s*<base href="\/x\/"><script/,
    );
    // "$&" in injected content must not be interpreted as a replacement pattern.
    expect(injectHead('<head><!--s5y-head--></head>', '<!--s5y-head-->', '$& $1', false)).toBe('<head>$& $1</head>');
  });
});

describe('error mapping', () => {
  it('maps known errors and hides internals', () => {
    const zod = z.object({ a: z.string() }).safeParse({});
    expect(mapError(zod.error)).toMatchObject({ status: 400, body: { error: { code: 'VALIDATION_ERROR' } } });
    expect(mapError(new AppError(409, 'OFFSET_MISMATCH', 'x', { offset: 5 }))).toEqual({
      status: 409,
      body: { error: { code: 'OFFSET_MISMATCH', message: 'x', details: { offset: 5 } } },
    });
    expect(mapError(Object.assign(new Error('big'), { code: 'FST_ERR_CTP_BODY_TOO_LARGE', statusCode: 413 })).status).toBe(413);
    const internal = mapError(new Error('database password is hunter2'));
    expect(internal.status).toBe(500);
    expect(JSON.stringify(internal.body)).not.toContain('hunter2');
    expect(internal.body.error.code).toBe('INTERNAL_ERROR');
  });
});

describe('media queue', () => {
  it('runs jobs one at a time in order and resolves onIdle', async () => {
    const order: string[] = [];
    let running = 0;
    let maxRunning = 0;
    const queue = new MediaQueue(async (id) => {
      running++;
      maxRunning = Math.max(maxRunning, running);
      await new Promise((r) => setTimeout(r, 5));
      order.push(id);
      running--;
    }, silent);
    queue.enqueue('a');
    queue.enqueue('b');
    queue.enqueue('b');
    queue.enqueue('c');
    await queue.onIdle();
    expect(order).toEqual(['a', 'b', 'c']);
    expect(maxRunning).toBe(1);
    await queue.close();
  });

  it('cancels pending jobs and aborts the running one', async () => {
    const seen: string[] = [];
    const queue = new MediaQueue(
      (id, signal) =>
        new Promise<void>((resolve, reject) => {
          seen.push(id);
          const timer = setTimeout(resolve, 200);
          signal.addEventListener('abort', () => {
            clearTimeout(timer);
            reject(new AbortedError());
          });
        }),
      silent,
    );
    queue.enqueue('x');
    queue.enqueue('y');
    queue.cancel('y');
    queue.cancel('x');
    await queue.onIdle();
    expect(seen).toEqual(['x']);
    queue.enqueue('z');
    await queue.close();
    expect(queue.size).toBe(0);
    queue.enqueue('after-close');
    expect(queue.size).toBe(0);
  });
});
