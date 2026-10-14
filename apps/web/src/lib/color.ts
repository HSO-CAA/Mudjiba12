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

/** A readable ink colour on top of the given background. */
export function inkOn(hex: string): string {
  return luminance(hex) > 0.36 ? '#140f08' : '#f8f5ef';
}

export function mix(a: string, b: string, t: number): string {
  const ca = hexToRgb(a);
  const cb = hexToRgb(b);
  return rgbToHex([ca[0] + (cb[0] - ca[0]) * t, ca[1] + (cb[1] - ca[1]) * t, ca[2] + (cb[2] - ca[2]) * t]);
}

/** Applies the site accent to :root so CSS (and Tailwind `accent` utilities) follow the dashboard setting. */
export function applyAccent(hex: string): void {
  const color = safeColor(hex);
  const root = document.documentElement;
  root.style.setProperty('--accent', color);
  root.style.setProperty('--accent-ink', inkOn(color));
  const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (meta) meta.content = '#060607';
}
