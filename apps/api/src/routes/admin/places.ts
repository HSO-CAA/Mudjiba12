import type { Prisma } from '@prisma/client';
import type { AdminPlace, AdminPlaceDetail } from '@s5y/shared';
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../../context.js';
import { badRequest, conflict, notFound } from '../../lib/errors.js';
import { SLUG_MAX, SLUG_MIN, SLUG_RE, nextFreeSlug, slugBase } from '../../lib/slug.js';
import {
  hexColorSchema,
  idParams,
  imageKeySchema,
  nullableHttpUrl,
  nullableSocialHandle,
  nullableText,
  parse,
  reorderSchema,
  z,
} from '../../lib/validation.js';
import { adminPlaceInclude, videoOrderBy } from '../../services/serializers.js';
import { applyReorder } from './reorder.js';

const slugSchema = z.preprocess(
  (v) => (typeof v === 'string' ? v.trim().toLowerCase() : v),
  z
    .string()
    .min(SLUG_MIN, `الرابط لازم يكون ${SLUG_MIN} أحرف على الأقل`)
    .max(SLUG_MAX, `الرابط طويل، الحد الأقصى ${SLUG_MAX} حرف`)
    .regex(SLUG_RE, 'الرابط يتكون من أحرف إنجليزية صغيرة وأرقام و "-" فقط'),
);

const placeFields = {
  name: z.preprocess(
    (v) => (typeof v === 'string' ? v.trim() : v),
    z.string({ error: 'اكتب اسم المكان' }).min(1, 'اكتب اسم المكان').max(120, 'الاسم طويل، الحد الأقصى 120 حرف'),
  ),
  /** "" (or null) → regenerate from the name. */
  slug: z.union([slugSchema, z.literal(''), z.null()]),
  category: nullableText(60),
  location: nullableText(80),
  summary: nullableText(300),
  description: nullableText(5000),
  coverKey: imageKeySchema.nullable(),
  logoKey: imageKeySchema.nullable(),
  accentColor: hexColorSchema,
  instagram: nullableSocialHandle(100),
  website: nullableHttpUrl(300),
  year: z.number().int('السنة لازم تكون رقم صحيح').min(1990, 'السنة غير منطقية').max(2100, 'السنة غير منطقية').nullable(),
  services: z
    .array(z.string().trim().min(1).max(40, 'اسم الخدمة طويل، الحد الأقصى 40 حرف'))
    .max(20, 'الحد الأقصى 20 خدمة')
    .transform((list) => [...new Set(list)]),
  featured: z.boolean(),
  published: z.boolean(),
};

const createSchema = z.object(placeFields).partial().required({ name: true });
const updateSchema = z.object(placeFields).partial();

export async function placeRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  const { prisma, serialize } = ctx;

  const loadAdminPlace = async (id: string): Promise<AdminPlace> => {
    const place = await prisma.place.findUnique({ where: { id }, include: adminPlaceInclude });
    if (!place) throw notFound('المكان غير موجود');
    return serialize.adminPlace(place);
  };

  /** Free slug for `name`: base, base-2, base-3… */
  const autoSlug = async (name: string, excludeId?: string): Promise<string> => {
    const base = slugBase(name);
    const taken = await prisma.place.findMany({
      where: { slug: { startsWith: base }, ...(excludeId ? { id: { not: excludeId } } : {}) },
      select: { slug: true },
    });
    return nextFreeSlug(
      base,
      taken.map((p) => p.slug),
    );
  };

  const assertSlugFree = async (slug: string, excludeId?: string): Promise<void> => {
    const existing = await prisma.place.findUnique({ where: { slug }, select: { id: true } });
    if (existing && existing.id !== excludeId) {
      throw conflict('هذا الرابط مستخدم لمكان ثاني، اختار رابط مختلف', { field: 'slug' });
    }
  };

  app.get('/places', async (): Promise<AdminPlace[]> => {
    const rows = await prisma.place.findMany({
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      include: adminPlaceInclude,
    });
    return rows.map((p) => serialize.adminPlace(p));
  });

  app.post('/places', async (request, reply) => {
    const input = parse(createSchema, request.body ?? {});
    await ctx.files.assertImagesExist({ coverKey: input.coverKey, logoKey: input.logoKey });
    const explicitSlug = typeof input.slug === 'string' && input.slug !== '' ? input.slug : null;
    if (explicitSlug) await assertSlugFree(explicitSlug);
    const last = await prisma.place.aggregate({ _max: { sortOrder: true } });

    // Auto slugs can race with a concurrent create → retry on the unique violation.
    for (let attempt = 0; ; attempt++) {
      const slug = explicitSlug ?? (await autoSlug(input.name));
      try {
        const created = await prisma.place.create({
          data: {
            name: input.name,
            slug,
            category: input.category ?? null,
            location: input.location ?? null,
            summary: input.summary ?? null,
            description: input.description ?? null,
            coverKey: input.coverKey ?? null,
            logoKey: input.logoKey ?? null,
            ...(input.accentColor ? { accentColor: input.accentColor } : {}),
            instagram: input.instagram ?? null,
            website: input.website ?? null,
            year: input.year ?? null,
            services: input.services ?? [],
            featured: input.featured ?? false,
            published: input.published ?? true,
            sortOrder: (last._max.sortOrder ?? -1) + 1,
          },
          include: adminPlaceInclude,
        });
        return reply.code(201).send(serialize.adminPlace(created));
      } catch (err) {
        const isSlugRace = (err as { code?: string }).code === 'P2002' && !explicitSlug && attempt < 3;
        if (!isSlugRace) throw err;
      }
    }
  });

  app.put('/places/order', async (request, reply) => {
    const { ids } = parse(reorderSchema, request.body ?? {});
    const all = await prisma.place.findMany({ orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }], select: { id: true } });
    await applyReorder(
      ids,
      all.map((p) => p.id),
      (id, sortOrder) => prisma.place.update({ where: { id }, data: { sortOrder }, select: { id: true } }),
      prisma,
    );
    return reply.code(204).send();
  });

  app.get('/places/:id', async (request): Promise<AdminPlaceDetail> => {
    const { id } = parse(idParams, request.params);
    const place = await prisma.place.findUnique({ where: { id }, include: adminPlaceInclude });
    if (!place) throw notFound('المكان غير موجود');
    const videos = await prisma.video.findMany({ where: { placeId: id }, orderBy: videoOrderBy });
    return { ...serialize.adminPlace(place), videos: videos.map((v) => serialize.adminVideo(v)) };
  });

  app.patch('/places/:id', async (request) => {
    const { id } = parse(idParams, request.params);
    const input = parse(updateSchema, request.body ?? {});
    const current = await prisma.place.findUnique({ where: { id } });
    if (!current) throw notFound('المكان غير موجود');
    await ctx.files.assertImagesExist({
      coverKey: input.coverKey !== current.coverKey ? input.coverKey : null,
      logoKey: input.logoKey !== current.logoKey ? input.logoKey : null,
    });

    const data: Prisma.PlaceUpdateInput = {};
    if (input.name !== undefined) data.name = input.name;
    if (input.slug !== undefined) {
      if (input.slug === '' || input.slug === null) data.slug = await autoSlug(input.name ?? current.name, id);
      else if (input.slug !== current.slug) {
        await assertSlugFree(input.slug, id);
        data.slug = input.slug;
      }
    }
    for (const key of ['category', 'location', 'summary', 'description', 'instagram', 'website', 'year'] as const) {
      if (input[key] !== undefined) (data as Record<string, unknown>)[key] = input[key];
    }
    if (input.coverKey !== undefined) data.coverKey = input.coverKey;
    if (input.logoKey !== undefined) data.logoKey = input.logoKey;
    if (input.accentColor !== undefined) data.accentColor = input.accentColor;
    if (input.services !== undefined) data.services = input.services;
    if (input.featured !== undefined) data.featured = input.featured;
    if (input.published !== undefined) data.published = input.published;

    await prisma.place.update({ where: { id }, data });

    const replaced = [
      input.coverKey !== undefined && input.coverKey !== current.coverKey ? current.coverKey : null,
      input.logoKey !== undefined && input.logoKey !== current.logoKey ? current.logoKey : null,
    ];
    await ctx.files.releaseImages(replaced);
    return loadAdminPlace(id);
  });

  app.delete('/places/:id', async (request, reply) => {
    const { id } = parse(idParams, request.params);
    const place = await prisma.place.findUnique({
      where: { id },
      include: { videos: { select: { id: true, posterKey: true } } },
    });
    if (!place) throw notFound('المكان غير موجود');
    for (const v of place.videos) ctx.queue.cancel(v.id);
    await prisma.place.delete({ where: { id } }); // videos cascade
    const videoIds = new Set(place.videos.map((v) => v.id));
    if (videoIds.size > 0) {
      await ctx.settings.update((s) => {
        const kept = s.hero.videoIds.filter((v) => !videoIds.has(v));
        return kept.length === s.hero.videoIds.length ? null : { ...s, hero: { videoIds: kept } };
      });
    }
    for (const v of place.videos) await ctx.files.deleteVideoFiles(v);
    await ctx.files.releaseImages([place.coverKey, place.logoKey]);
    request.log.info({ placeId: id, videos: videoIds.size }, 'place deleted');
    return reply.code(204).send();
  });

  app.put('/places/:id/videos/order', async (request, reply) => {
    const { id } = parse(idParams, request.params);
    const { ids } = parse(reorderSchema, request.body ?? {});
    const place = await prisma.place.findUnique({ where: { id }, select: { id: true } });
    if (!place) throw notFound('المكان غير موجود');
    const videos = await prisma.video.findMany({ where: { placeId: id }, orderBy: videoOrderBy, select: { id: true } });
    const known = new Set(videos.map((v) => v.id));
    if (ids.some((v) => !known.has(v))) throw badRequest('بعض الفيديوهات لا تنتمي لهذا المكان');
    await applyReorder(
      ids,
      videos.map((v) => v.id),
      (videoId, sortOrder) => prisma.video.update({ where: { id: videoId }, data: { sortOrder }, select: { id: true } }),
      prisma,
    );
    return reply.code(204).send();
  });
}
