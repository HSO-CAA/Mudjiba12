import type { Overview } from '@s5y/shared';
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../../context.js';
import { parse, z } from '../../lib/validation.js';
import { inquiryInclude, videoWithPlaceInclude } from '../../services/serializers.js';

const querySchema = z.object({
  days: z.preprocess(
    (v) => (v === '' || v === undefined ? undefined : v),
    z.coerce.number().int('عدد الأيام لازم يكون رقم صحيح').min(7, 'أقل مدة 7 أيام').max(365, 'أكبر مدة 365 يوم').default(30),
  ),
});

const TOP = 5;

export async function overviewRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  const { prisma, serialize, stats } = ctx;

  app.get('/overview', async (request): Promise<Overview> => {
    const { days } = parse(querySchema, request.query ?? {});

    const [places, videos, processing, failed, inquiriesNew, plans, plays, sizes, views, series, topVideoRows, topPlaceViews, recent] =
      await Promise.all([
        prisma.place.count(),
        prisma.video.count(),
        prisma.video.count({ where: { status: 'PROCESSING' } }),
        prisma.video.count({ where: { status: 'FAILED' } }),
        prisma.inquiry.count({ where: { status: 'NEW' } }),
        prisma.plan.count(),
        prisma.video.aggregate({ _sum: { plays: true } }),
        prisma.video.aggregate({ _sum: { sizeBytes: true } }),
        stats.totalViews(),
        stats.series(days),
        prisma.video.findMany({
          where: { status: 'READY' },
          orderBy: [{ plays: 'desc' }, { createdAt: 'desc' }],
          take: TOP,
          include: videoWithPlaceInclude,
        }),
        stats.topPlaceViews(days, TOP),
        prisma.inquiry.findMany({ orderBy: { createdAt: 'desc' }, take: TOP, include: inquiryInclude }),
      ]);

    const placeRows = await prisma.place.findMany({
      where: { id: { in: topPlaceViews.map((p) => p.placeId) } },
      select: { id: true, name: true, slug: true },
    });
    const byId = new Map(placeRows.map((p) => [p.id, p]));
    const topPlaces = topPlaceViews.flatMap((t) => {
      const p = byId.get(t.placeId);
      return p ? [{ id: p.id, name: p.name, slug: p.slug, views: t.views }] : [];
    });

    // Real bytes on disk for local storage (images included); sum of uploaded video sizes otherwise.
    const measured = await ctx.storage.usageBytes().catch(() => null);
    const storageBytes = measured ?? Number(sizes._sum.sizeBytes ?? 0n);

    return {
      counts: {
        places,
        videos,
        videosProcessing: processing,
        videosFailed: failed,
        inquiriesNew,
        plans,
        plays: plays._sum.plays ?? 0,
        views,
        storageBytes,
      },
      series,
      topVideos: topVideoRows.map((v) => serialize.adminVideoWithPlace(v)),
      topPlaces,
      recentInquiries: recent.map((i) => serialize.inquiry(i)),
      mediaProcessing: ctx.tools.available,
    };
  });
}
