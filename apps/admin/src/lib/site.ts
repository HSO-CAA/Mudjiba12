/**
 * Links to the public portfolio. In production the dashboard is served by the API on the same origin
 * (under the secret ADMIN_PATH), so root-relative links work. In dev the public site runs on :5173.
 */
function siteOrigin(): string {
  const configured = import.meta.env.VITE_SITE_URL as string | undefined;
  if (configured) return configured.replace(/\/+$/, '');
  if (import.meta.env.DEV) return `${window.location.protocol}//${window.location.hostname}:5173`;
  return window.location.origin;
}

export const siteUrl = (path = '/'): string => `${siteOrigin()}${path.startsWith('/') ? path : `/${path}`}`;
export const placeSiteUrl = (slug: string): string => siteUrl(`/work/${encodeURIComponent(slug)}`);

/** Router basename injected by the API (`<meta name="s5y-admin-base">`); `/` in dev. */
export function routerBasename(): string {
  const meta = document.querySelector<HTMLMetaElement>('meta[name="s5y-admin-base"]')?.content ?? '/';
  const trimmed = meta.trim().replace(/\/+$/, '');
  return trimmed === '' ? '/' : trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
}

/** Same-origin check: media from another origin (S3/CDN) needs crossOrigin="anonymous" to be drawn on a canvas. */
export function isCrossOrigin(url: string): boolean {
  try {
    return new URL(url, window.location.href).origin !== window.location.origin;
  } catch {
    return false;
  }
}
