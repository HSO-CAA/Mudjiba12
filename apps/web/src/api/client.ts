import type {
  ApiErrorBody,
  HomeData,
  InquiryCreated,
  InquiryInput,
  PlaceDetail,
  PlaceSummary,
  PublicPlan,
  PublicSite,
} from '@s5y/shared';

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

  get isNotFound(): boolean {
    return this.status === 404;
  }
}

const NETWORK_MESSAGE = 'تعذّر الاتصال بالخادم. تأكد من الإنترنت وحاول مرة ثانية.';
const GENERIC_MESSAGE = 'صار خطأ غير متوقع. حاول مرة ثانية.';

function isErrorBody(value: unknown): value is ApiErrorBody {
  return (
    typeof value === 'object' &&
    value !== null &&
    'error' in value &&
    typeof (value as { error: unknown }).error === 'object' &&
    (value as { error: { message?: unknown } }).error !== null &&
    typeof (value as { error: { message?: unknown } }).error.message === 'string'
  );
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      credentials: 'same-origin',
      ...init,
      headers: {
        Accept: 'application/json',
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...init.headers,
      },
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    throw new ApiError(0, 'NETWORK_ERROR', NETWORK_MESSAGE);
  }

  if (res.status === 204) return undefined as T;

  let data: unknown = null;
  const text = await res.text();
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }

  if (!res.ok) {
    if (isErrorBody(data)) throw new ApiError(res.status, String(data.error.code), data.error.message, data.error.details);
    throw new ApiError(res.status, res.status === 404 ? 'NOT_FOUND' : 'INTERNAL_ERROR', GENERIC_MESSAGE);
  }
  return data as T;
}

export const api = {
  home: (signal?: AbortSignal) => request<HomeData>('/api/public/home', { signal }),
  site: (signal?: AbortSignal) => request<PublicSite>('/api/public/site', { signal }),
  places: (signal?: AbortSignal) => request<PlaceSummary[]>('/api/public/places', { signal }),
  place: (slug: string, signal?: AbortSignal) =>
    request<PlaceDetail>(`/api/public/places/${encodeURIComponent(slug)}`, { signal }),
  plans: (signal?: AbortSignal) => request<PublicPlan[]>('/api/public/plans', { signal }),
  createInquiry: (input: InquiryInput) =>
    request<InquiryCreated>('/api/public/inquiries', { method: 'POST', body: JSON.stringify(input) }),
};

/** Maps a VALIDATION_ERROR `details` (zod issues) to `{ field: message }`. */
export function fieldErrors(error: unknown): Record<string, string> {
  if (!(error instanceof ApiError) || !Array.isArray(error.details)) return {};
  const out: Record<string, string> = {};
  for (const issue of error.details as unknown[]) {
    if (typeof issue !== 'object' || issue === null) continue;
    const { path, message } = issue as { path?: unknown; message?: unknown };
    const key = Array.isArray(path) && path.length ? String(path[0]) : null;
    if (key && typeof message === 'string' && !out[key]) out[key] = message;
  }
  return out;
}
