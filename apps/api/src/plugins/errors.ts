import { Prisma } from '@prisma/client';
import type { ApiErrorBody } from '@s5y/shared';
import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';
import { AppError } from '../lib/errors.js';

const STATUS_DEFAULTS: Record<number, { code: string; message: string }> = {
  400: { code: 'BAD_REQUEST', message: 'الطلب غير صالح' },
  401: { code: 'UNAUTHORIZED', message: 'لازم تسجّل دخول أولاً' },
  403: { code: 'FORBIDDEN', message: 'ما عندك صلاحية لهذا الطلب' },
  404: { code: 'NOT_FOUND', message: 'العنصر المطلوب غير موجود' },
  405: { code: 'BAD_REQUEST', message: 'طريقة الطلب غير مدعومة' },
  406: { code: 'UNSUPPORTED_MEDIA_TYPE', message: 'نوع المحتوى غير مدعوم' },
  409: { code: 'CONFLICT', message: 'يوجد تعارض مع بيانات موجودة' },
  413: { code: 'PAYLOAD_TOO_LARGE', message: 'حجم الطلب أكبر من المسموح' },
  415: { code: 'UNSUPPORTED_MEDIA_TYPE', message: 'نوع المحتوى غير مدعوم' },
  423: { code: 'ACCOUNT_LOCKED', message: 'الحساب مقفول مؤقتاً' },
  429: { code: 'RATE_LIMITED', message: 'طلبات كثيرة خلال وقت قصير، حاول بعد شوي' },
};

const FASTIFY_CODES: Record<string, { status: number; code: string; message: string }> = {
  FST_ERR_CTP_BODY_TOO_LARGE: { status: 413, code: 'PAYLOAD_TOO_LARGE', message: 'حجم الطلب أكبر من المسموح' },
  FST_REQ_FILE_TOO_LARGE: { status: 413, code: 'PAYLOAD_TOO_LARGE', message: 'حجم الملف أكبر من المسموح (15 ميغابايت)' },
  FST_FILES_LIMIT: { status: 413, code: 'PAYLOAD_TOO_LARGE', message: 'ارفع ملف واحد فقط بكل طلب' },
  FST_PARTS_LIMIT: { status: 413, code: 'PAYLOAD_TOO_LARGE', message: 'الطلب يحتوي أجزاء كثيرة' },
  FST_FIELDS_LIMIT: { status: 413, code: 'PAYLOAD_TOO_LARGE', message: 'الطلب يحتوي حقول كثيرة' },
  FST_ERR_CTP_INVALID_MEDIA_TYPE: { status: 415, code: 'UNSUPPORTED_MEDIA_TYPE', message: 'نوع المحتوى غير مدعوم' },
  FST_INVALID_MULTIPART_CONTENT_TYPE: { status: 415, code: 'UNSUPPORTED_MEDIA_TYPE', message: 'الطلب لازم يكون multipart/form-data' },
  FST_ERR_CTP_EMPTY_JSON_BODY: { status: 400, code: 'BAD_REQUEST', message: 'جسم الطلب فارغ' },
  FST_ERR_CTP_INVALID_JSON_BODY: { status: 400, code: 'BAD_REQUEST', message: 'صيغة JSON غير صالحة' },
  FST_ERR_CTP_INVALID_CONTENT_LENGTH: { status: 400, code: 'BAD_REQUEST', message: 'طول المحتوى غير صحيح' },
};

export interface MappedError {
  status: number;
  body: ApiErrorBody;
}

const pathOf = (path: readonly PropertyKey[]): (string | number)[] =>
  path.map((p) => (typeof p === 'number' ? p : String(p)));

/** Maps any thrown value to `{ status, ApiErrorBody }`. Unknown errors become 500 without internals. */
export function mapError(err: unknown): MappedError {
  if (err instanceof ZodError) {
    return {
      status: 400,
      body: {
        error: {
          code: 'VALIDATION_ERROR',
          message: err.issues[0]?.message ? `البيانات غير صحيحة: ${err.issues[0].message}` : 'البيانات غير صحيحة',
          details: err.issues.map((i) => ({ path: pathOf(i.path), code: i.code, message: i.message })),
        },
      },
    };
  }
  if (err instanceof AppError) {
    const error: ApiErrorBody['error'] = { code: err.code, message: err.message };
    if (err.details !== undefined) error.details = err.details;
    return { status: err.statusCode, body: { error } };
  }
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2025') return { status: 404, body: { error: { code: 'NOT_FOUND', message: 'العنصر المطلوب غير موجود' } } };
    if (err.code === 'P2002') return { status: 409, body: { error: { code: 'CONFLICT', message: 'القيمة مستخدمة مسبقاً' } } };
    if (err.code === 'P2003') return { status: 400, body: { error: { code: 'BAD_REQUEST', message: 'العنصر المرتبط غير موجود' } } };
  }
  const fe = err as Partial<FastifyError> | null;
  const known = fe?.code ? FASTIFY_CODES[fe.code] : undefined;
  if (known) return { status: known.status, body: { error: { code: known.code, message: known.message } } };
  const status = typeof fe?.statusCode === 'number' ? fe.statusCode : 500;
  if (status >= 400 && status < 500) {
    const d = STATUS_DEFAULTS[status] ?? STATUS_DEFAULTS[400]!;
    return { status, body: { error: { code: d.code, message: d.message } } };
  }
  return { status: 500, body: { error: { code: 'INTERNAL_ERROR', message: 'صار خطأ غير متوقع بالسيرفر، حاول مرة ثانية' } } };
}

export function sendError(request: FastifyRequest, reply: FastifyReply, err: unknown): FastifyReply {
  const { status, body } = mapError(err);
  if (status >= 500) request.log.error({ err }, 'request failed');
  else if (status !== 401 && status !== 404) request.log.info({ code: body.error.code, status }, body.error.message);
  return reply.code(status).header('cache-control', 'no-store').type('application/json; charset=utf-8').send(body);
}

export function registerErrorHandling(app: FastifyInstance): void {
  app.setErrorHandler((err, request, reply) => sendError(request, reply, err));
}
