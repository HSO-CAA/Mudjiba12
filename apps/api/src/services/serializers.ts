import type { Inquiry, Place, Plan, Prisma, User, Video } from '@prisma/client';
import type {
  AdminInquiry,
  AdminPlace,
  AdminPlan,
  AdminUser,
  AdminVideo,
  AdminVideoWithPlace,
  PlaceDetail,
  PlaceLink,
  PlaceSummary,
  PublicPlan,
  PublicVideo,
} from '@s5y/shared';
import type { StorageDriver } from '../storage/types.js';

/* ───────────── Prisma query shapes the serializers expect ───────────── */

const videoOrder = [{ sortOrder: 'asc' }, { createdAt: 'asc' }] satisfies Prisma.VideoOrderByWithRelationInput[];

export const videoOrderBy = videoOrder;

/** Videos the public may see: READY, published, with a file, inside a published place. */
export const publicVideoWhere = {
  status: 'READY',
  published: true,
  fileKey: { not: null },
  place: { published: true },
} satisfies Prisma.VideoWhereInput;

/** Same filter when already scoped to a (published) place. */
export const publicPlaceVideoWhere = { status: 'READY', published: true, fileKey: { not: null } } satisfies Prisma.VideoWhereInput;

export const adminPlaceInclude = {
  videos: { select: { status: true, posterKey: true }, orderBy: videoOrder },
} satisfies Prisma.PlaceInclude;

export type AdminPlaceRow = Prisma.PlaceGetPayload<{ include: typeof adminPlaceInclude }>;

export const placeSummaryInclude = {
  videos: { where: publicPlaceVideoWhere, orderBy: videoOrder, take: 3 },
  _count: { select: { videos: { where: publicPlaceVideoWhere } } },
} satisfies Prisma.PlaceInclude;

export type PlaceSummaryRow = Prisma.PlaceGetPayload<{ include: typeof placeSummaryInclude }>;

export const videoWithPlaceInclude = { place: { select: { name: true, slug: true } } } satisfies Prisma.VideoInclude;
export type VideoWithPlaceRow = Prisma.VideoGetPayload<{ include: typeof videoWithPlaceInclude }>;

export const planInclude = { _count: { select: { inquiries: true } } } satisfies Prisma.PlanInclude;
export type PlanRow = Prisma.PlanGetPayload<{ include: typeof planInclude }>;

export const inquiryInclude = { plan: { select: { name: true } } } satisfies Prisma.InquiryInclude;
export type InquiryRow = Prisma.InquiryGetPayload<{ include: typeof inquiryInclude }>;

const iso = (d: Date): string => d.toISOString();

const aspectOf = (w: number | null, h: number | null): number | null =>
  w && h ? Math.round((w / h) * 10_000) / 10_000 : null;

/** Maps Prisma rows to the exact wire types of `@s5y/shared` (BigInt → number, keys → URLs). */
export class Serializer {
  constructor(private readonly storage: StorageDriver) {}

  url(key: string | null | undefined): string | null {
    return key ? this.storage.url(key) : null;
  }

  /**
   * Video files keep fixed keys across reprocessing while /media is served `immutable`,
   * so their URLs carry a version derived from the row's last update to bust caches.
   */
  private videoUrl(key: string | null | undefined, v: Video): string | null {
    const url = this.url(key);
    return url ? `${url}${url.includes('?') ? '&' : '?'}v=${v.updatedAt.getTime().toString(36)}` : null;
  }

  user(u: User): AdminUser {
    return { id: u.id, email: u.email, name: u.name, role: u.role, lastLoginAt: u.lastLoginAt ? iso(u.lastLoginAt) : null };
  }

  adminVideo(v: Video): AdminVideo {
    const playableKey = v.status === 'UPLOADING' ? null : (v.fileKey ?? v.sourceKey);
    return {
      id: v.id,
      placeId: v.placeId,
      title: v.title,
      description: v.description,
      status: v.status,
      processingError: v.processingError,
      originalName: v.originalName,
      mimeType: v.mimeType,
      sizeBytes: Number(v.sizeBytes),
      uploadedBytes: Number(v.uploadedBytes),
      url: this.videoUrl(playableKey, v),
      previewUrl: this.videoUrl(v.previewKey, v),
      posterKey: v.posterKey,
      posterUrl: this.videoUrl(v.posterKey, v),
      durationSec: v.durationSec,
      width: v.width,
      height: v.height,
      featured: v.featured,
      published: v.published,
      sortOrder: v.sortOrder,
      plays: v.plays,
      createdAt: iso(v.createdAt),
      updatedAt: iso(v.updatedAt),
    };
  }

  adminVideoWithPlace(v: VideoWithPlaceRow): AdminVideoWithPlace {
    return { ...this.adminVideo(v), placeName: v.place.name, placeSlug: v.place.slug };
  }

  publicVideo(v: Video): PublicVideo {
    return {
      id: v.id,
      placeId: v.placeId,
      title: v.title,
      description: v.description,
      url: this.videoUrl(v.fileKey ?? v.sourceKey, v) ?? '',
      previewUrl: this.videoUrl(v.previewKey, v),
      posterUrl: this.videoUrl(v.posterKey, v),
      durationSec: v.durationSec,
      width: v.width,
      height: v.height,
      aspect: aspectOf(v.width, v.height),
      featured: v.featured,
      plays: v.plays,
    };
  }

  adminPlace(p: AdminPlaceRow): AdminPlace {
    const thumbKey = p.videos.find((v) => v.posterKey)?.posterKey ?? null;
    return {
      id: p.id,
      slug: p.slug,
      name: p.name,
      category: p.category,
      location: p.location,
      summary: p.summary,
      description: p.description,
      coverKey: p.coverKey,
      coverUrl: this.url(p.coverKey),
      logoKey: p.logoKey,
      logoUrl: this.url(p.logoKey),
      accentColor: p.accentColor,
      instagram: p.instagram,
      website: p.website,
      year: p.year,
      services: p.services,
      featured: p.featured,
      published: p.published,
      sortOrder: p.sortOrder,
      videoCount: p.videos.length,
      readyCount: p.videos.filter((v) => v.status === 'READY').length,
      thumbUrl: this.url(thumbKey),
      createdAt: iso(p.createdAt),
      updatedAt: iso(p.updatedAt),
    };
  }

  placeSummary(p: PlaceSummaryRow): PlaceSummary {
    return {
      id: p.id,
      slug: p.slug,
      name: p.name,
      category: p.category,
      location: p.location,
      summary: p.summary,
      coverUrl: this.url(p.coverKey),
      logoUrl: this.url(p.logoKey),
      accentColor: p.accentColor,
      year: p.year,
      featured: p.featured,
      videoCount: p._count.videos,
      previews: p.videos.map((v) => this.publicVideo(v)),
    };
  }

  placeDetail(
    p: Place,
    videos: Video[],
    neighbours: { prev: PlaceLink | null; next: PlaceLink | null },
  ): PlaceDetail {
    const publicVideos = videos.map((v) => this.publicVideo(v));
    return {
      id: p.id,
      slug: p.slug,
      name: p.name,
      category: p.category,
      location: p.location,
      summary: p.summary,
      coverUrl: this.url(p.coverKey),
      logoUrl: this.url(p.logoKey),
      accentColor: p.accentColor,
      year: p.year,
      featured: p.featured,
      videoCount: publicVideos.length,
      previews: publicVideos.slice(0, 3),
      description: p.description,
      services: p.services,
      instagram: p.instagram,
      website: p.website,
      videos: publicVideos,
      prev: neighbours.prev,
      next: neighbours.next,
    };
  }

  adminPlan(p: PlanRow): AdminPlan {
    return { ...this.publicPlan(p), active: p.active, sortOrder: p.sortOrder, inquiryCount: p._count.inquiries, createdAt: iso(p.createdAt), updatedAt: iso(p.updatedAt) };
  }

  publicPlan(p: Plan): PublicPlan {
    return {
      id: p.id,
      name: p.name,
      tagline: p.tagline,
      price: p.price,
      currency: p.currency,
      period: p.period,
      features: p.features,
      highlighted: p.highlighted,
      ctaLabel: p.ctaLabel,
    };
  }

  inquiry(i: Inquiry & { plan: { name: string } | null }): AdminInquiry {
    return {
      id: i.id,
      name: i.name,
      phone: i.phone,
      email: i.email,
      message: i.message,
      status: i.status,
      notes: i.notes,
      planId: i.planId,
      planName: i.plan?.name ?? null,
      source: i.source,
      createdAt: iso(i.createdAt),
      updatedAt: iso(i.updatedAt),
    };
  }
}
