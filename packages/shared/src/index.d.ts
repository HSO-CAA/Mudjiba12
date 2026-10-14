/**
 * @s5y/shared — the API contract shared by the backend (apps/api),
 * the public portfolio (apps/web) and the admin dashboard (apps/admin).
 *
 * TYPES ONLY (a .d.ts file). Always consume it with `import type { … } from "@s5y/shared"`.
 * All dates are ISO-8601 strings on the wire. All media URLs are ready to use
 * (root-relative like `/media/...` for local storage, or absolute for S3/CDN).
 * See docs/CONTRACT.md for the full endpoint list.
 */

/* ───────────────────────────── Enums ───────────────────────────── */

export type Role = 'OWNER' | 'EDITOR';
export type VideoStatus = 'UPLOADING' | 'PROCESSING' | 'READY' | 'FAILED';
export type PlanPeriod = 'MONTHLY' | 'QUARTERLY' | 'YEARLY' | 'ONE_TIME';
export type InquiryStatus = 'NEW' | 'CONTACTED' | 'WON' | 'ARCHIVED';

/* ───────────────────────────── Errors ───────────────────────────── */

/** Every non-2xx JSON response has this shape. `message` is user-facing Arabic. */
export interface ApiErrorBody {
  error: {
    code: ApiErrorCode | string;
    message: string;
    details?: unknown;
  };
}

export type ApiErrorCode =
  | 'BAD_REQUEST'
  | 'VALIDATION_ERROR'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'OFFSET_MISMATCH'
  | 'PAYLOAD_TOO_LARGE'
  | 'UNSUPPORTED_MEDIA_TYPE'
  | 'RATE_LIMITED'
  | 'ACCOUNT_LOCKED'
  | 'INTERNAL_ERROR';

/* ─────────────────────────── Site settings ─────────────────────────── */

export interface SiteStat {
  label: string;
  value: number;
  suffix?: string;
}

/** The editable site document (stored as JSON). Admin reads/writes it whole. */
export interface SiteSettings {
  brand: {
    /** Display name, e.g. "S5Y" or the owner's real name (Arabic allowed). */
    name: string;
    /** Instagram-style handle without "@", e.g. "s5y". */
    handle: string;
    /** Professional title, e.g. "صانع محتوى · مصوّر ومونتير". */
    title: string;
    /** One-line hero tagline. */
    tagline: string;
    /** Short Latin mark used in 3D/HUD elements, e.g. "S5Y". */
    heroMark: string;
    /** Accent color (#rrggbb) used across the site. */
    accent: string;
  };
  about: {
    heading: string;
    body: string;
    avatarKey: string | null;
    location: string;
    /** Year the owner started working (for "years of experience"). */
    since: number | null;
  };
  /** Custom stats; when empty the site shows automatic stats (places, videos, plays). */
  stats: SiteStat[];
  contact: {
    /** International format without "+", e.g. "9647700000000". */
    whatsapp: string;
    phone: string;
    email: string;
    instagram: string;
    tiktok: string;
    youtube: string;
    snapchat: string;
    address: string;
  };
  hero: {
    /** Explicit videos for the 3D hero screens (max 7). Empty → featured videos. */
    videoIds: string[];
  };
  sections: {
    about: boolean;
    showreel: boolean;
    /** Subscription packages section. Off by default (future feature). */
    plans: boolean;
    contact: boolean;
  };
  seo: {
    title: string;
    description: string;
    keywords: string;
    ogImageKey: string | null;
  };
}

/* ─────────────────────────── Public (portfolio) ─────────────────────────── */

export interface PublicSite {
  brand: SiteSettings['brand'];
  about: Omit<SiteSettings['about'], 'avatarKey'> & { avatarUrl: string | null };
  /** Resolved stats (custom ones, or automatic ones when none are configured). */
  stats: SiteStat[];
  contact: SiteSettings['contact'];
  sections: SiteSettings['sections'];
  seo: Omit<SiteSettings['seo'], 'ogImageKey'> & { ogImageUrl: string | null };
  counts: { places: number; videos: number; plays: number };
}

export interface PublicVideo {
  id: string;
  placeId: string;
  title: string | null;
  description: string | null;
  /** Full-quality playable MP4 (H.264, faststart when ffmpeg is available). */
  url: string;
  /** Short, muted, low-res loop for hover previews and 3D textures. May be null. */
  previewUrl: string | null;
  posterUrl: string | null;
  durationSec: number | null;
  width: number | null;
  height: number | null;
  /** width / height (e.g. 0.5625 for vertical 9:16). null when unknown. */
  aspect: number | null;
  featured: boolean;
  plays: number;
}

export interface PlaceSummary {
  id: string;
  slug: string;
  name: string;
  category: string | null;
  location: string | null;
  summary: string | null;
  coverUrl: string | null;
  logoUrl: string | null;
  accentColor: string;
  year: number | null;
  featured: boolean;
  videoCount: number;
  /** Up to 3 first READY+published videos (for hover previews / 3D). */
  previews: PublicVideo[];
}

export interface PlaceLink {
  slug: string;
  name: string;
}

export interface PlaceDetail extends PlaceSummary {
  description: string | null;
  services: string[];
  instagram: string | null;
  website: string | null;
  /** All READY + published videos, in admin-defined order. */
  videos: PublicVideo[];
  prev: PlaceLink | null;
  next: PlaceLink | null;
}

export interface PublicPlan {
  id: string;
  name: string;
  tagline: string | null;
  /** null → "حسب الطلب" (price on request). */
  price: number | null;
  currency: string;
  period: PlanPeriod;
  features: string[];
  highlighted: boolean;
  ctaLabel: string | null;
}

/** GET /api/public/home — everything the home page needs in one request. */
export interface HomeData {
  site: PublicSite;
  /** 0–7 videos for the 3D hero screens. */
  heroVideos: PublicVideo[];
  /** Published places in admin order. */
  places: PlaceSummary[];
  /** Featured videos for the showreel row (max 12). */
  showreel: PublicVideo[];
  /** Active plans — always [] when sections.plans is false. */
  plans: PublicPlan[];
}

/** POST /api/public/inquiries */
export interface InquiryInput {
  name: string;
  phone?: string;
  email?: string;
  message: string;
  planId?: string;
  /** Where the form was submitted from, e.g. "home", "place:<slug>", "plan". */
  source?: string;
  /** Honeypot — must be empty/absent. Bots fill it. */
  website?: string;
}

export interface InquiryCreated {
  ok: true;
  id: string;
}

/** POST /api/public/track — fire-and-forget analytics (returns 204). */
export type TrackEvent =
  | { type: 'pageview'; path: string }
  | { type: 'play'; videoId: string };

/* ─────────────────────────── Admin ─────────────────────────── */

export interface AdminUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  lastLoginAt: string | null;
}

export interface LoginInput {
  email: string;
  password: string;
}

export interface ChangePasswordInput {
  currentPassword: string;
  newPassword: string;
}

export interface PlaceInput {
  name: string;
  /** Optional; auto-generated from name when omitted. Lowercase a-z0-9 and "-". */
  slug?: string;
  category?: string | null;
  location?: string | null;
  summary?: string | null;
  description?: string | null;
  coverKey?: string | null;
  logoKey?: string | null;
  accentColor?: string;
  instagram?: string | null;
  website?: string | null;
  year?: number | null;
  services?: string[];
  featured?: boolean;
  published?: boolean;
}

export interface AdminPlace {
  id: string;
  slug: string;
  name: string;
  category: string | null;
  location: string | null;
  summary: string | null;
  description: string | null;
  coverKey: string | null;
  coverUrl: string | null;
  logoKey: string | null;
  logoUrl: string | null;
  accentColor: string;
  instagram: string | null;
  website: string | null;
  year: number | null;
  services: string[];
  featured: boolean;
  published: boolean;
  sortOrder: number;
  videoCount: number;
  readyCount: number;
  /** Poster of the first video, handy as a fallback thumbnail. */
  thumbUrl: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AdminVideo {
  id: string;
  placeId: string;
  title: string | null;
  description: string | null;
  status: VideoStatus;
  processingError: string | null;
  originalName: string | null;
  mimeType: string | null;
  sizeBytes: number;
  uploadedBytes: number;
  /** null until the upload is complete. */
  url: string | null;
  previewUrl: string | null;
  posterKey: string | null;
  posterUrl: string | null;
  durationSec: number | null;
  width: number | null;
  height: number | null;
  featured: boolean;
  published: boolean;
  sortOrder: number;
  plays: number;
  createdAt: string;
  updatedAt: string;
}

export interface AdminVideoWithPlace extends AdminVideo {
  placeName: string;
  placeSlug: string;
}

export interface AdminPlaceDetail extends AdminPlace {
  videos: AdminVideo[];
}

export interface VideoUpdateInput {
  title?: string | null;
  description?: string | null;
  featured?: boolean;
  published?: boolean;
  posterKey?: string | null;
  placeId?: string;
}

/** POST /api/admin/videos/uploads */
export interface VideoUploadInit {
  placeId: string;
  fileName: string;
  size: number;
  mimeType: string;
  title?: string | null;
}

export interface VideoUploadSession {
  videoId: string;
  /** Max bytes per PATCH chunk. */
  chunkSize: number;
  /** Bytes already received (resume point). */
  offset: number;
  size: number;
}

/** POST /api/admin/videos/:id/upload/complete — optional client-side metadata. */
export interface VideoUploadComplete {
  durationSec?: number | null;
  width?: number | null;
  height?: number | null;
  posterKey?: string | null;
}

/** POST /api/admin/uploads/image */
export interface UploadedImage {
  key: string;
  url: string;
  width: number | null;
  height: number | null;
}

export interface PlanInput {
  name: string;
  tagline?: string | null;
  price?: number | null;
  currency?: string;
  period?: PlanPeriod;
  features?: string[];
  highlighted?: boolean;
  ctaLabel?: string | null;
  active?: boolean;
}

export interface AdminPlan {
  id: string;
  name: string;
  tagline: string | null;
  price: number | null;
  currency: string;
  period: PlanPeriod;
  features: string[];
  highlighted: boolean;
  ctaLabel: string | null;
  active: boolean;
  sortOrder: number;
  inquiryCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface AdminInquiry {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  message: string;
  status: InquiryStatus;
  notes: string | null;
  planId: string | null;
  planName: string | null;
  source: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface InquiryUpdateInput {
  status?: InquiryStatus;
  notes?: string | null;
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface InquiryList extends Paginated<AdminInquiry> {
  counts: Record<InquiryStatus, number>;
}

export interface SettingsResponse {
  settings: SiteSettings;
  urls: { avatarUrl: string | null; ogImageUrl: string | null };
}

export interface DailyPoint {
  /** YYYY-MM-DD (UTC). */
  date: string;
  views: number;
  plays: number;
}

/** GET /api/admin/overview?days=30 */
export interface Overview {
  counts: {
    places: number;
    videos: number;
    videosProcessing: number;
    videosFailed: number;
    inquiriesNew: number;
    plans: number;
    plays: number;
    views: number;
    storageBytes: number;
  };
  /** One point per day for the requested range, oldest first, zero-filled. */
  series: DailyPoint[];
  topVideos: AdminVideoWithPlace[];
  topPlaces: { id: string; name: string; slug: string; views: number }[];
  recentInquiries: AdminInquiry[];
  /** Whether the server can transcode/generate posters (ffmpeg found). */
  mediaProcessing: boolean;
}

export interface ReorderInput {
  ids: string[];
}
