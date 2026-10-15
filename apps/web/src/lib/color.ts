export type RGB = [number, number, number];

const HEX_RE = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;

export function isHexColor(value: string | null | undefined): value is string {
  return !!value && HEX_RE.test(value.trim());
}

export function hexToRgb(hex: string): RGB {
  const m = HEX_RE.exec(hex.trim());
  if (!m || !m[1]) return [233, 179, 95];
  let h = m[1];
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgbToHex([r, g, b]: RGB): string {
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}

export function safeColor(value: string | null | undefined, fallback = '#e9b35f'): string {
  if (!isHexColor(value)) return fallback;
  const v = value.trim();
  return v.startsWith('#') ? v : `#${v}`;
}

/** Relative luminance (WCAG). */
export function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }) as RGB;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio between two colours (1 – 21). */
export function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** The site's near-black stage (`--color-bg`): every accent-coloured text is checked against it. */
export const STAGE = '#060607';
const INK_DARK = '#050403';
const INK_LIGHT = '#ffffff';

/** Text colour for content ON a coloured fill: near-black or white, whichever contrasts more (≥ 4.5:1 for any fill). */
export function inkOn(hex: string): string {
  return contrast(hex, INK_DARK) >= contrast(hex, INK_LIGHT) ? INK_DARK : INK_LIGHT;
}

/**
 * The colour itself when it already reads at `target`:1 on `bg`, otherwise the closest lighter tint that does.
 * Used for accent-coloured text, since the owner can pick a dark accent in the dashboard.
 */
export function readableOn(hex: string, bg: string = STAGE, target = 7): string {
  const color = safeColor(hex);
  if (contrast(color, bg) >= target) return color;
  for (let t = 0.05; t < 1; t += 0.05) {
    const tint = mix(color, '#ffffff', t);
    if (contrast(tint, bg) >= target) return tint;
  }
  return '#ffffff';
}

export function mix(a: string, b: string, t: number): string {
  const ca = hexToRgb(a);
  const cb = hexToRgb(b);
  return rgbToHex([ca[0] + (cb[0] - ca[0]) * t, ca[1] + (cb[1] - ca[1]) * t, ca[2] + (cb[2] - ca[2]) * t]);
}

/** CSS variables for a place accent (fill, readable text tint, ink on top of the fill). */
export function placeAccentVars(hex: string | null | undefined, fallback?: string): Record<string, string> {
  const color = safeColor(hex, fallback);
  return { '--place-accent': color, '--place-accent-fg': readableOn(color), '--place-ink': inkOn(color) };
}

/** Applies the site accent to :root so CSS (and Tailwind `accent` utilities) follow the dashboard setting. */
export function applyAccent(hex: string): void {
  const color = safeColor(hex);
  const root = document.documentElement;
  root.style.setProperty('--accent', color);
  root.style.setProperty('--accent-fg', readableOn(color));
  root.style.setProperty('--accent-ink', inkOn(color));
  const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (meta) meta.content = '#060607';
}
