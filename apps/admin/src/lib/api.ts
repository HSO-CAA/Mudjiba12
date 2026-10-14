import type { ApiErrorBody } from '@s5y/shared';

/** Every admin endpoint lives under this prefix (root-relative so the injected <base href> never affects it). */
export const ADMIN_API = '/api/admin';

const SAFE_METHODS = new Set(['GET', 'HEAD']);

export interface FieldIssue {
  path: (string | number)[];
  message: string;
}

/** A failed API call. `message` is always user-facing Arabic (from the server, or a client fallback). */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }

  static fromResponse(status: number, body: unknown, headers?: Headers): ApiError {
    if (isErrorBody(body)) {
      const { code, message, details } = body.error;
      return new ApiError(status, String(code), message || fallbackMessage(status), details);
    }
    const retryAfter = headers?.get('retry-after');
    const details = retryAfter && Number.isFinite(Number(retryAfter)) ? { retryAfterSec: Number(retryAfter) } : undefined;
    return new ApiError(status, codeForStatus(status), fallbackMessage(status), details);
  }

  static network(): ApiError {
    return new ApiError(0, 'NETWORK_ERROR', 'تعذّر الاتصال بالخادم، تأكد من الإنترنت وحاول مرة ثانية');
  }

  get isNetwork(): boolean {
    return this.status === 0;
  }

  /** Zod-style issues from a VALIDATION_ERROR, flattened to `{ "field.path": message }` (first message wins). */
  get fieldErrors(): Record<string, string> {
    const out: Record<string, string> = {};
    if (!Array.isArray(this.details)) return out;
    for (const issue of this.details as unknown[]) {
      if (!issue || typeof issue !== 'object') continue;
      const { path, message } = issue as Partial<FieldIssue>;
      if (!Array.isArray(path) || typeof message !== 'string') continue;
      const key = path.join('.');
      if (key && !(key in out)) out[key] = message;
    }
    return out;
  }

  /** Seconds to wait before retrying (429), when the server says so. */
  get retryAfterSec(): number | null {
    const d = this.details as { retryAfterSec?: unknown } | undefined;
    return d && typeof d.retryAfterSec === 'number' ? d.retryAfterSec : null;
  }

  /** `details.offset` of an OFFSET_MISMATCH error. */
  get serverOffset(): number | null {
    const d = this.details as { offset?: unknown } | undefined;
    return d && typeof d.offset === 'number' ? d.offset : null;
  }
}

function isErrorBody(body: unknown): body is ApiErrorBody {
  return (
    !!body &&
    typeof body === 'object' &&
    'error' in body &&
    !!(body as ApiErrorBody).error &&
    typeof (body as ApiErrorBody).error.message === 'string'
  );
}

function codeForStatus(status: number): string {
  switch (status) {
    case 400:
      return 'BAD_REQUEST';
    case 401:
      return 'UNAUTHORIZED';
    case 403:
      return 'FORBIDDEN';
    case 404:
      return 'NOT_FOUND';
    case 409:
      return 'CONFLICT';
    case 413:
      return 'PAYLOAD_TOO_LARGE';
    case 415:
      return 'UNSUPPORTED_MEDIA_TYPE';
    case 423:
      return 'ACCOUNT_LOCKED';
    case 429:
      return 'RATE_LIMITED';
    default:
      return 'INTERNAL_ERROR';
  }
}

function fallbackMessage(status: number): string {
  if (status === 401) return 'انتهت الجلسة، سجّل دخول مرة ثانية';
  if (status === 403) return 'ما عندك صلاحية لهذا الطلب';
  if (status === 404) return 'العنصر المطلوب غير موجود';
  if (status === 413) return 'حجم الملف أكبر من المسموح';
  if (status === 429) return 'طلبات كثيرة خلال وقت قصير، حاول بعد شوي';
  if (status >= 500) return 'صار خطأ بالخادم، حاول مرة ثانية';
  return 'تعذّر تنفيذ الطلب';
}

export const isAbortError = (error: unknown): boolean =>
  error instanceof DOMException ? error.name === 'AbortError' : (error as { name?: string } | null)?.name === 'AbortError';

/* ─────────────────────────── 401 handling ─────────────────────────── */

type UnauthorizedHandler = () => void;
let unauthorizedHandler: UnauthorizedHandler | null = null;

/** Registered once by the app shell: clears the session cache and sends the user to the login page. */
export function setUnauthorizedHandler(handler: UnauthorizedHandler | null): void {
  unauthorizedHandler = handler;
}

export function notifyUnauthorized(): void {
  unauthorizedHandler?.();
}

/* ─────────────────────────── fetch wrapper ─────────────────────────── */

export type QueryValue = string | number | boolean | null | undefined;

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  /** JSON-serialised unless it is a Blob/ArrayBuffer/FormData (sent as-is). */
  body?: unknown;
  query?: Record<string, QueryValue>;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  /** Don't trigger the global "go to login" redirect on 401 (login form, session probe). */
  skipAuthRedirect?: boolean;
}

export function buildUrl(path: string, query?: Record<string, QueryValue>): string {
  const url = `${ADMIN_API}${path}`;
  if (!query) return url;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    params.set(key, String(value));
  }
  const qs = params.toString();
  return qs ? `${url}?${qs}` : url;
}

/** Headers every admin request carries; non-GETs add the CSRF header required by the API. */
export function adminHeaders(method: string, extra?: Record<string, string>): Headers {
  const headers = new Headers(extra);
  headers.set('Accept', 'application/json');
  if (!SAFE_METHODS.has(method.toUpperCase())) headers.set('X-S5Y-Admin', '1');
  return headers;
}

const isRawBody = (body: unknown): body is BodyInit =>
  body instanceof Blob || body instanceof ArrayBuffer || ArrayBuffer.isView(body) || body instanceof FormData;

export async function readBody(response: Response): Promise<unknown> {
  const text = await response.text().catch(() => '');
  if (!text) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const method = options.method ?? 'GET';
  const headers = adminHeaders(method, options.headers);
  let body: BodyInit | undefined;
  if (options.body !== undefined) {
    if (isRawBody(options.body)) {
      body = options.body;
    } else {
      headers.set('Content-Type', 'application/json');
      body = JSON.stringify(options.body);
    }
  }

  let response: Response;
  try {
    response = await fetch(buildUrl(path, options.query), {
      method,
      headers,
      body,
      credentials: 'same-origin',
      cache: 'no-store',
      signal: options.signal,
    });
  } catch (error) {
    if (isAbortError(error)) throw error;
    throw ApiError.network();
  }

  if (response.status === 204) return undefined as T;
  const data = await readBody(response);
  if (!response.ok) {
    const error = ApiError.fromResponse(response.status, data, response.headers);
    if (response.status === 401 && !options.skipAuthRedirect) notifyUnauthorized();
    throw error;
  }
  return data as T;
}

/** Best-effort user-facing message for any thrown value. */
export function errorMessage(error: unknown, fallback = 'صار خطأ غير متوقع، حاول مرة ثانية'): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error && error.message && /[؀-ۿ]/.test(error.message)) return error.message;
  return fallback;
}
