import { z } from 'zod';

// Arabic fallback messages for every zod issue that has no explicit message.
z.config(z.locales.ar());

export { z };

/** Parses `data` with `schema`; throws the ZodError (mapped to 400 VALIDATION_ERROR by the error handler). */
export function parse<S extends z.ZodType>(schema: S, data: unknown): z.output<S> {
  return schema.parse(data);
}

/** Row ids (Prisma cuid) and other opaque ids sent in URLs/bodies. */
export const idSchema = z
  .string({ error: 'المعرّف غير صالح' })
  .regex(/^[A-Za-z0-9_-]{1,64}$/, 'المعرّف غير صالح');

export const idParams = z.object({ id: idSchema });

/** Storage key of an image uploaded through `/api/admin/uploads/image`. */
export const IMAGE_KEY_RE = /^images\/\d{4}\/\d{2}\/[a-z0-9]{8,40}\.(?:webp|jpg|png|gif|avif)$/;

export const imageKeySchema = z.string().regex(IMAGE_KEY_RE, 'مفتاح الصورة غير صالح — ارفع الصورة أولاً');

export const hexColorSchema = z
  .string()
  .trim()
  .regex(/^#[0-9a-fA-F]{6}$/, 'اللون لازم يكون بصيغة ‎#rrggbb')
  .transform((c) => c.toLowerCase());

/** Trimmed text; empty strings become `null`. */
export const nullableText = (max: number, message?: string) =>
  z.preprocess(
    (v) => (typeof v === 'string' ? (v.trim() === '' ? null : v.trim()) : v),
    z.string().max(max, message ?? `النص طويل، الحد الأقصى ${max} حرف`).nullable(),
  );

/** Trimmed text that may be empty. */
export const plainText = (max: number) =>
  z.preprocess((v) => (typeof v === 'string' ? v.trim() : v), z.string().max(max, `النص طويل، الحد الأقصى ${max} حرف`));

export const reorderSchema = z.object({
  ids: z
    .array(idSchema)
    .max(10_000)
    .refine((ids) => new Set(ids).size === ids.length, 'القائمة تحتوي معرّفات مكررة'),
});

/** Strips a leading "@" and whitespace from social handles; accepts full URLs too. */
export const socialHandle = (max = 100) =>
  z.preprocess(
    (v) => (typeof v === 'string' ? v.trim().replace(/^@+/, '') : v),
    z.string().max(max, `النص طويل، الحد الأقصى ${max} حرف`).regex(/^[^\s<>"']*$/, 'الحساب غير صالح'),
  );

export const nullableSocialHandle = (max = 100) =>
  z.preprocess(
    (v) => (typeof v === 'string' ? (v.trim().replace(/^@+/, '') === '' ? null : v.trim().replace(/^@+/, '')) : v),
    z.string().max(max, `النص طويل، الحد الأقصى ${max} حرف`).regex(/^[^\s<>"']+$/, 'الحساب غير صالح').nullable(),
  );

export const nullableHttpUrl = (max = 300) =>
  z.preprocess(
    (v) => {
      if (typeof v !== 'string') return v;
      const s = v.trim();
      if (s === '') return null;
      return /^https?:\/\//i.test(s) ? s : `https://${s}`;
    },
    z.url({ protocol: /^https?$/, error: 'الرابط غير صالح' }).max(max, 'الرابط طويل جداً').nullable(),
  );
