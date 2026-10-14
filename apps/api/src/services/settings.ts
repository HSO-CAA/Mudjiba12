import type { Prisma, PrismaClient } from '@prisma/client';
import type { SiteSettings } from '@s5y/shared';
import { IMAGE_KEY_RE, hexColorSchema, idSchema, z } from '../lib/validation.js';

export const SITE_SETTINGS_KEY = 'site';

/** Exact defaults from docs/CONTRACT.md. */
export const DEFAULT_SETTINGS: SiteSettings = {
  brand: {
    name: 'S5Y',
    handle: 's5y',
    title: 'صانع محتوى · تصوير ومونتاج',
    tagline: 'أحوّل الأماكن إلى قصص تنشاف وتنحفظ',
    heroMark: 'S5Y',
    accent: '#e9b35f',
  },
  about: {
    heading: 'عين وراء الكاميرا',
    body: 'أصوّر وأصنع محتوى للمطاعم والكافيهات والبراندات… كل مكان عنده قصة، وشغلي أخليها تنشاف.',
    avatarKey: null,
    location: 'العراق',
    since: 2019,
  },
  stats: [],
  contact: { whatsapp: '', phone: '', email: '', instagram: 's5y', tiktok: '', youtube: '', snapchat: '', address: '' },
  hero: { videoIds: [] },
  sections: { about: true, showreel: true, plans: false, contact: true },
  seo: {
    title: 'S5Y — صانع محتوى وتصوير فيديو',
    description: 'بورتفوليو S5Y: فيديوهات وريلز احترافية للأماكن والبراندات.',
    keywords: 'تصوير, مونتاج, صانع محتوى, ريلز, العراق',
    ogImageKey: null,
  },
};

const clone = <T>(value: T): T => structuredClone(value);

/** Field factory: strict mode fills defaults only for missing keys; lenient mode also replaces invalid values. */
function makeSettingsSchema(lenient: boolean) {
  const d = DEFAULT_SETTINGS;
  const leaf = <S extends z.ZodType>(schema: S, fallback: z.output<S>) =>
    lenient ? schema.catch(fallback as never) : schema.default(fallback as never);
  const trimmed = (max: number, min = 0) =>
    z.preprocess(
      (v) => (typeof v === 'string' ? v.trim() : v),
      z
        .string()
        .min(min, min > 0 ? 'هذا الحقل مطلوب' : undefined)
        .max(max, `النص طويل، الحد الأقصى ${max} حرف`),
    );
  const handle = (max: number) =>
    z.preprocess(
      (v) => (typeof v === 'string' ? v.trim().replace(/^@+/, '') : v),
      z.string().max(max, `النص طويل، الحد الأقصى ${max} حرف`).regex(/^[^\s<>"']*$/, 'الحساب غير صالح'),
    );
  const nullableImageKey = z.string().regex(IMAGE_KEY_RE, 'مفتاح الصورة غير صالح — ارفع الصورة أولاً').nullable();
  const thisYear = new Date().getUTCFullYear();
  const section = <T extends z.ZodRawShape>(shape: T, fallback: unknown) => {
    const obj = z.object(shape);
    return lenient ? obj.catch(clone(fallback) as never) : obj.prefault({} as never);
  };

  return z.object({
    brand: section(
      {
        name: leaf(trimmed(60, 1), d.brand.name),
        handle: leaf(
          handle(30).pipe(z.string().regex(/^[A-Za-z0-9._]*$/, 'المعرّف يتكون من أحرف إنجليزية وأرقام و . و _ فقط')),
          d.brand.handle,
        ),
        title: leaf(trimmed(120), d.brand.title),
        tagline: leaf(trimmed(200), d.brand.tagline),
        heroMark: leaf(trimmed(12, 1), d.brand.heroMark),
        accent: leaf(hexColorSchema, d.brand.accent),
      },
      d.brand,
    ),
    about: section(
      {
        heading: leaf(trimmed(120), d.about.heading),
        body: leaf(trimmed(3000), d.about.body),
        avatarKey: leaf(nullableImageKey, d.about.avatarKey),
        location: leaf(trimmed(80), d.about.location),
        since: leaf(
          z
            .number()
            .int('السنة لازم تكون رقم صحيح')
            .min(1950, 'السنة غير منطقية')
            .max(thisYear, 'السنة ما تكون بالمستقبل')
            .nullable(),
          d.about.since,
        ),
      },
      d.about,
    ),
    stats: leaf(
      z
        .array(
          z.object({
            label: trimmed(40, 1),
            value: z.number().finite().min(0, 'القيمة لازم تكون موجبة').max(1e12),
            suffix: z.preprocess((v) => (typeof v === 'string' ? v.trim() || undefined : v), z.string().max(8).optional()),
          }),
        )
        .max(8, 'الحد الأقصى 8 أرقام'),
      d.stats,
    ),
    contact: section(
      {
        whatsapp: leaf(
          z.preprocess(
            (v) => (typeof v === 'string' ? v.replace(/[\s()+-]/g, '').replace(/^00/, '') : v),
            z.string().regex(/^\d{0,15}$/, 'رقم الواتساب لازم يكون أرقام فقط بالصيغة الدولية (مثل 9647700000000)'),
          ),
          d.contact.whatsapp,
        ),
        phone: leaf(
          z.preprocess(
            (v) => (typeof v === 'string' ? v.trim() : v),
            z.string().max(30).regex(/^[+0-9 ()-]*$/, 'رقم الهاتف غير صالح'),
          ),
          d.contact.phone,
        ),
        email: leaf(
          z.preprocess((v) => (typeof v === 'string' ? v.trim() : v), z.union([z.literal(''), z.email('البريد الإلكتروني غير صالح').max(200)])),
          d.contact.email,
        ),
        instagram: leaf(handle(100), d.contact.instagram),
        tiktok: leaf(handle(100), d.contact.tiktok),
        youtube: leaf(handle(150), d.contact.youtube),
        snapchat: leaf(handle(100), d.contact.snapchat),
        address: leaf(trimmed(200), d.contact.address),
      },
      d.contact,
    ),
    hero: section(
      {
        videoIds: leaf(
          z
            .array(idSchema)
            .max(7, 'الحد الأقصى 7 فيديوهات للواجهة')
            .transform((ids) => [...new Set(ids)]),
          d.hero.videoIds,
        ),
      },
      d.hero,
    ),
    sections: section(
      {
        about: leaf(z.boolean(), d.sections.about),
        showreel: leaf(z.boolean(), d.sections.showreel),
        plans: leaf(z.boolean(), d.sections.plans),
        contact: leaf(z.boolean(), d.sections.contact),
      },
      d.sections,
    ),
    seo: section(
      {
        title: leaf(trimmed(120), d.seo.title),
        description: leaf(trimmed(300), d.seo.description),
        keywords: leaf(trimmed(300), d.seo.keywords),
        ogImageKey: leaf(nullableImageKey, d.seo.ogImageKey),
      },
      d.seo,
    ),
  });
}

/** Validates an admin PUT: invalid values → 400, missing keys → defaults, unknown keys dropped. */
export const settingsInputSchema = makeSettingsSchema(false);
/** Reads a stored document forward-compatibly: missing or invalid values fall back to defaults. */
const settingsReadSchema = makeSettingsSchema(true);

export function normalizeStoredSettings(value: unknown): SiteSettings {
  const result = settingsReadSchema.safeParse(value ?? {});
  return (result.success ? result.data : clone(DEFAULT_SETTINGS)) as SiteSettings;
}

const CACHE_TTL_MS = 10_000;

export class SettingsService {
  private cache: { at: number; value: SiteSettings } | null = null;

  constructor(private readonly prisma: PrismaClient) {}

  /** Creates the settings document with defaults when it doesn't exist (first boot). */
  async ensure(): Promise<void> {
    await this.prisma.setting.upsert({
      where: { key: SITE_SETTINGS_KEY },
      create: { key: SITE_SETTINGS_KEY, value: clone(DEFAULT_SETTINGS) as unknown as Prisma.InputJsonValue },
      update: {},
    });
  }

  async get(): Promise<SiteSettings> {
    if (this.cache && Date.now() - this.cache.at < CACHE_TTL_MS) return clone(this.cache.value);
    const row = await this.prisma.setting.findUnique({ where: { key: SITE_SETTINGS_KEY } });
    const value = normalizeStoredSettings(row?.value);
    this.cache = { at: Date.now(), value };
    return clone(value);
  }

  async save(settings: SiteSettings): Promise<SiteSettings> {
    const value = settings as unknown as Prisma.InputJsonValue;
    await this.prisma.setting.upsert({
      where: { key: SITE_SETTINGS_KEY },
      create: { key: SITE_SETTINGS_KEY, value },
      update: { value },
    });
    this.cache = { at: Date.now(), value: clone(settings) };
    return clone(settings);
  }

  /** Read-modify-write helper used when videos are deleted (hero list pruning). */
  async update(mutate: (current: SiteSettings) => SiteSettings | null): Promise<void> {
    const next = mutate(await this.get());
    if (next) await this.save(next);
  }

  invalidate(): void {
    this.cache = null;
  }
}
