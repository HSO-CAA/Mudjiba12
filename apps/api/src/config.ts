import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseDotenv } from 'dotenv';
import { z } from 'zod';
import { checkDatabaseUrl, checkServiceKey, isValidBucketName, parseSupabaseUrl } from './lib/supabase.js';

/** Absolute path of `apps/api` (works from both `src/` and `dist/`). */
export const API_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Env files, highest priority first: `apps/api/.env.local`, `<repo root>/.env.local`, `apps/api/.env`.
 * Keep in sync with `scripts/prisma-env.mjs` (the Prisma CLI wrapper reads the same files).
 */
export function envFiles(apiRoot = API_ROOT): string[] {
  return [path.join(apiRoot, '.env.local'), path.resolve(apiRoot, '..', '..', '.env.local'), path.join(apiRoot, '.env')];
}

/**
 * Loads env files into `target` (default `process.env`) without overriding variables that are already set:
 * real environment variables always win, and an earlier file wins over a later one. Missing files are skipped.
 * Returns the files that were read.
 */
export function loadEnvFile(files: string[] = envFiles(), target: NodeJS.ProcessEnv = process.env): string[] {
  const loaded: string[] = [];
  for (const file of files) {
    let text: string;
    try {
      text = readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    for (const [key, value] of Object.entries(parseDotenv(text))) {
      if (target[key] === undefined) target[key] = value;
    }
    loaded.push(file);
  }
  return loaded;
}

export type NodeEnv = 'development' | 'production' | 'test';
export type LogLevel = 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent';
export type TrustProxy = boolean | number | string[];

export interface S3Config {
  endpoint: string | undefined;
  region: string;
  bucket: string;
  accessKeyId: string | undefined;
  secretAccessKey: string | undefined;
  publicUrl: string;
  forcePathStyle: boolean;
}

export interface SupabaseConfig {
  /** Project URL without a trailing slash, e.g. `https://abcd1234.supabase.co`. */
  url: string;
  /** service_role (legacy JWT) or secret (`sb_secret_…`) key. Never log it. */
  serviceKey: string;
  bucket: string;
  /** Project ref taken from a `*.supabase.co` URL (null for custom domains / self-hosted). */
  projectRef: string | null;
}

export type StorageDriverName = 'local' | 's3' | 'supabase';

export interface Config {
  env: NodeEnv;
  isProduction: boolean;
  version: string;
  databaseUrl: string;
  port: number;
  host: string;
  /** Canonical site origin without a trailing slash, e.g. `https://s5y.iq`. */
  publicUrl: string;
  /** Secret dashboard path, e.g. `/studio` (leading slash, no trailing slash). */
  adminPath: string;
  admin: { email: string | undefined; password: string | undefined; name: string };
  cookieSecure: boolean;
  trustProxy: TrustProxy;
  storage: { driver: StorageDriverName; dir: string; s3: S3Config | null; supabase: SupabaseConfig | null };
  ffmpegPath: string;
  ffprobePath: string;
  maxVideoBytes: number;
  webDist: string;
  adminDist: string;
  logLevel: LogLevel;
  /** Non-fatal configuration hints, logged at startup (never contain secrets). */
  warnings: string[];
}

const RESERVED_ADMIN_PATHS = new Set(['/api', '/media', '/work', '/assets', '/robots.txt', '/sitemap.xml']);

const emptyToUndefined = (value: unknown): unknown =>
  typeof value === 'string' && value.trim() === '' ? undefined : value;

const optionalString = z.preprocess(emptyToUndefined, z.string().trim().optional());

const optionalBoolean = z.preprocess((value) => {
  const v = emptyToUndefined(value);
  if (typeof v !== 'string') return v;
  const s = v.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(s)) return true;
  if (['0', 'false', 'no', 'off'].includes(s)) return false;
  return v;
}, z.boolean().optional());

const envShape = {
  NODE_ENV: z.preprocess(emptyToUndefined, z.enum(['development', 'production', 'test']).default('development')),
  DATABASE_URL: z.preprocess(emptyToUndefined, z.string({ error: 'DATABASE_URL is required' }).min(1)),
  PORT: z.preprocess(emptyToUndefined, z.coerce.number().int().min(0).max(65535).default(4000)),
  HOST: z.preprocess(emptyToUndefined, z.string().default('0.0.0.0')),
  PUBLIC_URL: z.preprocess(emptyToUndefined, z.url({ protocol: /^https?$/ }).default('http://localhost:4000')),
  ADMIN_PATH: z.preprocess(
    emptyToUndefined,
    z
      .string()
      .trim()
      .transform((p) => (p.startsWith('/') ? p : `/${p}`).replace(/\/+$/, ''))
      .pipe(
        z
          .string()
          .regex(/^(\/[A-Za-z0-9_-]+)+$/, 'ADMIN_PATH must look like /studio (letters, digits, "-" or "_")')
          .refine((p) => !RESERVED_ADMIN_PATHS.has(p.split('/').slice(0, 2).join('/')), 'ADMIN_PATH collides with a reserved path'),
      )
      .default('/studio'),
  ),
  ADMIN_EMAIL: z.preprocess(emptyToUndefined, z.email().optional()),
  ADMIN_PASSWORD: z.preprocess(emptyToUndefined, z.string().min(10, 'ADMIN_PASSWORD must be at least 10 characters').optional()),
  ADMIN_NAME: optionalString,
  COOKIE_SECURE: optionalBoolean,
  TRUST_PROXY: optionalString,
  // Unset/empty → auto: `supabase` when SUPABASE_URL and a service key are present, otherwise `local`.
  STORAGE_DRIVER: z.preprocess(
    (value) => {
      const v = emptyToUndefined(value);
      return typeof v === 'string' ? v.trim().toLowerCase() : v;
    },
    z.enum(['local', 's3', 'supabase'], { error: 'STORAGE_DRIVER must be local, s3 or supabase (or empty to auto-detect)' }).optional(),
  ),
  STORAGE_DIR: z.preprocess(emptyToUndefined, z.string().default('./storage')),
  S3_ENDPOINT: z.preprocess(emptyToUndefined, z.url().optional()),
  S3_REGION: optionalString,
  S3_BUCKET: optionalString,
  S3_ACCESS_KEY_ID: optionalString,
  S3_SECRET_ACCESS_KEY: optionalString,
  S3_PUBLIC_URL: z.preprocess(emptyToUndefined, z.url().optional()),
  S3_FORCE_PATH_STYLE: optionalBoolean,
  SUPABASE_URL: optionalString,
  SUPABASE_SERVICE_ROLE_KEY: optionalString,
  /** Alias of SUPABASE_SERVICE_ROLE_KEY (new-style `sb_secret_…` keys). */
  SUPABASE_SECRET_KEY: optionalString,
  SUPABASE_STORAGE_BUCKET: optionalString,
  /** Accepted for convenience (the owner's .env.local may hold it) but never used by the server. */
  SUPABASE_ANON_KEY: optionalString,
  FFMPEG_PATH: z.preprocess(emptyToUndefined, z.string().default('ffmpeg')),
  FFPROBE_PATH: z.preprocess(emptyToUndefined, z.string().default('ffprobe')),
  MAX_VIDEO_MB: z.preprocess(emptyToUndefined, z.coerce.number().int().min(1).max(1024 * 64).default(2048)),
  WEB_DIST: z.preprocess(emptyToUndefined, z.string().default('../web/dist')),
  ADMIN_DIST: z.preprocess(emptyToUndefined, z.string().default('../admin/dist')),
  LOG_LEVEL: z.preprocess(
    emptyToUndefined,
    z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  ),
};

/** Every environment variable the API reads (documented in `.env.example`). */
export const ENV_VARS = Object.keys(envShape) as (keyof typeof envShape)[];

const envSchema = z
  .object(envShape)
  .superRefine((env, ctx) => {
    if (env.STORAGE_DRIVER === 's3') {
      if (!env.S3_BUCKET) ctx.addIssue({ code: 'custom', path: ['S3_BUCKET'], message: 'S3_BUCKET is required when STORAGE_DRIVER=s3' });
      if (!env.S3_PUBLIC_URL)
        ctx.addIssue({ code: 'custom', path: ['S3_PUBLIC_URL'], message: 'S3_PUBLIC_URL is required when STORAGE_DRIVER=s3' });
    }
  });

function parseTrustProxy(raw: string | undefined): TrustProxy {
  if (raw === undefined) return false;
  const value = raw.trim().toLowerCase();
  if (['true', '1', 'yes', 'on'].includes(value)) return true;
  if (['false', '0', 'no', 'off', ''].includes(value)) return false;
  if (/^\d+$/.test(value)) return Number(value);
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function readVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(path.join(API_ROOT, 'package.json'), 'utf8')) as { version?: unknown };
    return typeof pkg.version === 'string' ? pkg.version : '0.0.0';
  } catch {
    return '0.0.0';
  }
}

const resolveFromApiRoot = (p: string): string => (path.isAbsolute(p) ? p : path.resolve(API_ROOT, p));

export class ConfigError extends Error {
  constructor(public readonly problems: string[]) {
    super(`Invalid environment configuration:\n  - ${problems.join('\n  - ')}`);
    this.name = 'ConfigError';
  }
}

/** Parses and validates environment variables (see `.env.example`). Throws `ConfigError` on invalid input. */
export function loadConfig(source: NodeJS.ProcessEnv = process.env): Config {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    throw new ConfigError(parsed.error.issues.map((i) => `${i.path.join('.') || 'env'}: ${i.message}`));
  }
  const env = parsed.data;
  const isProduction = env.NODE_ENV === 'production';
  const problems: string[] = [];
  const warnings: string[] = [];

  const s3: S3Config | null =
    env.STORAGE_DRIVER === 's3' && env.S3_BUCKET && env.S3_PUBLIC_URL
      ? {
          endpoint: env.S3_ENDPOINT,
          region: env.S3_REGION ?? 'auto',
          bucket: env.S3_BUCKET,
          accessKeyId: env.S3_ACCESS_KEY_ID,
          secretAccessKey: env.S3_SECRET_ACCESS_KEY,
          publicUrl: env.S3_PUBLIC_URL.replace(/\/+$/, ''),
          forcePathStyle: env.S3_FORCE_PATH_STYLE ?? false,
        }
      : null;

  // An explicit STORAGE_DRIVER always wins; otherwise Supabase is picked when both its URL and a server key are set.
  const keyVar = env.SUPABASE_SERVICE_ROLE_KEY ? 'SUPABASE_SERVICE_ROLE_KEY' : 'SUPABASE_SECRET_KEY';
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY ?? env.SUPABASE_SECRET_KEY;
  const driver: StorageDriverName = env.STORAGE_DRIVER ?? (env.SUPABASE_URL && serviceKey ? 'supabase' : 'local');
  const supabaseUrl = env.SUPABASE_URL ? parseSupabaseUrl(env.SUPABASE_URL) : null;

  let supabase: SupabaseConfig | null = null;
  if (driver === 'supabase') {
    if (!env.SUPABASE_URL) {
      problems.push('SUPABASE_URL: required when STORAGE_DRIVER=supabase (your project URL, e.g. https://abcdefghijklmnopqrst.supabase.co)');
    } else if (supabaseUrl && !supabaseUrl.ok) {
      problems.push(`SUPABASE_URL: ${supabaseUrl.problem}`);
    }
    if (!serviceKey) {
      problems.push(
        'SUPABASE_SERVICE_ROLE_KEY: required when STORAGE_DRIVER=supabase — the secret service_role key from Supabase → Project Settings → API Keys (the anon key is not enough)',
      );
    }
    const bucket = env.SUPABASE_STORAGE_BUCKET ?? 'media';
    if (!isValidBucketName(bucket)) {
      problems.push(
        'SUPABASE_STORAGE_BUCKET: use lowercase letters, digits, "-", "_" or "." (1–63 characters, starting and ending with a letter or digit), e.g. media',
      );
    }
    if (serviceKey && supabaseUrl?.ok) {
      const check = checkServiceKey(serviceKey, supabaseUrl.projectRef, env.SUPABASE_ANON_KEY);
      problems.push(...check.problems.map((m) => `${keyVar}: ${m}`));
      warnings.push(...check.warnings.map((m) => `${keyVar}: ${m}`));
      supabase = { url: supabaseUrl.url, serviceKey: serviceKey.trim(), bucket, projectRef: supabaseUrl.projectRef };
    }
  } else if (!env.STORAGE_DRIVER && env.SUPABASE_URL && !serviceKey) {
    warnings.push(
      'SUPABASE_URL is set but SUPABASE_SERVICE_ROLE_KEY is empty, so media is stored on this server\'s disk (local). ' +
        'To use Supabase Storage add the secret service_role key (Supabase → Project Settings → API Keys) — the anon key is not enough.',
    );
  }

  const db = checkDatabaseUrl(env.DATABASE_URL, supabaseUrl?.ok ? supabaseUrl.projectRef : null);
  problems.push(...db.problems);
  warnings.push(...db.warnings);

  if (problems.length > 0) throw new ConfigError(problems);

  return {
    env: env.NODE_ENV,
    isProduction,
    version: readVersion(),
    databaseUrl: db.url,
    port: env.PORT,
    host: env.HOST,
    publicUrl: env.PUBLIC_URL.replace(/\/+$/, ''),
    adminPath: env.ADMIN_PATH,
    admin: { email: env.ADMIN_EMAIL?.toLowerCase(), password: env.ADMIN_PASSWORD, name: env.ADMIN_NAME ?? 'S5Y' },
    cookieSecure: env.COOKIE_SECURE ?? isProduction,
    trustProxy: parseTrustProxy(env.TRUST_PROXY),
    storage: { driver, dir: resolveFromApiRoot(env.STORAGE_DIR), s3, supabase },
    ffmpegPath: env.FFMPEG_PATH,
    ffprobePath: env.FFPROBE_PATH,
    maxVideoBytes: env.MAX_VIDEO_MB * 1024 * 1024,
    webDist: resolveFromApiRoot(env.WEB_DIST),
    adminDist: resolveFromApiRoot(env.ADMIN_DIST),
    logLevel: env.LOG_LEVEL,
    warnings,
  };
}
