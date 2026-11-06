import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parse as parseDotenv } from 'dotenv';
import { describe, expect, it } from 'vitest';
import { envFiles as prismaEnvFiles, loadEnvFiles as prismaLoadEnvFiles } from '../scripts/prisma-env.mjs';
import { API_ROOT, ConfigError, ENV_VARS, envFiles, loadConfig, loadEnvFile } from '../src/config.js';
import { inspectSupabaseKey } from '../src/lib/supabase.js';
import { StorageAuthError, StorageObjectTooLargeError, StorageRequestError } from '../src/storage/types.js';
import { TEST_DATABASE_URL } from './env.js';
import { makeSupabaseJwt } from './supabase-mock.js';
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
    for (const key of ['DATABASE_URL', 'PORT', 'HOST', 'NODE_ENV', 'PUBLIC_URL', 'ADMIN_PATH', 'ADMIN_EMAIL', 'ADMIN_PASSWORD', 'ADMIN_NAME', 'COOKIE_SECURE', 'TRUST_PROXY', 'STORAGE_DRIVER', 'STORAGE_DIR', 'S3_ENDPOINT', 'S3_REGION', 'S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY', 'S3_PUBLIC_URL', 'S3_FORCE_PATH_STYLE', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SECRET_KEY', 'SUPABASE_STORAGE_BUCKET', 'SUPABASE_ANON_KEY', 'FFMPEG_PATH', 'FFPROBE_PATH', 'MAX_VIDEO_MB', 'WEB_DIST', 'ADMIN_DIST', 'LOG_LEVEL']) {
      expect(example, key).toHaveProperty(key);
    }
    // …and nothing the schema reads is missing from the example.
    for (const key of ENV_VARS) expect(example, key).toHaveProperty(key);
    const config = loadConfig({ ...example, ADMIN_PASSWORD: 'a-long-enough-password' });
    expect(loadConfig(example).admin.password).toBeUndefined();
    expect(config).toMatchObject({ adminPath: '/studio', trustProxy: false, cookieSecure: false, warnings: [] });
    expect(config.storage).toMatchObject({ driver: 'local', supabase: null });
  });

  it('the commit-safe templates contain no Supabase keys', () => {
    for (const file of [path.join(API_ROOT, '.env.example'), path.resolve(API_ROOT, '../../.env.example'), path.resolve(API_ROOT, '../../.env.local.example')]) {
      const text = readFileSync(file, 'utf8');
      expect(text, file).not.toMatch(/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/);
      expect(text, file).not.toMatch(/sb_(?:secret|publishable)_[A-Za-z0-9_-]{8,}/);
      for (const [key, value] of Object.entries(parseDotenv(text))) {
        if (/KEY|SECRET|PASSWORD/.test(key) && !/^(?:change-me|CHANGE_ME)/.test(value)) expect(value, `${file}: ${key}`).toBe('');
      }
    }
  });

  it('configures S3 with a public origin', () => {
    const c = loadConfig({ ...base, STORAGE_DRIVER: 's3', S3_BUCKET: 'media', S3_PUBLIC_URL: 'https://cdn.s5y.iq/' });
    expect(c.storage.s3).toMatchObject({ bucket: 'media', publicUrl: 'https://cdn.s5y.iq', region: 'auto' });
  });
});

describe('supabase config', () => {
  const base = { DATABASE_URL: 'postgresql://x@localhost/db' };
  const ref = 'abcdefghijklmnopqrst';
  const url = `https://${ref}.supabase.co`;
  const service = makeSupabaseJwt({ ref, role: 'service_role' });
  const anon = makeSupabaseJwt({ ref, role: 'anon' });
  const problemsOf = (env: Record<string, string>): string => {
    try {
      loadConfig({ ...base, ...env });
    } catch (err) {
      if (err instanceof ConfigError) return err.message;
      throw err;
    }
    return '';
  };

  it('auto-selects supabase when the URL and a service key are present; an explicit driver wins', () => {
    const c = loadConfig({ ...base, SUPABASE_URL: `${url}/`, SUPABASE_SERVICE_ROLE_KEY: service });
    expect(c.storage.driver).toBe('supabase');
    expect(c.storage.supabase).toEqual({ url, serviceKey: service, bucket: 'media', projectRef: ref });
    expect(c.warnings).toEqual([]);
    expect(loadConfig({ ...base, STORAGE_DRIVER: '', SUPABASE_URL: url, SUPABASE_SERVICE_ROLE_KEY: service }).storage.driver).toBe('supabase');
    expect(loadConfig({ ...base, STORAGE_DRIVER: 'local', SUPABASE_URL: url, SUPABASE_SERVICE_ROLE_KEY: service }).storage).toMatchObject({
      driver: 'local',
      supabase: null,
    });
    expect(loadConfig({ ...base, STORAGE_DRIVER: 'Supabase', SUPABASE_URL: url, SUPABASE_SERVICE_ROLE_KEY: service }).storage.driver).toBe('supabase');
    const s3 = loadConfig({ ...base, STORAGE_DRIVER: 's3', S3_BUCKET: 'b', S3_PUBLIC_URL: 'https://cdn.x', SUPABASE_URL: url, SUPABASE_SERVICE_ROLE_KEY: service });
    expect(s3.storage).toMatchObject({ driver: 's3', supabase: null });
  });

  it('stays local (with a hint) when only the URL and the anon key are set — the owner\'s first .env.local', () => {
    const c = loadConfig({ ...base, SUPABASE_URL: url, SUPABASE_ANON_KEY: anon, SUPABASE_SERVICE_ROLE_KEY: '', SUPABASE_STORAGE_BUCKET: 'media' });
    expect(c.storage).toMatchObject({ driver: 'local', supabase: null });
    expect(c.warnings.join('\n')).toMatch(/SUPABASE_SERVICE_ROLE_KEY is empty/);
    expect(c.warnings.join('\n')).not.toContain(anon);
  });

  it('accepts SUPABASE_SECRET_KEY (new sb_secret_ keys) as an alias', () => {
    const c = loadConfig({ ...base, SUPABASE_URL: url, SUPABASE_SECRET_KEY: 'sb_secret_abcdefghijklmnopqrstuv' });
    expect(c.storage.supabase).toMatchObject({ serviceKey: 'sb_secret_abcdefghijklmnopqrstuv', bucket: 'media' });
    // SUPABASE_SERVICE_ROLE_KEY wins when both are set.
    expect(loadConfig({ ...base, SUPABASE_URL: url, SUPABASE_SERVICE_ROLE_KEY: service, SUPABASE_SECRET_KEY: 'sb_secret_x' }).storage.supabase?.serviceKey).toBe(service);
  });

  it('rejects the anon / publishable key with a clear message that never contains the key', () => {
    for (const key of [anon, 'sb_publishable_abcdefghijklmnopqrstuv']) {
      const msg = problemsOf({ SUPABASE_URL: url, SUPABASE_SERVICE_ROLE_KEY: key });
      expect(msg).toMatch(/SUPABASE_SERVICE_ROLE_KEY: this is the public (anon|publishable) key — the server needs the secret service_role key/);
      expect(msg).toMatch(/Project Settings → API Keys/);
      expect(msg).not.toContain(key);
    }
    expect(problemsOf({ SUPABASE_URL: url, SUPABASE_SECRET_KEY: anon })).toMatch(/^.*SUPABASE_SECRET_KEY: this is the public anon key/m);
    const same = problemsOf({ SUPABASE_URL: url, SUPABASE_SERVICE_ROLE_KEY: 'opaque-key-value', SUPABASE_ANON_KEY: 'opaque-key-value' });
    expect(same).toMatch(/same value as SUPABASE_ANON_KEY/);
    expect(same).not.toContain('opaque-key-value');
    expect(problemsOf({ SUPABASE_URL: url, SUPABASE_SERVICE_ROLE_KEY: makeSupabaseJwt({ ref, role: 'authenticated' }) })).toMatch(
      /not a service_role key \(its role is "authenticated"\)/,
    );
  });

  it('rejects a service_role key of another project', () => {
    const other = makeSupabaseJwt({ ref: 'zzzzzzzzzzzzzzzzzzzz', role: 'service_role' });
    const msg = problemsOf({ SUPABASE_URL: url, SUPABASE_SERVICE_ROLE_KEY: other });
    expect(msg).toMatch(/belongs to another Supabase project/);
    expect(msg).not.toContain(other);
    // Custom domains / self-hosted URLs carry no ref → nothing to compare.
    expect(loadConfig({ ...base, SUPABASE_URL: 'https://media.example.com', SUPABASE_SERVICE_ROLE_KEY: other }).storage.supabase?.projectRef).toBeNull();
  });

  it('explains what is missing when STORAGE_DRIVER=supabase', () => {
    const msg = problemsOf({ STORAGE_DRIVER: 'supabase' });
    expect(msg).toMatch(/SUPABASE_URL: required/);
    expect(msg).toMatch(/SUPABASE_SERVICE_ROLE_KEY: required/);
    expect(problemsOf({ STORAGE_DRIVER: 'supabase', SUPABASE_URL: url })).toMatch(/anon key is not enough/);
    expect(problemsOf({ STORAGE_DRIVER: 'nope' })).toMatch(/STORAGE_DRIVER must be local, s3 or supabase/);
  });

  it('normalises and validates SUPABASE_URL and the bucket name', () => {
    const ok = (u: string) => loadConfig({ ...base, SUPABASE_URL: u, SUPABASE_SERVICE_ROLE_KEY: service }).storage.supabase?.url;
    expect(ok(`${url}///`)).toBe(url);
    expect(ok(`${url}/rest/v1/`)).toBe(url);
    expect(ok('http://127.0.0.1:54321')).toBe('http://127.0.0.1:54321');
    expect(problemsOf({ SUPABASE_URL: `http://${ref}.supabase.co`, SUPABASE_SERVICE_ROLE_KEY: service })).toMatch(/must start with https:\/\//);
    expect(problemsOf({ SUPABASE_URL: `https://supabase.com/dashboard/project/${ref}`, SUPABASE_SERVICE_ROLE_KEY: service })).toMatch(/dashboard address/);
    expect(problemsOf({ SUPABASE_URL: 'not a url', SUPABASE_SERVICE_ROLE_KEY: service })).toMatch(/not a valid URL/);
    const bucket = (b: string) => problemsOf({ SUPABASE_URL: url, SUPABASE_SERVICE_ROLE_KEY: service, SUPABASE_STORAGE_BUCKET: b });
    expect(bucket('media')).toBe('');
    expect(bucket('s5y-media_2.v1')).toBe('');
    for (const bad of ['Media', 'my bucket', '-media', 'media/', 'a..b', 'x'.repeat(64), 'مدیا']) expect(bucket(bad), bad).toMatch(/SUPABASE_STORAGE_BUCKET/);
  });

  it('warns about a key that does not look like one (without printing it)', () => {
    const c = loadConfig({ ...base, SUPABASE_URL: url, SUPABASE_SERVICE_ROLE_KEY: 'truncated-key' });
    expect(c.storage.driver).toBe('supabase');
    expect(c.warnings.join('\n')).toMatch(/does not look like a Supabase key/);
    expect(c.warnings.join('\n')).not.toContain('truncated-key');
  });

  it('gives Supabase Postgres hints: placeholder password, transaction pooler, direct IPv6 host', () => {
    expect(problemsOf({ DATABASE_URL: `postgresql://postgres.${ref}:[YOUR-PASSWORD]@aws-0-eu-central-1.pooler.supabase.com:5432/postgres` })).toMatch(
      /placeholder like \[YOUR-PASSWORD\]/,
    );
    const session = loadConfig({ DATABASE_URL: `postgresql://postgres.${ref}:pw@aws-0-eu-central-1.pooler.supabase.com:5432/postgres` });
    expect(session.warnings).toEqual([]);
    expect(session.databaseUrl).not.toContain('pgbouncer');
    const tx = loadConfig({ DATABASE_URL: `postgresql://postgres.${ref}:s3cret@aws-0-eu-central-1.pooler.supabase.com:6543/postgres?schema=public` });
    expect(tx.databaseUrl).toBe(`postgresql://postgres.${ref}:s3cret@aws-0-eu-central-1.pooler.supabase.com:6543/postgres?schema=public&pgbouncer=true`);
    expect(tx.warnings.join('\n')).toMatch(/Transaction pooler \(port 6543\).*Session pooler/);
    expect(tx.warnings.join('\n')).not.toContain('s3cret');
    const kept = loadConfig({ DATABASE_URL: `postgresql://postgres.${ref}:pw@aws-0-x.pooler.supabase.com:6543/postgres?pgbouncer=true` });
    expect(kept.databaseUrl.match(/pgbouncer/g)).toHaveLength(1);
    expect(loadConfig({ DATABASE_URL: `postgresql://postgres:pw@db.${ref}.supabase.co:5432/postgres` }).warnings.join('\n')).toMatch(/IPv6-only/);
    const mismatch = loadConfig({
      DATABASE_URL: 'postgresql://postgres.otherprojectref0000:pw@aws-0-x.pooler.supabase.com:5432/postgres',
      SUPABASE_URL: url,
      SUPABASE_SERVICE_ROLE_KEY: service,
    });
    expect(mismatch.warnings.join('\n')).toMatch(/same project/);
  });

  it('classifies keys', () => {
    expect(inspectSupabaseKey(service)).toEqual({ kind: 'service_role', role: 'service_role', ref });
    expect(inspectSupabaseKey(anon).kind).toBe('anon');
    expect(inspectSupabaseKey('sb_secret_x').kind).toBe('secret');
    expect(inspectSupabaseKey('sb_publishable_x').kind).toBe('publishable');
    expect(inspectSupabaseKey('a.b.c').kind).toBe('unknown');
    expect(inspectSupabaseKey('').kind).toBe('unknown');
  });
});

describe('env files', () => {
  const makeTree = () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 's5y-env-'));
    const api = path.join(root, 'apps', 'api');
    mkdirSync(api, { recursive: true });
    writeFileSync(path.join(api, '.env.local'), 'A=api-local\n');
    writeFileSync(path.join(root, '.env.local'), 'A=root-local\nB=root-local\nSUPABASE_URL=https://abcdefghijklmnopqrst.supabase.co\n');
    writeFileSync(path.join(api, '.env'), 'A=api-env\nB=api-env\nC=api-env\nD=api-env\n');
    return { root, api };
  };

  it('loads apps/api/.env.local, then <repo>/.env.local, then apps/api/.env without overriding set variables', () => {
    const { root, api } = makeTree();
    try {
      expect(envFiles(api)).toEqual([path.join(api, '.env.local'), path.join(root, '.env.local'), path.join(api, '.env')]);
      const target: NodeJS.ProcessEnv = { C: 'shell', D: '' };
      const loaded = loadEnvFile(envFiles(api), target);
      expect(loaded).toEqual(envFiles(api));
      expect(target).toEqual({ A: 'api-local', B: 'root-local', C: 'shell', D: '', SUPABASE_URL: 'https://abcdefghijklmnopqrst.supabase.co' });
      // Missing files are skipped.
      rmSync(path.join(api, '.env.local'));
      const second: NodeJS.ProcessEnv = {};
      expect(loadEnvFile(envFiles(api), second)).toEqual([path.join(root, '.env.local'), path.join(api, '.env')]);
      expect(second.A).toBe('root-local');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('the default list is apps/api/.env.local, <repo root>/.env.local, apps/api/.env', () => {
    const repo = path.resolve(API_ROOT, '..', '..');
    expect(envFiles()).toEqual([path.join(API_ROOT, '.env.local'), path.join(repo, '.env.local'), path.join(API_ROOT, '.env')]);
  });

  it('the Prisma CLI wrapper reads the same files in the same order', () => {
    const { root, api } = makeTree();
    try {
      expect(prismaEnvFiles(api)).toEqual(envFiles(api));
      expect(prismaEnvFiles()).toEqual(envFiles());
      const a: NodeJS.ProcessEnv = { C: 'shell' };
      const b: NodeJS.ProcessEnv = { C: 'shell' };
      loadEnvFile(envFiles(api), a);
      prismaLoadEnvFiles(prismaEnvFiles(api), b);
      expect(b).toEqual(a);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('the Prisma CLI wrapper propagates exit codes and catches placeholder URLs', () => {
    const wrapper = path.join(API_ROOT, 'scripts', 'prisma-env.mjs');
    const run = (DATABASE_URL: string) =>
      spawnSync(process.execPath, [wrapper, 'migrate', 'deploy'], { env: { ...process.env, DATABASE_URL }, encoding: 'utf8', timeout: 60_000 });
    const ok = run(TEST_DATABASE_URL);
    expect(ok.status, ok.stderr).toBe(0);
    const placeholder = run('postgresql://postgres.abc:[YOUR-PASSWORD]@aws-0-x.pooler.supabase.com:5432/postgres');
    expect(placeholder.status).toBe(1);
    expect(placeholder.stderr).toMatch(/\[YOUR-PASSWORD\]/);
    const unreachable = run('postgresql://s5y:s5y@127.0.0.1:1/nowhere?connect_timeout=2');
    expect(unreachable.status).not.toBe(0);
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
    expect(mapError(new StorageObjectTooLargeError('Supabase Storage', 'videos/x/video.mp4'))).toMatchObject({
      status: 413,
      body: { error: { code: 'PAYLOAD_TOO_LARGE' } },
    });
    expect(mapError(new StorageAuthError('Supabase Storage', 401, 'Invalid API key'))).toMatchObject({ status: 502, body: { error: { code: 'STORAGE_ERROR' } } });
    expect(mapError(new StorageRequestError('Supabase Storage', null, 'down')).status).toBe(502);
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
