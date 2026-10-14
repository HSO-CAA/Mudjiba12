import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';

/** Absolute path of `apps/api` (works from both `src/` and `dist/`). */
export const API_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Loads `apps/api/.env` into `process.env` without overriding variables that are already set. */
export function loadEnvFile(file = path.join(API_ROOT, '.env')): void {
  loadDotenv({ path: file, quiet: true });
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
  storage: { driver: 'local' | 's3'; dir: string; s3: S3Config | null };
  ffmpegPath: string;
  ffprobePath: string;
  maxVideoBytes: number;
  webDist: string;
  adminDist: string;
  logLevel: LogLevel;
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

const envSchema = z
  .object({
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
    STORAGE_DRIVER: z.preprocess(emptyToUndefined, z.enum(['local', 's3']).default('local')),
    STORAGE_DIR: z.preprocess(emptyToUndefined, z.string().default('./storage')),
    S3_ENDPOINT: z.preprocess(emptyToUndefined, z.url().optional()),
    S3_REGION: optionalString,
    S3_BUCKET: optionalString,
    S3_ACCESS_KEY_ID: optionalString,
    S3_SECRET_ACCESS_KEY: optionalString,
    S3_PUBLIC_URL: z.preprocess(emptyToUndefined, z.url().optional()),
    S3_FORCE_PATH_STYLE: optionalBoolean,
    FFMPEG_PATH: z.preprocess(emptyToUndefined, z.string().default('ffmpeg')),
    FFPROBE_PATH: z.preprocess(emptyToUndefined, z.string().default('ffprobe')),
    MAX_VIDEO_MB: z.preprocess(emptyToUndefined, z.coerce.number().int().min(1).max(1024 * 64).default(2048)),
    WEB_DIST: z.preprocess(emptyToUndefined, z.string().default('../web/dist')),
    ADMIN_DIST: z.preprocess(emptyToUndefined, z.string().default('../admin/dist')),
    LOG_LEVEL: z.preprocess(
      emptyToUndefined,
      z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
    ),
  })
  .superRefine((env, ctx) => {
    if (env.STORAGE_DRIVER === 's3') {
      if (!env.S3_BUCKET) ctx.addIssue({ code: 'custom', path: ['S3_BUCKET'], message: 'S3_BUCKET is required when STORAGE_DRIVER=s3' });
      if (!env.S3_PUBLIC_URL)
        ctx.addIssue({ code: 'custom', path: ['S3_PUBLIC_URL'], message: 'S3_PUBLIC_URL is required when STORAGE_DRIVER=s3' });
    }
    if (env.ADMIN_EMAIL && !env.ADMIN_PASSWORD) {
      ctx.addIssue({ code: 'custom', path: ['ADMIN_PASSWORD'], message: 'ADMIN_PASSWORD is required when ADMIN_EMAIL is set' });
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

  return {
    env: env.NODE_ENV,
    isProduction,
    version: readVersion(),
    databaseUrl: env.DATABASE_URL,
    port: env.PORT,
    host: env.HOST,
    publicUrl: env.PUBLIC_URL.replace(/\/+$/, ''),
    adminPath: env.ADMIN_PATH,
    admin: { email: env.ADMIN_EMAIL?.toLowerCase(), password: env.ADMIN_PASSWORD, name: env.ADMIN_NAME ?? 'S5Y' },
    cookieSecure: env.COOKIE_SECURE ?? isProduction,
    trustProxy: parseTrustProxy(env.TRUST_PROXY),
    storage: { driver: env.STORAGE_DRIVER, dir: resolveFromApiRoot(env.STORAGE_DIR), s3 },
    ffmpegPath: env.FFMPEG_PATH,
    ffprobePath: env.FFPROBE_PATH,
    maxVideoBytes: env.MAX_VIDEO_MB * 1024 * 1024,
    webDist: resolveFromApiRoot(env.WEB_DIST),
    adminDist: resolveFromApiRoot(env.ADMIN_DIST),
    logLevel: env.LOG_LEVEL,
  };
}
