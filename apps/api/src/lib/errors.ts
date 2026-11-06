import type { ApiErrorCode } from '@s5y/shared';
import { StorageAuthError, StorageObjectTooLargeError, StorageRequestError } from '../storage/types.js';

/** A known, user-facing error. `message` is short Arabic text shown in the UI. */
export class AppError extends Error {
  readonly statusCode: number;
  readonly code: ApiErrorCode | (string & {});
  readonly details: unknown;

  constructor(statusCode: number, code: ApiErrorCode | (string & {}), message: string, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (message = 'الطلب غير صالح', details?: unknown): AppError =>
  new AppError(400, 'BAD_REQUEST', message, details);

export const unauthorized = (message = 'لازم تسجّل دخول أولاً'): AppError => new AppError(401, 'UNAUTHORIZED', message);

export const forbidden = (message = 'ما عندك صلاحية لهذا الطلب'): AppError => new AppError(403, 'FORBIDDEN', message);

export const notFound = (message = 'العنصر المطلوب غير موجود'): AppError => new AppError(404, 'NOT_FOUND', message);

export const conflict = (message = 'يوجد تعارض مع بيانات موجودة', details?: unknown): AppError =>
  new AppError(409, 'CONFLICT', message, details);

export const unsupportedMediaType = (message = 'نوع الملف غير مدعوم'): AppError =>
  new AppError(415, 'UNSUPPORTED_MEDIA_TYPE', message);

export const payloadTooLarge = (message = 'حجم الطلب أكبر من المسموح'): AppError =>
  new AppError(413, 'PAYLOAD_TOO_LARGE', message);

/** Builds a VALIDATION_ERROR shaped like zod issues so forms can map it to a field. */
export const fieldError = (field: string, message: string): AppError =>
  new AppError(400, 'VALIDATION_ERROR', message, [{ path: field.split('.'), code: 'custom', message }]);

/** Arabic messages for remote-storage failures (Supabase / S3) shown in the dashboard. */
export const STORAGE_MESSAGES = {
  imageTooLarge: 'الصورة أكبر من الحد المسموح بالتخزين السحابي (Supabase) — صغّر حجمها وارفعها مرة ثانية',
  fileTooLarge: 'الملف أكبر من الحد المسموح بخطة Supabase (50MB لكل ملف بالخطة المجانية) — قصّر الفيديو أو رقّي الخطة',
  auth: 'التخزين السحابي (Supabase) رفض الطلب — تأكد إن SUPABASE_SERVICE_ROLE_KEY هو مفتاح service_role السري لنفس المشروع',
  unavailable: 'تعذّر الوصول للتخزين السحابي — تأكد من الاتصال وإن مشروع Supabase شغّال (مو موقوف) وحاول مرة ثانية',
} as const;

/** Maps a storage driver error to a user-facing AppError (or null when `err` is not a storage error). */
export function storageAppError(err: unknown, tooLargeMessage: string = STORAGE_MESSAGES.fileTooLarge): AppError | null {
  if (err instanceof StorageObjectTooLargeError) return payloadTooLarge(tooLargeMessage);
  if (err instanceof StorageAuthError) return new AppError(502, 'STORAGE_ERROR', STORAGE_MESSAGES.auth);
  if (err instanceof StorageRequestError) return new AppError(502, 'STORAGE_ERROR', STORAGE_MESSAGES.unavailable);
  return null;
}
