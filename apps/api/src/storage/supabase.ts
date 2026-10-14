import { createReadStream, createWriteStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream as NodeReadableStream } from 'node:stream/web';
import type { SupabaseConfig } from '../config.js';
import { randomId } from '../lib/crypto.js';
import {
  StorageAuthError,
  StorageObjectTooLargeError,
  StorageRequestError,
  assertSafeKey,
  assertSafePrefix,
  type LocalFileHandle,
  type PutOptions,
  type StorageDriver,
  type StorageLog,
} from './types.js';

const PROVIDER = 'Supabase Storage';
/** Sent as the object's `cache-control`; Supabase stores it (cacheControl) and serves it on public URLs. */
const CACHE_CONTROL = 'max-age=31536000';
const DELETE_BATCH = 1000;
const MAX_LIST_DEPTH = 8;

export interface SupabaseStorageOptions {
  /** Attempts per request when it fails with a network error, HTTP 5xx or 429. Default 4. */
  maxAttempts?: number;
  /** First retry delay in ms; doubles on every retry (±25 % jitter, max 15 s). Default 500. */
  retryBaseMs?: number;
  /** Page size of `object/list` calls. Default 1000. */
  listPageSize?: number;
}

interface SupabaseErrorBody {
  statusCode?: string | number;
  code?: string;
  error?: string;
  message?: string;
}

interface BucketInfo {
  id?: string;
  public?: boolean;
  file_size_limit?: number | null;
  allowed_mime_types?: string[] | null;
}

interface ListItem {
  name: string;
  id: string | null;
}

interface SendOptions {
  headers?: Record<string, string>;
  /** Called once per attempt so a file stream can be re-opened on retries. */
  body?: () => RequestInit['body'];
  json?: unknown;
  timeoutMs?: number;
  attempts?: number;
}

interface ErrorInfo {
  status: number;
  body: SupabaseErrorBody | null;
  /** Short, credential-free description from the response. */
  detail: string;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Encodes every path segment (keys are server-shaped, but never trust that for URLs). */
const encodePath = (p: string): string => p.split('/').map(encodeURIComponent).join('/');

function networkReason(err: unknown): string {
  const e = err as { name?: string; message?: string; cause?: { code?: string; message?: string } };
  if (e?.name === 'TimeoutError' || e?.name === 'AbortError') return 'request timed out';
  return e?.cause?.code ?? e?.cause?.message ?? e?.message ?? 'network error';
}

/**
 * Supabase Storage driver using the Storage REST API with global `fetch` (no SDK).
 * Objects live in one public bucket and are served from `${SUPABASE_URL}/storage/v1/object/public/<bucket>/<key>`.
 * Authenticates like supabase-js (`apikey` + `Authorization: Bearer`), which works for legacy service_role JWTs
 * and new `sb_secret_…` keys. Keys are never logged or put into error messages.
 */
export class SupabaseStorage implements StorageDriver {
  readonly kind = 'supabase' as const;
  readonly publicOrigin: string;
  readonly localMediaDir = null;
  private readonly api: string;
  private readonly publicBase: string;
  private readonly bucketPath: string;
  private readonly maxAttempts: number;
  private readonly retryBaseMs: number;
  private readonly listPageSize: number;
  /** Per-file limit of the bucket when it has one (read by `init`); lets big files fail before uploading. */
  private bucketLimit: number | null = null;

  constructor(
    private readonly cfg: SupabaseConfig,
    options: SupabaseStorageOptions = {},
  ) {
    const base = cfg.url.replace(/\/+$/, '');
    this.publicOrigin = new URL(base).origin;
    this.api = `${base}/storage/v1`;
    this.bucketPath = encodeURIComponent(cfg.bucket);
    this.publicBase = `${this.api}/object/public/${this.bucketPath}`;
    this.maxAttempts = Math.max(1, options.maxAttempts ?? 4);
    this.retryBaseMs = Math.max(0, options.retryBaseMs ?? 500);
    this.listPageSize = Math.max(1, Math.min(1000, options.listPageSize ?? 1000));
  }

  get bucket(): string {
    return this.cfg.bucket;
  }

  url(key: string): string {
    return `${this.publicBase}/${encodePath(key)}`;
  }

  async putFile(key: string, filePath: string, options: PutOptions): Promise<void> {
    assertSafeKey(key);
    const { size } = await fs.stat(filePath);
    if (this.bucketLimit !== null && size > this.bucketLimit) throw new StorageObjectTooLargeError(PROVIDER, key);
    const res = await this.send('POST', `/object/${this.bucketPath}/${encodePath(key)}`, {
      headers: {
        'content-type': options.contentType,
        'content-length': String(size),
        'cache-control': CACHE_CONTROL,
        'x-upsert': 'true',
      },
      body: () => Readable.toWeb(createReadStream(filePath)) as unknown as ReadableStream,
      // At least ~50 KB/s, never less than 2 minutes.
      timeoutMs: Math.max(120_000, Math.ceil(size / 50_000) * 1000),
    });
    if (!res.ok) throw await this.failure(res, `upload of "${key}"`, key);
    await res.arrayBuffer().catch(() => undefined);
    if (options.move) await fs.rm(filePath, { force: true });
  }

  async exists(key: string): Promise<boolean> {
    assertSafeKey(key);
    const res = await this.send('HEAD', `/object/${this.bucketPath}/${encodePath(key)}`, { timeoutMs: 30_000 });
    if (res.ok) return true;
    if (res.status === 400 || res.status === 404) return false;
    throw await this.failure(res, `checking "${key}"`);
  }

  async getLocalFile(key: string, tmpDir: string): Promise<LocalFileHandle> {
    assertSafeKey(key);
    await fs.mkdir(tmpDir, { recursive: true });
    const res = await this.send('GET', `/object/${this.bucketPath}/${encodePath(key)}`, { timeoutMs: 6 * 3600_000 });
    if (!res.ok || !res.body) throw await this.failure(res, `download of "${key}"`);
    const dest = path.join(tmpDir, `${randomId(10)}-${path.posix.basename(key)}`);
    try {
      await pipeline(Readable.fromWeb(res.body as unknown as NodeReadableStream), createWriteStream(dest));
    } catch (err) {
      await fs.rm(dest, { force: true }).catch(() => undefined);
      throw new StorageRequestError(PROVIDER, null, `download of "${key}" failed: ${networkReason(err)}`);
    }
    return { path: dest, cleanup: () => fs.rm(dest, { force: true }) };
  }

  async delete(key: string): Promise<void> {
    assertSafeKey(key);
    await this.removeKeys([key]);
  }

  async deletePrefix(prefix: string): Promise<void> {
    assertSafePrefix(prefix);
    const keys = await this.listFiles(prefix.replace(/\/+$/, ''), 0);
    for (let i = 0; i < keys.length; i += DELETE_BATCH) await this.removeKeys(keys.slice(i, i + DELETE_BATCH));
  }

  async usageBytes(): Promise<number | null> {
    return null;
  }

  /** Makes sure the bucket exists and is public. Never throws: logs an actionable error instead. */
  async init(log: StorageLog): Promise<void> {
    const where = { storage: 'supabase', bucket: this.cfg.bucket, origin: this.publicOrigin };
    try {
      const res = await this.send('GET', `/bucket/${this.bucketPath}`, { timeoutMs: 10_000, attempts: 2 });
      if (res.ok) {
        const info = (await res.json().catch(() => ({}))) as BucketInfo;
        this.bucketLimit = typeof info.file_size_limit === 'number' && info.file_size_limit > 0 ? info.file_size_limit : null;
        if (info.public !== true) {
          const update = await this.send('PUT', `/bucket/${this.bucketPath}`, {
            json: { id: this.cfg.bucket, name: this.cfg.bucket, public: true },
            timeoutMs: 10_000,
            attempts: 2,
          });
          if (!update.ok) throw await this.failure(update, `making bucket "${this.cfg.bucket}" public`);
          await update.arrayBuffer().catch(() => undefined);
          log.info(where, 'Supabase bucket was private — made it public so the site can show the media');
        }
        const mimes = info.allowed_mime_types ?? [];
        if (mimes.length > 0 && !(['video/mp4', 'image/webp', 'image/jpeg'] as const).every((m) => mimeAllowed(mimes, m))) {
          log.warn(
            { ...where, allowedMimeTypes: mimes },
            'the Supabase bucket only allows some file types — clear "Allowed MIME types" in the bucket settings (videos and images must be allowed)',
          );
        }
      } else {
        const err = await this.readError(res);
        if (!isNotFound(err)) throw this.toError(err, `reading bucket "${this.cfg.bucket}"`);
        const create = await this.send('POST', '/bucket', {
          json: { id: this.cfg.bucket, name: this.cfg.bucket, public: true },
          timeoutMs: 10_000,
          attempts: 2,
        });
        if (!create.ok) {
          const createErr = await this.readError(create);
          // Created meanwhile by another instance → fine.
          if (!isDuplicate(createErr)) throw this.toError(createErr, `creating bucket "${this.cfg.bucket}"`);
        } else {
          await create.arrayBuffer().catch(() => undefined);
          log.info(where, 'created public Supabase bucket');
        }
      }
      log.info(
        { ...where, fileSizeLimitMB: this.bucketLimit ? Math.round((this.bucketLimit / 1024 / 1024) * 10) / 10 : null },
        'media storage: Supabase Storage',
      );
    } catch (err) {
      log.error({ ...where, reason: err instanceof Error ? err.message : String(err) }, initAdvice(err, this.publicOrigin));
    }
  }

  /* ───────────── internals ───────────── */

  private async removeKeys(keys: string[]): Promise<void> {
    if (keys.length === 0) return;
    const res = await this.send('DELETE', `/object/${this.bucketPath}`, { json: { prefixes: keys }, timeoutMs: 60_000 });
    if (!res.ok) throw await this.failure(res, `delete of ${keys.length} object(s)`);
    await res.arrayBuffer().catch(() => undefined);
  }

  /** Every object key below `folder` (no trailing slash), recursing into sub-folders (items whose id is null). */
  private async listFiles(folder: string, depth: number): Promise<string[]> {
    const files: string[] = [];
    const folders: string[] = [];
    for (let offset = 0; ; offset += this.listPageSize) {
      const res = await this.send('POST', `/object/list/${this.bucketPath}`, {
        json: { prefix: folder, limit: this.listPageSize, offset, sortBy: { column: 'name', order: 'asc' } },
        timeoutMs: 60_000,
      });
      if (!res.ok) throw await this.failure(res, `listing "${folder}/"`);
      const items = (await res.json()) as ListItem[];
      if (!Array.isArray(items)) throw new StorageRequestError(PROVIDER, res.status, `unexpected list response for "${folder}/"`);
      for (const item of items) {
        if (!item || typeof item.name !== 'string' || item.name === '' || item.name.includes('/')) continue;
        (item.id === null ? folders : files).push(`${folder}/${item.name}`);
      }
      if (items.length < this.listPageSize) break;
    }
    if (depth < MAX_LIST_DEPTH) {
      for (const sub of folders) files.push(...(await this.listFiles(sub, depth + 1)));
    }
    return files;
  }

  /** One request with bounded retries (network errors, 5xx, 429), honouring Retry-After. */
  private async send(method: string, pathname: string, options: SendOptions = {}): Promise<Response> {
    const attempts = Math.max(1, options.attempts ?? this.maxAttempts);
    const headers: Record<string, string> = {
      apikey: this.cfg.serviceKey,
      authorization: `Bearer ${this.cfg.serviceKey}`,
      ...(options.json !== undefined ? { 'content-type': 'application/json' } : {}),
      ...options.headers,
    };
    for (let attempt = 1; ; attempt++) {
      let res: Response;
      try {
        const body = options.json !== undefined ? JSON.stringify(options.json) : options.body?.();
        res = await fetch(`${this.api}${pathname}`, {
          method,
          headers,
          body: body ?? null,
          ...(body ? { duplex: 'half' as const } : {}),
          // Never follow redirects: the `apikey` header would travel to wherever they point.
          redirect: 'manual',
          signal: AbortSignal.timeout(options.timeoutMs ?? 60_000),
        });
      } catch (err) {
        if (attempt >= attempts) {
          throw new StorageRequestError(PROVIDER, null, `${method} ${this.describe(pathname)} failed: ${networkReason(err)}`);
        }
        await sleep(this.backoff(attempt));
        continue;
      }
      if ((res.status >= 500 || res.status === 429) && attempt < attempts) {
        const retryAfter = Number(res.headers.get('retry-after'));
        await res.arrayBuffer().catch(() => undefined);
        await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(30_000, retryAfter * 1000) : this.backoff(attempt));
        continue;
      }
      if (res.status >= 300 && res.status < 400) {
        await res.arrayBuffer().catch(() => undefined);
        throw new StorageRequestError(PROVIDER, res.status, `unexpected redirect for ${this.describe(pathname)} — check SUPABASE_URL`);
      }
      return res;
    }
  }

  private backoff(attempt: number): number {
    const base = Math.min(15_000, this.retryBaseMs * 2 ** (attempt - 1));
    return Math.round(base * (0.75 + Math.random() * 0.5));
  }

  /** Path for messages (no host, no credentials). */
  private describe(pathname: string): string {
    return `/storage/v1${pathname}`;
  }

  private async readError(res: Response): Promise<ErrorInfo> {
    let text = '';
    try {
      text = (await res.text()).slice(0, 4096);
    } catch {
      // ignore
    }
    let body: SupabaseErrorBody | null = null;
    try {
      const parsed = JSON.parse(text) as unknown;
      if (parsed && typeof parsed === 'object') body = parsed as SupabaseErrorBody;
    } catch {
      // not JSON
    }
    const raw = (body?.message ?? body?.error ?? text).toString().replace(/\s+/g, ' ').trim().slice(0, 200);
    return { status: res.status, body, detail: this.redact(raw) };
  }

  private async failure(res: Response, action: string, key?: string): Promise<Error> {
    return this.toError(await this.readError(res), action, key);
  }

  private toError(err: ErrorInfo, action: string, key?: string): Error {
    if (isTooLarge(err)) return new StorageObjectTooLargeError(PROVIDER, key ?? '');
    if (isAuth(err)) return new StorageAuthError(PROVIDER, err.status, err.detail);
    if (isNotFound(err) && /bucket/i.test(err.detail)) {
      return new StorageRequestError(
        PROVIDER,
        err.status,
        `${action} failed: bucket "${this.cfg.bucket}" not found (it is created at startup — check the startup logs)`,
      );
    }
    return new StorageRequestError(PROVIDER, err.status, `${action} failed (HTTP ${err.status}${err.detail ? `: ${err.detail}` : ''})`);
  }

  private redact(text: string): string {
    const key = this.cfg.serviceKey;
    return key && text.includes(key) ? text.split(key).join('[redacted]') : text;
  }
}

const codeOf = (err: ErrorInfo): string => String(err.body?.statusCode ?? '');

function isTooLarge(err: ErrorInfo): boolean {
  if (err.status === 413) return true;
  if (err.status !== 400) return false;
  return codeOf(err) === '413' || err.body?.code === 'EntityTooLarge' || /payload too large/i.test(err.body?.error ?? '');
}

function isAuth(err: ErrorInfo): boolean {
  if (err.status === 401 || err.status === 403) return true;
  if (err.status !== 400) return false;
  const code = codeOf(err);
  return code === '401' || code === '403' || err.body?.error === 'Unauthorized' || err.body?.code === 'InvalidJWT';
}

function isNotFound(err: ErrorInfo): boolean {
  if (err.status === 404) return true;
  if (err.status !== 400) return false;
  return codeOf(err) === '404' || /not.?found/i.test(`${err.body?.error ?? ''} ${err.body?.code ?? ''}`);
}

function isDuplicate(err: ErrorInfo): boolean {
  return err.status === 409 || codeOf(err) === '409' || /duplicate|already exists/i.test(`${err.body?.error ?? ''} ${err.detail}`);
}

function mimeAllowed(allowed: string[], mime: string): boolean {
  const [type] = mime.split('/');
  return allowed.some((a) => a === mime || a === `${type}/*` || a === '*/*' || a === '*');
}

function initAdvice(err: unknown, origin: string): string {
  if (err instanceof StorageAuthError) {
    return (
      'Supabase Storage rejected the key — set SUPABASE_SERVICE_ROLE_KEY to the service_role (or sb_secret_…) key of THIS project ' +
      '(Supabase → Project Settings → API Keys) and restart. Uploads will fail until then.'
    );
  }
  if (err instanceof StorageRequestError && err.status === null) {
    return (
      `cannot reach Supabase Storage at ${origin} — check SUPABASE_URL and the internet connection, and that the project is not paused ` +
      '(Free projects pause after a week without activity: open the Supabase dashboard and press "Restore"). Uploads will fail until then.'
    );
  }
  return (
    'Supabase Storage is not ready — if the project is paused, restore it from the Supabase dashboard; otherwise check SUPABASE_URL, ' +
    'SUPABASE_SERVICE_ROLE_KEY and SUPABASE_STORAGE_BUCKET. Uploads will fail until then.'
  );
}
