import type { PlanPeriod } from '@s5y/shared';

/**
 * Digit style for numbers in Arabic copy (prices, counters, counts, years).
 * The whole site uses ONE system: Western digits with Latin grouping — "750,000 د.ع", "$199", "1,284" —
 * which is what Iraqi customers read on price tags and in apps (and what the dashboard shows).
 * Never mix systems: Arabic-Indic digits with the Arabic separator "٬" render like a Latin comma in
 * many fonts ("٧٥٠,٠٠٠"), so `arab` is only kept as an explicit opt-in.
 * HUD readouts, timecodes and phone numbers always use Latin digits.
 */
export type Numerals = 'arab' | 'latn';
export const NUMERALS: Numerals = 'latn';

const nfCache = new Map<string, Intl.NumberFormat>();
function nf(numerals: Numerals, options: Intl.NumberFormatOptions = {}): Intl.NumberFormat {
  const key = `${numerals}|${JSON.stringify(options)}`;
  let f = nfCache.get(key);
  if (!f) {
    // `en-US` pins Latin digits with "," grouping and "." decimals on every browser/ICU version.
    f = new Intl.NumberFormat(numerals === 'latn' ? 'en-US' : 'ar-IQ-u-nu-arab', options);
    nfCache.set(key, f);
  }
  return f;
}

export function formatNumber(value: number, numerals: Numerals = NUMERALS): string {
  return nf(numerals, { maximumFractionDigits: 0 }).format(value);
}

/** Calendar years never get a thousands separator: 2025 → "2025". */
export function formatYear(year: number, numerals: Numerals = NUMERALS): string {
  return nf(numerals, { useGrouping: false, maximumFractionDigits: 0 }).format(year);
}

/** Stats with a Latin suffix ("12M+") read better with Latin digits. */
export function numeralsFor(suffix: string | null | undefined): Numerals {
  return suffix && /[A-Za-z]/.test(suffix) ? 'latn' : NUMERALS;
}

/** Converts Western digits inside an arbitrary string (e.g. "10 ريلز") to the chosen numerals. */
export function localizeDigits(text: string, numerals: Numerals = NUMERALS): string {
  if (numerals === 'latn') return text;
  return text.replace(/\d/g, (d) => String.fromCharCode(0x0660 + Number(d)));
}

/** Compact Arabic count: 12_400 → "12.4 ألف", 2_400_000 → "2.4 مليون". */
export function formatCompact(value: number, numerals: Numerals = NUMERALS): string {
  const f = nf(numerals, { maximumFractionDigits: 1 });
  if (value >= 1_000_000) return `${f.format(value / 1_000_000)} مليون`;
  if (value >= 10_000) return `${f.format(value / 1_000)} ألف`;
  return formatNumber(value, numerals);
}

export const PERIOD_LABELS: Record<PlanPeriod, string> = {
  MONTHLY: 'شهري',
  QUARTERLY: 'كل 3 أشهر',
  YEARLY: 'سنوي',
  ONE_TIME: 'مرة وحدة',
};

export function periodLabel(period: PlanPeriod): string {
  return localizeDigits(PERIOD_LABELS[period] ?? '');
}

export interface FormattedPrice {
  /** Main amount ("750,000") or the on-request label. */
  amount: string;
  /** Currency label shown next to the amount; empty when on request. */
  unit: string;
  /** The whole price for inline text: "750,000 د.ع", "$199", or the on-request label. */
  text: string;
  onRequest: boolean;
}

const CURRENCY_LABELS: Record<string, string> = {
  IQD: 'د.ع',
  USD: '$',
};

export function formatPrice(price: number | null, currency: string): FormattedPrice {
  if (price === null || !Number.isFinite(price)) return { amount: 'حسب الطلب', unit: '', text: 'حسب الطلب', onRequest: true };
  const code = currency.toUpperCase();
  const amount = formatNumber(price);
  const unit = CURRENCY_LABELS[code] ?? code;
  return { amount, unit, text: code === 'USD' ? `$${amount}` : `${amount} ${unit}`, onRequest: false };
}

/** 7.4 → "0:07", 75 → "1:15" (Latin digits, used in mono badges). */
export function formatDuration(totalSeconds: number | null | undefined): string {
  if (totalSeconds === null || totalSeconds === undefined || !Number.isFinite(totalSeconds) || totalSeconds < 0) return '--:--';
  const s = Math.floor(totalSeconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m);
  return `${h > 0 ? `${h}:` : ''}${mm}:${String(sec).padStart(2, '0')}`;
}

/** SMPTE-style timecode at 24 fps: "00:00:12:08". */
export function formatTimecode(seconds: number, fps = 24): string {
  const total = Math.max(0, seconds);
  const frames = Math.floor((total % 1) * fps);
  const s = Math.floor(total) % 60;
  const m = Math.floor(total / 60) % 60;
  const h = Math.floor(total / 3600);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(h)}:${p(m)}:${p(s)}:${p(frames)}`;
}

export function yearsSince(since: number | null | undefined, now = new Date()): number | null {
  if (!since || since > now.getFullYear()) return null;
  return Math.max(1, now.getFullYear() - since);
}

/** Arabic count agreement for years: "سنة", "سنتين", "3 سنوات", "12 سنة". */
export function yearsLabel(years: number): string {
  if (years <= 1) return 'سنة';
  if (years === 2) return 'سنتين';
  if (years <= 10) return `${formatNumber(years)} سنوات`;
  return `${formatNumber(years)} سنة`;
}

/** "فيديو واحد", "فيديوين", "3 فيديوهات", "12 فيديو" — Arabic count agreement. */
export function videosLabel(count: number): string {
  if (count === 0) return 'لا توجد فيديوهات';
  if (count === 1) return 'فيديو واحد';
  if (count === 2) return 'فيديوين';
  if (count >= 3 && count <= 10) return `${formatNumber(count)} فيديوهات`;
  return `${formatNumber(count)} فيديو`;
}

export function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** Arabic-safe plain text clamp (by characters, on a word boundary). */
export function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}
