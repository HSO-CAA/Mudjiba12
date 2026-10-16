import type { PrismaClient } from '@prisma/client';
import type { DailyPoint } from '@s5y/shared';

export type Metric = 'pageview' | 'place_view' | 'play';

/** `YYYY-MM-DD` in UTC. */
export const utcDay = (date = new Date()): string => date.toISOString().slice(0, 10);

const DAY_MS = 24 * 3600_000;

/** Aggregated, anonymous daily counters (no IPs or personal data are stored). */
export class StatsService {
  constructor(private readonly prisma: PrismaClient) {}

  /** Atomic upsert-increment (safe under concurrent requests). */
  async increment(metric: Metric, refId = '', by = 1, day = utcDay()): Promise<void> {
    await this.prisma.$executeRaw`
      INSERT INTO "DailyStat" ("date", "metric", "refId", "count")
      VALUES (${day}::date, ${metric}, ${refId}, ${by})
      ON CONFLICT ("date", "metric", "refId")
      DO UPDATE SET "count" = "DailyStat"."count" + EXCLUDED."count"`;
  }

  /** One point per day for the last `days` days (oldest first), zero-filled. */
  async series(days: number, now = new Date()): Promise<DailyPoint[]> {
    const end = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    const start = new Date(end - (days - 1) * DAY_MS);
    const rows = await this.prisma.dailyStat.groupBy({
      by: ['date', 'metric'],
      where: { metric: { in: ['pageview', 'play'] }, date: { gte: start } },
      _sum: { count: true },
    });
    const points = new Map<string, DailyPoint>();
    for (let i = 0; i < days; i++) {
      const date = utcDay(new Date(start.getTime() + i * DAY_MS));
      points.set(date, { date, views: 0, plays: 0 });
    }
    for (const row of rows) {
      const point = points.get(utcDay(row.date));
      if (!point) continue;
      const value = row._sum.count ?? 0;
      if (row.metric === 'pageview') point.views += value;
      else point.plays += value;
    }
    return [...points.values()];
  }

  async totalViews(): Promise<number> {
    const agg = await this.prisma.dailyStat.aggregate({ where: { metric: 'pageview' }, _sum: { count: true } });
    return agg._sum.count ?? 0;
  }

  /** Most viewed places in the window: `[placeId, views]`, descending. */
  async topPlaceViews(days: number, take: number, now = new Date()): Promise<{ placeId: string; views: number }[]> {
    const end = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    const rows = await this.prisma.dailyStat.groupBy({
      by: ['refId'],
      where: { metric: 'place_view', date: { gte: new Date(end - (days - 1) * DAY_MS) } },
      _sum: { count: true },
      orderBy: { _sum: { count: 'desc' } },
      take,
    });
    return rows.map((r) => ({ placeId: r.refId, views: r._sum.count ?? 0 }));
  }
}
