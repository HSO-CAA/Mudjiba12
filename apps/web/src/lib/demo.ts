/**
 * Static preview build (`VITE_DEMO=1`, see scripts/build-preview.mjs): the site runs without a
 * backend, reading JSON snapshots bundled next to index.html. Compile-time constant, so the
 * production bundle drops every demo branch.
 */
export const DEMO = import.meta.env.VITE_DEMO === '1';

/** Maps a public API path to its bundled snapshot (relative to index.html), or null if it has none. */
export function demoSnapshot(path: string): string | null {
  if (path === '/api/public/home') return 'demo/home.json';
  if (path === '/api/public/site') return 'demo/site.json';
  if (path === '/api/public/places') return 'demo/places.json';
  if (path === '/api/public/plans') return 'demo/plans.json';
  const place = /^\/api\/public\/places\/([^/]+)$/.exec(path);
  return place ? `demo/places/${place[1]}.json` : null;
}
