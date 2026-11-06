/**
 * A faithful in-memory mock of the Supabase Storage REST API (`/storage/v1/*`), for tests and local manual runs
 * (Supabase itself is not reachable from CI / the sandbox).
 *
 * Mirrors the hosted behaviour the driver relies on:
 * - API gateway: `apikey` must be a known key (401 `{"message":"Invalid API key"}` otherwise); the role comes from
 *   `Authorization: Bearer …` (service_role / sb_secret → full access, anon / sb_publishable → RLS applies, so
 *   writes fail with 400 `{"statusCode":"403","error":"Unauthorized","message":"new row violates row-level security policy"}`).
 * - Errors use Supabase's body shape `{ statusCode: "<code>", error, message }`; "not found" answers HTTP 400 by default
 *   (legacy hosted behaviour) or 404 (`notFoundStatus`).
 * - Buckets: GET/POST/PUT; objects: upload (x-upsert), HEAD, GET, DELETE (prefixes), list (folders have id null,
 *   limit/offset pagination), public GET/HEAD with Range and `access-control-allow-origin: *`.
 * - Per-file size limit (project-wide `maxObjectBytes`, or the bucket's file_size_limit) → `Payload too large`.
 */
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

export interface MockBucket {
  id: string;
  name: string;
  owner: string;
  public: boolean;
  file_size_limit: number | null;
  allowed_mime_types: string[] | null;
  created_at: string;
  updated_at: string;
}

export interface MockObject {
  data: Buffer;
  contentType: string;
  cacheControl: string | null;
  id: string;
  etag: string;
  createdAt: string;
  updatedAt: string;
}

export interface MockRequest {
  method: string;
  /** Path without the query string, e.g. `/storage/v1/object/media/videos/x/video.mp4`. */
  path: string;
  headers: http.IncomingHttpHeaders;
  status: number;
  /** Bytes received in the request body. */
  bodyBytes: number;
}

export interface MockSupabaseOptions {
  /** Project ref embedded in the generated JWT keys. */
  ref?: string;
  /** Project-wide per-file limit (Supabase Free plan: 50 MB). Default 50 MiB. */
  maxObjectBytes?: number;
  /** HTTP status of "Payload too large" answers (the JSON statusCode is "413" either way). Default 413. */
  tooLargeStatus?: 400 | 413;
  /** HTTP status of "not found" answers (JSON statusCode "404"). Default 400, like the hosted legacy API. */
  notFoundStatus?: 400 | 404;
}

interface Fault {
  method?: string;
  pathIncludes?: string;
  status?: number;
  retryAfter?: number;
  drop?: boolean;
  remaining: number;
}

const b64url = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');

/** An unsigned-but-well-formed Supabase JWT (the mock only compares whole tokens). */
export function makeSupabaseJwt(payload: Record<string, unknown>): string {
  return `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url({ iss: 'supabase', iat: 1_700_000_000, exp: 2_100_000_000, ...payload })}.${randomBytes(32).toString('base64url')}`;
}

const SUPABASE_BUCKET_NAME_RE = /^(\w|!|-|\.|\*|'|\(|\)| |&|\$|@|=|;|:|\+|,|\?)*$/;

export class MockSupabase {
  readonly ref: string;
  readonly serviceKey: string;
  readonly anonKey: string;
  readonly secretKey: string;
  readonly publishableKey: string;
  readonly buckets = new Map<string, MockBucket>();
  readonly objects = new Map<string, Map<string, MockObject>>();
  readonly requests: MockRequest[] = [];
  maxObjectBytes: number;
  tooLargeStatus: 400 | 413;
  notFoundStatus: 400 | 404;
  private readonly server: http.Server;
  private faults: Fault[] = [];
  private address = '';

  constructor(options: MockSupabaseOptions = {}) {
    this.ref = options.ref ?? randomBytes(10).toString('hex');
    this.serviceKey = makeSupabaseJwt({ ref: this.ref, role: 'service_role' });
    this.anonKey = makeSupabaseJwt({ ref: this.ref, role: 'anon' });
    this.secretKey = `sb_secret_${randomBytes(16).toString('base64url')}`;
    this.publishableKey = `sb_publishable_${randomBytes(16).toString('base64url')}`;
    this.maxObjectBytes = options.maxObjectBytes ?? 50 * 1024 * 1024;
    this.tooLargeStatus = options.tooLargeStatus ?? 413;
    this.notFoundStatus = options.notFoundStatus ?? 400;
    this.server = http.createServer((req, res) => {
      this.handle(req, res).catch((err: unknown) => {
        if (!res.headersSent) this.json(res, 500, { statusCode: '500', error: 'Internal', message: String(err) });
        else res.destroy();
      });
    });
  }

  /** `http://127.0.0.1:<port>` — use as SUPABASE_URL. */
  get url(): string {
    return this.address;
  }

  async start(port = 0, host = '127.0.0.1'): Promise<this> {
    await new Promise<void>((resolve) => this.server.listen(port, host, resolve));
    const { port: actual } = this.server.address() as AddressInfo;
    this.address = `http://${host}:${actual}`;
    return this;
  }

  async close(): Promise<void> {
    this.server.closeAllConnections();
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }

  /** The next `count` matching requests fail with `status` (default 503) or a dropped connection. */
  failNext(count: number, fault: Omit<Fault, 'remaining'> = {}): void {
    this.faults.push({ ...fault, remaining: count });
  }

  createBucket(id: string, init: Partial<Omit<MockBucket, 'id' | 'name'>> = {}): MockBucket {
    const now = new Date().toISOString();
    const bucket: MockBucket = {
      id,
      name: id,
      owner: '',
      public: false,
      file_size_limit: null,
      allowed_mime_types: null,
      created_at: now,
      updated_at: now,
      ...init,
    };
    this.buckets.set(id, bucket);
    if (!this.objects.has(id)) this.objects.set(id, new Map());
    return bucket;
  }

  putObject(bucket: string, key: string, data: Buffer | string, contentType = 'application/octet-stream'): void {
    if (!this.buckets.has(bucket)) this.createBucket(bucket);
    const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
    const now = new Date().toISOString();
    this.objects.get(bucket)!.set(key, {
      data: buf,
      contentType,
      cacheControl: 'max-age=3600',
      id: randomUUID(),
      etag: `"${createHash('md5').update(buf).digest('hex')}"`,
      createdAt: now,
      updatedAt: now,
    });
  }

  object(bucket: string, key: string): MockObject | undefined {
    return this.objects.get(bucket)?.get(key);
  }

  keys(bucket: string): string[] {
    return [...(this.objects.get(bucket)?.keys() ?? [])].sort();
  }

  /** Public URL of an object, as Supabase builds it. */
  publicUrl(bucket: string, key: string): string {
    return `${this.address}/storage/v1/object/public/${bucket}/${key}`;
  }

  /* ───────────── request handling ───────────── */

  private async handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const method = (req.method ?? 'GET').toUpperCase();
    const path = (req.url ?? '/').split('?')[0] ?? '/';
    const record: MockRequest = { method, path, headers: req.headers, status: 0, bodyBytes: 0 };
    this.requests.push(record);
    res.on('finish', () => {
      record.status = res.statusCode;
    });

    const fault = this.faults.find(
      (f) => f.remaining > 0 && (!f.method || f.method === method) && (!f.pathIncludes || path.includes(f.pathIncludes)),
    );
    if (fault) {
      fault.remaining--;
      if (fault.drop) {
        req.socket.destroy();
        return;
      }
      await this.drain(req, record);
      const status = fault.status ?? 503;
      if (fault.retryAfter !== undefined) res.setHeader('retry-after', String(fault.retryAfter));
      this.json(res, status, { statusCode: String(status), error: 'Service Unavailable', message: 'injected failure' });
      return;
    }

    if (!path.startsWith('/storage/v1/')) {
      await this.drain(req, record);
      this.json(res, 404, { message: 'no Route matched with those values' });
      return;
    }
    const route = path.slice('/storage/v1'.length);

    // Public objects need no key at all (that is what makes the URLs usable in <img>/<video>).
    const publicMatch = /^\/object\/public\/([^/]+)\/(.+)$/.exec(route);
    if (publicMatch && (method === 'GET' || method === 'HEAD')) {
      await this.drain(req, record);
      this.servePublic(req, res, method, decodeURIComponent(publicMatch[1]!), decodeSegments(publicMatch[2]!));
      return;
    }

    // API gateway (Kong): a known apikey is required.
    const apikey = header(req, 'apikey');
    const known = [this.serviceKey, this.anonKey, this.secretKey, this.publishableKey];
    if (!apikey) {
      await this.drain(req, record);
      this.json(res, 401, { message: 'No API key found in request' });
      return;
    }
    if (!known.includes(apikey)) {
      await this.drain(req, record);
      this.json(res, 401, { message: 'Invalid API key' });
      return;
    }
    const auth = header(req, 'authorization');
    if (!auth) {
      await this.drain(req, record);
      this.json(res, 400, { statusCode: '400', error: 'Error', message: "headers must have required property 'authorization'" });
      return;
    }
    const token = /^Bearer (.+)$/i.exec(auth)?.[1] ?? '';
    if (!known.includes(token)) {
      await this.drain(req, record);
      this.json(res, 400, { statusCode: '403', error: 'Unauthorized', message: 'invalid signature' });
      return;
    }
    const role = token === this.serviceKey || token === this.secretKey ? 'service_role' : 'anon';

    // ── buckets ──
    if (route === '/bucket' && method === 'GET') {
      await this.drain(req, record);
      this.json(res, 200, role === 'service_role' ? [...this.buckets.values()] : []);
      return;
    }
    if (route === '/bucket' && method === 'POST') {
      const body = await this.readJson(req, record);
      if (role !== 'service_role') return this.rls(res);
      const id = typeof body.id === 'string' ? body.id : typeof body.name === 'string' ? body.name : '';
      if (!id || id.length > 100 || !SUPABASE_BUCKET_NAME_RE.test(id)) {
        this.json(res, 400, { statusCode: '400', error: 'Invalid Input', message: 'Bucket name invalid' });
        return;
      }
      if (this.buckets.has(id)) {
        this.json(res, 400, { statusCode: '409', error: 'Duplicate', message: 'The resource already exists' });
        return;
      }
      this.createBucket(id, {
        public: body.public === true,
        file_size_limit: typeof body.file_size_limit === 'number' ? body.file_size_limit : null,
        allowed_mime_types: Array.isArray(body.allowed_mime_types) ? (body.allowed_mime_types as string[]) : null,
      });
      this.json(res, 200, { name: id });
      return;
    }
    const bucketMatch = /^\/bucket\/([^/]+)$/.exec(route);
    if (bucketMatch) {
      const id = decodeURIComponent(bucketMatch[1]!);
      const bucket = role === 'service_role' ? this.buckets.get(id) : undefined;
      if (method === 'GET') {
        await this.drain(req, record);
        if (!bucket) return this.notFound(res, 'Bucket not found');
        this.json(res, 200, bucket);
        return;
      }
      if (method === 'PUT') {
        const body = await this.readJson(req, record);
        if (role !== 'service_role') return this.rls(res);
        if (!bucket) return this.notFound(res, 'Bucket not found');
        if (typeof body.public === 'boolean') bucket.public = body.public;
        if ('file_size_limit' in body) bucket.file_size_limit = typeof body.file_size_limit === 'number' ? body.file_size_limit : null;
        if ('allowed_mime_types' in body) {
          bucket.allowed_mime_types = Array.isArray(body.allowed_mime_types) ? (body.allowed_mime_types as string[]) : null;
        }
        bucket.updated_at = new Date().toISOString();
        this.json(res, 200, { message: 'Successfully updated' });
        return;
      }
    }

    // ── objects ──
    const listMatch = /^\/object\/list\/([^/]+)$/.exec(route);
    if (listMatch && method === 'POST') {
      const body = await this.readJson(req, record);
      const id = decodeURIComponent(listMatch[1]!);
      if (role !== 'service_role') {
        this.json(res, 200, []);
        return;
      }
      if (!this.buckets.has(id)) return this.notFound(res, 'Bucket not found');
      this.json(res, 200, this.list(id, body));
      return;
    }

    const bulkDelete = /^\/object\/([^/]+)$/.exec(route);
    if (bulkDelete && method === 'DELETE') {
      const body = await this.readJson(req, record);
      const id = decodeURIComponent(bulkDelete[1]!);
      const prefixes = Array.isArray(body.prefixes) ? (body.prefixes as unknown[]).filter((p): p is string => typeof p === 'string') : null;
      if (!prefixes || prefixes.length === 0) {
        this.json(res, 400, { statusCode: '400', error: 'Error', message: 'body/prefixes must NOT have fewer than 1 items' });
        return;
      }
      if (prefixes.length > 1000) {
        this.json(res, 400, { statusCode: '400', error: 'Error', message: 'body/prefixes must NOT have more than 1000 items' });
        return;
      }
      if (role !== 'service_role') {
        this.json(res, 200, []);
        return;
      }
      const store = this.objects.get(id);
      if (!store) return this.notFound(res, 'Bucket not found');
      const deleted = [];
      for (const key of prefixes) {
        const obj = store.get(key);
        if (!obj) continue;
        store.delete(key);
        deleted.push({ bucket_id: id, name: key, id: obj.id, updated_at: obj.updatedAt, created_at: obj.createdAt, metadata: this.metadata(obj) });
      }
      this.json(res, 200, deleted);
      return;
    }

    const objectMatch = /^\/object\/(?:authenticated\/)?([^/]+)\/(.+)$/.exec(route);
    if (objectMatch) {
      const id = decodeURIComponent(objectMatch[1]!);
      const key = decodeSegments(objectMatch[2]!);
      if (method === 'POST' || method === 'PUT') return this.upload(req, res, record, role, id, key, method);
      await this.drain(req, record);
      const obj = role === 'service_role' ? this.objects.get(id)?.get(key) : undefined;
      if (method === 'HEAD') {
        if (!obj) {
          res.writeHead(this.notFoundStatus).end();
          return;
        }
        res.writeHead(200, this.objectHeaders(obj, obj.data.length)).end();
        return;
      }
      if (method === 'GET') {
        if (!obj) return this.notFound(res, 'Object not found', 'not_found');
        res.writeHead(200, this.objectHeaders(obj, obj.data.length)).end(obj.data);
        return;
      }
      if (method === 'DELETE') {
        if (!obj) return this.notFound(res, 'Object not found', 'not_found');
        this.objects.get(id)!.delete(key);
        this.json(res, 200, { message: 'Successfully deleted' });
        return;
      }
    }

    await this.drain(req, record);
    this.json(res, 404, { statusCode: '404', error: 'Not Found', message: `Route ${method}:${path} not found` });
  }

  private async upload(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    record: MockRequest,
    role: string,
    bucketId: string,
    key: string,
    method: string,
  ): Promise<void> {
    const bucket = this.buckets.get(bucketId);
    const limit = Math.min(this.maxObjectBytes, bucket?.file_size_limit ?? Number.POSITIVE_INFINITY);
    // Read the stream like the real server does, but stop keeping bytes once over the limit.
    const chunks: Buffer[] = [];
    let total = 0;
    for await (const chunk of req as AsyncIterable<Buffer>) {
      total += chunk.length;
      if (total <= limit) chunks.push(chunk);
    }
    record.bodyBytes = total;
    if (role !== 'service_role') return this.rls(res);
    if (!bucket) return this.notFound(res, 'Bucket not found');
    if (total > limit) {
      this.json(res, this.tooLargeStatus, {
        statusCode: '413',
        code: 'EntityTooLarge',
        error: 'Payload too large',
        message: 'The object exceeded the maximum allowed size',
      });
      return;
    }
    const contentType = header(req, 'content-type') ?? 'text/plain;charset=UTF-8';
    if (bucket.allowed_mime_types?.length && !bucket.allowed_mime_types.some((m) => m === contentType || (m.endsWith('/*') && contentType.startsWith(m.slice(0, -1))))) {
      this.json(res, 400, { statusCode: '415', error: 'invalid_mime_type', message: `mime type ${contentType} is not supported` });
      return;
    }
    const store = this.objects.get(bucketId)!;
    const existing = store.get(key);
    const upsert = header(req, 'x-upsert') === 'true';
    if (method === 'POST' && existing && !upsert) {
      this.json(res, 400, { statusCode: '409', error: 'Duplicate', message: 'The resource already exists' });
      return;
    }
    if (method === 'PUT' && !existing) return this.notFound(res, 'Object not found', 'not_found');
    const data = Buffer.concat(chunks);
    const now = new Date().toISOString();
    const obj: MockObject = {
      data,
      contentType,
      cacheControl: header(req, 'cache-control') ?? 'max-age=3600',
      id: existing?.id ?? randomUUID(),
      etag: `"${createHash('md5').update(data).digest('hex')}"`,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    store.set(key, obj);
    this.json(res, 200, { Id: obj.id, Key: `${bucketId}/${key}` });
  }

  private servePublic(req: http.IncomingMessage, res: http.ServerResponse, method: string, bucketId: string, key: string): void {
    const bucket = this.buckets.get(bucketId);
    if (!bucket || !bucket.public) return this.notFound(res, 'Bucket not found');
    const obj = this.objects.get(bucketId)?.get(key);
    if (!obj) return this.notFound(res, 'Object not found', 'not_found');
    const size = obj.data.length;
    const range = header(req, 'range');
    let start = 0;
    let end = size - 1;
    let status = 200;
    if (range) {
      const m = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
      if (!m || (m[1] === '' && m[2] === '')) {
        res.writeHead(416, { 'content-range': `bytes */${size}` }).end();
        return;
      }
      if (m[1] === '') {
        start = Math.max(0, size - Number(m[2]));
      } else {
        start = Number(m[1]);
        end = m[2] === '' ? size - 1 : Math.min(size - 1, Number(m[2]));
      }
      if (start > end || start >= size) {
        res.writeHead(416, { 'content-range': `bytes */${size}` }).end();
        return;
      }
      status = 206;
    }
    const headers = this.objectHeaders(obj, end - start + 1);
    if (status === 206) headers['content-range'] = `bytes ${start}-${end}/${size}`;
    res.writeHead(status, headers);
    if (method === 'HEAD') res.end();
    else res.end(obj.data.subarray(start, end + 1));
  }

  private list(bucketId: string, body: Record<string, unknown>): unknown[] {
    let prefix = typeof body.prefix === 'string' ? body.prefix : '';
    // Like Supabase's searchObjects: "assuming prefix is always a folder".
    if (prefix.length > 0 && !prefix.endsWith('/')) prefix = `${prefix}/`;
    const limit = typeof body.limit === 'number' ? body.limit : 100;
    const offset = typeof body.offset === 'number' ? body.offset : 0;
    const search = typeof body.search === 'string' ? body.search : '';
    const sortBy = (body.sortBy ?? {}) as { column?: string; order?: string };
    const store = this.objects.get(bucketId)!;
    const folders = new Set<string>();
    const files: { name: string; obj: MockObject }[] = [];
    for (const [key, obj] of store) {
      if (!key.startsWith(prefix)) continue;
      const rest = key.slice(prefix.length);
      const slash = rest.indexOf('/');
      if (slash >= 0) folders.add(rest.slice(0, slash));
      else files.push({ name: rest, obj });
    }
    const entries: { name: string; item: Record<string, unknown> }[] = [
      ...[...folders].map((name) => ({
        name,
        item: { name, id: null, updated_at: null, created_at: null, last_accessed_at: null, metadata: null },
      })),
      ...files.map(({ name, obj }) => ({
        name,
        item: { name, id: obj.id, updated_at: obj.updatedAt, created_at: obj.createdAt, last_accessed_at: obj.updatedAt, metadata: this.metadata(obj) },
      })),
    ].filter((e) => !search || e.name.includes(search));
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    if (sortBy.order === 'desc') entries.reverse();
    return entries.slice(offset, offset + limit).map((e) => e.item);
  }

  private metadata(obj: MockObject): Record<string, unknown> {
    return {
      eTag: obj.etag,
      size: obj.data.length,
      mimetype: obj.contentType,
      cacheControl: obj.cacheControl,
      lastModified: obj.updatedAt,
      contentLength: obj.data.length,
      httpStatusCode: 200,
    };
  }

  private objectHeaders(obj: MockObject, length: number): Record<string, string> {
    return {
      'content-type': obj.contentType,
      'content-length': String(length),
      'cache-control': obj.cacheControl ?? 'no-cache',
      etag: obj.etag,
      'last-modified': new Date(obj.updatedAt).toUTCString(),
      'accept-ranges': 'bytes',
      'access-control-allow-origin': '*',
      'access-control-expose-headers': 'Content-Length, Content-Range, Accept-Ranges, ETag',
    };
  }

  private notFound(res: http.ServerResponse, message: string, error = message): void {
    this.json(res, this.notFoundStatus, { statusCode: '404', error, message });
  }

  private rls(res: http.ServerResponse): void {
    this.json(res, 400, { statusCode: '403', error: 'Unauthorized', message: 'new row violates row-level security policy' });
  }

  private json(res: http.ServerResponse, status: number, body: unknown): void {
    const text = JSON.stringify(body);
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': String(Buffer.byteLength(text)) });
    res.end(text);
  }

  private async drain(req: http.IncomingMessage, record: MockRequest): Promise<Buffer> {
    const chunks: Buffer[] = [];
    for await (const chunk of req as AsyncIterable<Buffer>) chunks.push(chunk);
    const buf = Buffer.concat(chunks);
    record.bodyBytes = buf.length;
    return buf;
  }

  private async readJson(req: http.IncomingMessage, record: MockRequest): Promise<Record<string, unknown>> {
    const buf = await this.drain(req, record);
    try {
      const parsed = JSON.parse(buf.toString('utf8')) as unknown;
      return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }
}

function header(req: http.IncomingMessage, name: string): string | undefined {
  const value = req.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

const decodeSegments = (p: string): string => p.split('/').map(decodeURIComponent).join('/');

export async function startMockSupabase(options: MockSupabaseOptions = {}): Promise<MockSupabase> {
  return new MockSupabase(options).start();
}
