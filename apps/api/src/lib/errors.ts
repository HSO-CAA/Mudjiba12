import type { ApiErrorCode } from '@s5y/shared';

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
