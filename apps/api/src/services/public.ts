import type { PrismaClient, Video } from '@prisma/client';
import type { HomeData, PlaceDetail, PlaceSummary, PublicPlan, PublicSite, PublicVideo, SiteSettings, SiteStat } from '@s5y/shared';
import {
  type Serializer,
  placeSummaryInclude,
  publicPlaceVideoWhere,
  publicVideoWhere,
  videoOrderBy,
} from './serializers.js';
import type { SettingsService } from './settings.js';

const HERO_MAX = 7;
const SHOWREEL_MAX = 12;

/** Read-only queries behind the public portfolio. Only published places and READY+published videos. */
export class PublicService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly settings: SettingsService,
    private readonly serialize: Serializer,
  ) {}

  async counts(): Promise<PublicSite['counts']> {
    const [places, videos, plays] = await Promise.all([
      this.prisma.place.count({ where: { published: true } }),
      this.prisma.video.count({ where: publicVideoWhere }),
      this.prisma.video.aggregate({ where: publicVideoWhere, _sum: { plays: true } }),
    ]);
    return { places, videos, plays: plays._sum.plays ?? 0 };
  }

  /** Custom stats, or automatic ones (places, videos, plays, years of experience) when none are set. */
  resolveStats(settings: SiteSettings, counts: PublicSite['counts']): SiteStat[] {
    if (settings.stats.length > 0) return settings.stats;
    const stats: SiteStat[] = [
      { label: 'أماكن اشتغلت وياها', value: counts.places, suffix: '+' },
      { label: 'فيديو منشور', value: counts.videos },
      { label: 'مشاهدة', value: counts.plays, suffix: '+' },
    ];
    const since = settings.about.since;
    const years = since ? new Date().getUTCFullYear() - since : 0;
    if (years > 0) stats.push({ label: 'سنوات خبرة', value: years, suffix: '+' });
    return stats.filter((s) => s.value > 0);
  }

  async site(settings?: SiteSettings): Promise<PublicSite> {
    const s = settings ?? (await this.settings.get());
    const counts = await this.counts();
    const { avatarKey, ...about } = s.about;
    const { ogImageKey, ...seo } = s.seo;
    return {
      brand: s.brand,
      about: { ...about, avatarUrl: this.serialize.url(avatarKey) },
      stats: this.resolveStats(s, counts),
      contact: s.contact,
      sections: s.sections,
      seo: { ...seo, ogImageUrl: this.serialize.url(ogImageKey) },
      counts,
    };
  }

  async places(): Promise<PlaceSummary[]> {
    const rows = await this.prisma.place.findMany({
      where: { published: true },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      include: placeSummaryInclude,
    });
    return rows.map((p) => this.serialize.placeSummary(p));
  }

  async place(slug: string): Promise<PlaceDetail | null> {
    const place = await this.prisma.place.findFirst({ where: { slug, published: true } });
    if (!place) return null;
    const [videos, all] = await Promise.all([
      this.prisma.video.findMany({ where: { placeId: place.id, ...publicPlaceVideoWhere }, orderBy: videoOrderBy }),
      this.prisma.place.findMany({
        where: { published: true },
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
        select: { id: true, slug: true, name: true },
      }),
    ]);
    const index = all.findIndex((p) => p.id === place.id);
    const link = (i: number) => {
      const p = all[i];
      return p && p.id !== place.id ? { slug: p.slug, name: p.name } : null;
    };
    return this.serialize.placeDetail(place, videos, { prev: link(index - 1), next: link(index + 1) });
  }

  async plans(settings?: SiteSettings): Promise<PublicPlan[]> {
    const s = settings ?? (await this.settings.get());
    if (!s.sections.plans) return [];
    const rows = await this.prisma.plan.findMany({ where: { active: true }, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] });
    return rows.map((p) => this.serialize.publicPlan(p));
  }

  private toPublic(videos: Video[]): PublicVideo[] {
    return videos.map((v) => this.serialize.publicVideo(v));
  }

  private featuredVideos(take: number): Promise<Video[]> {
    return this.prisma.video.findMany({
      where: { ...publicVideoWhere, featured: true },
      orderBy: [{ place: { sortOrder: 'asc' } }, { sortOrder: 'asc' }, { createdAt: 'asc' }],
      take,
    });
  }

  private latestVideos(take: number): Promise<Video[]> {
    return this.prisma.video.findMany({ where: publicVideoWhere, orderBy: [{ createdAt: 'desc' }], take });
  }

  /** settings.hero.videoIds (in that order) → featured → latest. */
  async heroVideos(settings: SiteSettings): Promise<PublicVideo[]> {
    const ids = settings.hero.videoIds.slice(0, HERO_MAX);
    if (ids.length > 0) {
      const rows = await this.prisma.video.findMany({ where: { ...publicVideoWhere, id: { in: ids } } });
      const byId = new Map(rows.map((v) => [v.id, v]));
      const ordered = ids.flatMap((id) => {
        const v = byId.get(id);
        return v ? [v] : [];
      });
      if (ordered.length > 0) return this.toPublic(ordered);
    }
    const featured = await this.featuredVideos(HERO_MAX);
    if (featured.length > 0) return this.toPublic(featured);
    return this.toPublic(await this.latestVideos(HERO_MAX));
  }

  async showreel(): Promise<PublicVideo[]> {
    const featured = await this.featuredVideos(SHOWREEL_MAX);
    if (featured.length > 0) return this.toPublic(featured);
    return this.toPublic(await this.latestVideos(SHOWREEL_MAX));
  }

  async home(): Promise<HomeData> {
    const settings = await this.settings.get();
    const [site, heroVideos, places, showreel, plans] = await Promise.all([
      this.site(settings),
      this.heroVideos(settings),
      this.places(),
      this.showreel(),
      this.plans(settings),
    ]);
    return { site, heroVideos, places, showreel, plans };
  }
}
