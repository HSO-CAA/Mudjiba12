import type { InquiryStatus, PlanPeriod, VideoStatus } from '@s5y/shared';

/* Numbers in the dashboard use Latin digits (set in mono); prices in previews mirror the public site. */

const latn = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const latn1 = new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 });

export const formatNumber = (value: number): string => latn.format(value);

/** 1284 → "1,284", 12_900 → "12.9K", 4_200_000 → "4.2M". */
export function formatCompact(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${latn1.format(value / 1_000_000)}M`;
  if (abs >= 10_000) return `${latn1.format(value / 1_000)}K`;
  return latn.format(value);
}

/** Axis ticks: 0 / 500 / 1K / 1.5K. */
export function formatTick(value: number): string {
  if (Math.abs(value) >= 1000) return `${latn1.format(value / 1000)}K`;
  return latn.format(value);
}

export function formatBytes(bytes: number, digits = 1): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const exp = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const value = bytes / 1024 ** exp;
  return `${value.toFixed(exp === 0 ? 0 : value >= 100 ? 0 : digits)} ${units[exp]}`;
}

export const formatSpeed = (bytesPerSec: number): string => `${formatBytes(bytesPerSec)}/s`;

/** Wraps Latin/number fragments in a bidi isolate so they keep their order inside Arabic sentences. */
export const ltr = (text: string): string => `\u2066${text}\u2069`;

/** 7.4 → "0:07", 75 → "1:15", 3725 → "1:02:05". */
export function formatDuration(totalSeconds: number | null | undefined): string {
  if (totalSeconds === null || totalSeconds === undefined || !Number.isFinite(totalSeconds) || totalSeconds < 0) return '--:--';
  const s = Math.round(totalSeconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m);
  return `${h > 0 ? `${h}:` : ''}${mm}:${String(sec).padStart(2, '0')}`;
}

/** Arabic count of minutes with the right noun form: دقيقة / دقيقتين / 3 دقائق / 15 دقيقة. */
export function formatMinutes(minutes: number): string {
  const n = Math.max(1, Math.round(minutes));
  if (n === 1) return 'دقيقة';
  if (n === 2) return 'دقيقتين';
  return `${n} ${n <= 10 ? 'دقائق' : 'دقيقة'}`;
}

/** Arabic count of videos: فيديو واحد / فيديوين / 3 فيديوهات / 12 فيديو. */
export function formatVideoCount(count: number): string {
  if (count === 1) return 'فيديو واحد';
  if (count === 2) return 'فيديوين';
  return `${latn.format(count)} ${count >= 3 && count <= 10 ? 'فيديوهات' : 'فيديو'}`;
}

/** Remaining time for uploads, in short Arabic. */
export function formatEta(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds)) return '—';
  if (seconds < 5) return 'ثوانٍ';
  if (seconds < 60) return `${Math.round(seconds)} ث`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)} د ${Math.round(seconds % 60)} ث`;
  return `${Math.floor(seconds / 3600)} س ${Math.floor((seconds % 3600) / 60)} د`;
}

const dateFmt = new Intl.DateTimeFormat('ar-IQ-u-nu-latn', { day: 'numeric', month: 'long', year: 'numeric' });
const dateTimeFmt = new Intl.DateTimeFormat('ar-IQ-u-nu-latn', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
});
const shortDateFmt = new Intl.DateTimeFormat('ar-IQ-u-nu-latn', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const rtf = new Intl.RelativeTimeFormat('ar-u-nu-latn', { numeric: 'auto' });

export const formatDate = (iso: string): string => dateFmt.format(new Date(iso));
export const formatDateTime = (iso: string): string => dateTimeFmt.format(new Date(iso));
/** For YYYY-MM-DD (UTC) series dates. */
export const formatSeriesDate = (ymd: string): string => shortDateFmt.format(new Date(`${ymd}T00:00:00Z`));

export function formatRelative(iso: string, now = Date.now()): string {
  const diff = (new Date(iso).getTime() - now) / 1000;
  const abs = Math.abs(diff);
  if (abs < 45) return 'الآن';
  if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute');
  if (abs < 86_400) return rtf.format(Math.round(diff / 3600), 'hour');
  if (abs < 86_400 * 7) return rtf.format(Math.round(diff / 86_400), 'day');
  return formatDate(iso);
}

/* ─────────────────────────── Prices (mirrors the public site) ─────────────────────────── */
/* One number system everywhere: Western digits + Latin grouping ("750,000 د.ع", "$199"), same as the site. */

export const CURRENCIES = [
  { code: 'IQD', label: 'دينار عراقي', unit: 'د.ع' },
  { code: 'USD', label: 'دولار أمريكي', unit: '$' },
] as const;

export function formatPrice(price: number | null, currency: string): { amount: string; unit: string; text: string; onRequest: boolean } {
  if (price === null || !Number.isFinite(price)) return { amount: 'حسب الطلب', unit: '', text: 'حسب الطلب', onRequest: true };
  const code = currency.toUpperCase();
  const amount = latn.format(price);
  const unit = code === 'IQD' ? 'د.ع' : code === 'USD' ? '$' : code;
  return { amount, unit, text: code === 'USD' ? `$${amount}` : `${amount} ${unit}`, onRequest: false };
}

export const PERIOD_LABELS: Record<PlanPeriod, string> = {
  MONTHLY: 'شهري',
  QUARTERLY: 'كل 3 أشهر',
  YEARLY: 'سنوي',
  ONE_TIME: 'مرة وحدة',
};

/* ─────────────────────────── Status labels ─────────────────────────── */

export const VIDEO_STATUS_LABELS: Record<VideoStatus, string> = {
  UPLOADING: 'رفع غير مكتمل',
  PROCESSING: 'قيد المعالجة',
  READY: 'جاهز',
  FAILED: 'فشلت المعالجة',
};

export const INQUIRY_STATUS_LABELS: Record<InquiryStatus, string> = {
  NEW: 'جديد',
  CONTACTED: 'تم التواصل',
  WON: 'تم الاتفاق',
  ARCHIVED: 'مؤرشف',
};

export const INQUIRY_STATUSES: InquiryStatus[] = ['NEW', 'CONTACTED', 'WON', 'ARCHIVED'];

/** "ملف.mp4" → "ملف" with separators turned into spaces — a sensible default video title. */
export function titleFromFileName(name: string): string {
  return name
    .replace(/\.[^.]+$/, '')
    .replace(/[_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
}

/** Digits only, for wa.me / tel: links. */
export const digitsOnly = (value: string): string => value.replace(/[^\d]/g, '');

/** Converts Arabic-Indic / Persian digits typed on a phone keyboard into Latin digits. */
export function normalizeDigits(value: string): string {
  return value
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0));
}

/** Where an inquiry came from (`InquiryInput.source`), in plain Arabic. */
export function formatSource(source: string): string {
  if (source === 'home') return 'الصفحة الرئيسية';
  if (source === 'plan' || source === 'plans') return 'قسم الباقات';
  if (source === 'contact') return 'فورم التواصل';
  if (source.startsWith('place:')) return `صفحة مكان (${source.slice(6)})`;
  return source;
}
