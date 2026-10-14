import { idSchema, z } from '../../lib/validation.js';

const optionalTrimmed = (v: unknown) => {
  if (typeof v !== 'string') return v === null ? undefined : v;
  const s = v.trim();
  return s === '' ? undefined : s;
};

export const inquiryInputSchema = z
  .object({
    name: z.preprocess(
      (v) => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ') : v),
      z
        .string({ error: 'اكتب اسمك' })
        .min(2, 'الاسم لازم يكون حرفين على الأقل')
        .max(80, 'الاسم طويل، الحد الأقصى 80 حرف'),
    ),
    phone: z.preprocess(
      optionalTrimmed,
      z
        .string()
        .min(6, 'رقم الهاتف قصير')
        .max(20, 'رقم الهاتف طويل')
        .regex(/^[+0-9 -]+$/, 'رقم الهاتف لازم يحتوي أرقام فقط')
        .optional(),
    ),
    email: z.preprocess(
      optionalTrimmed,
      z.email('البريد الإلكتروني غير صالح').max(200, 'البريد الإلكتروني طويل').optional(),
    ),
    message: z.preprocess(
      (v) => (typeof v === 'string' ? v.trim() : v),
      z
        .string({ error: 'اكتب رسالتك' })
        .min(5, 'الرسالة قصيرة، اكتب تفاصيل أكثر')
        .max(2000, 'الرسالة طويلة، الحد الأقصى 2000 حرف'),
    ),
    planId: z.preprocess(optionalTrimmed, idSchema.optional()),
    source: z.preprocess(optionalTrimmed, z.string().max(80).optional()),
    website: z.unknown().optional(),
  })
  .superRefine((value, ctx) => {
    if (!value.phone && !value.email) {
      ctx.addIssue({ code: 'custom', path: ['phone'], message: 'اكتب رقم الهاتف أو البريد الإلكتروني حتى نقدر نتواصل وياك' });
    }
  });

export const trackEventSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('pageview'),
    path: z
      .string()
      .max(500)
      .transform((p) => p.split(/[?#]/)[0] ?? '/')
      .pipe(z.string().startsWith('/', 'المسار غير صالح')),
  }),
  z.object({ type: z.literal('play'), videoId: z.string().max(64) }),
]);
