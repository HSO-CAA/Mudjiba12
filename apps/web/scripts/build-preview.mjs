#!/usr/bin/env node
/**
 * Builds a self-contained static preview of the public site (no backend needed):
 * the app in demo mode (VITE_DEMO=1, relative asset paths, in-memory routing) plus JSON snapshots
 * of a running API and the media files they reference.
 *
 *   node apps/web/scripts/build-preview.mjs --api http://localhost:4000 --storage apps/api/storage --out preview
 *
 * Options:
 *   --api <url>        running API to snapshot (default http://localhost:4000)
 *   --storage <dir>    local media root of that API (default apps/api/storage)
 *   --out <dir>        output folder (default preview)
 *   --full-videos      ship full-quality videos (default: the short previews stand in, to keep it light)
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const WEB_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPO_ROOT = path.resolve(WEB_ROOT, '../..');

function option(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : process.argv[i + 1];
}

const apiUrl = option('api', 'http://localhost:4000').replace(/\/+$/, '');
const storageDir = path.resolve(REPO_ROOT, option('storage', 'apps/api/storage'));
const outDir = path.resolve(REPO_ROOT, option('out', 'preview'));
const fullVideos = process.argv.includes('--full-videos');

async function getJson(route) {
  const res = await fetch(`${apiUrl}${route}`);
  if (!res.ok) throw new Error(`GET ${route} → HTTP ${res.status}`);
  return res.json();
}

const copied = new Map();

/** Copies a `/media/<key>` file into the preview and returns its relative URL. */
async function localMedia(url) {
  const key = url.replace(/^\/media\//, '').split('?')[0];
  if (!/^(?:images|videos)\/[A-Za-z0-9_\-/.]+$/.test(key) || key.includes('..')) throw new Error(`Unexpected media key: ${key}`);
  if (!copied.has(key)) {
    const dest = path.join(outDir, 'demo/media', key);
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.copyFile(path.join(storageDir, key), dest);
    copied.set(key, `demo/media/${key}`);
  }
  return copied.get(key);
}

/** Deep-rewrites media URLs; videos fall back to their preview clip unless --full-videos. */
async function rewrite(value) {
  if (Array.isArray(value)) return Promise.all(value.map(rewrite));
  if (value && typeof value === 'object') {
    const isVideo = typeof value.url === 'string' && typeof value.previewUrl === 'string' && 'posterUrl' in value;
    const source = isVideo && !fullVideos ? { ...value, url: value.previewUrl } : value;
    const out = {};
    for (const [k, v] of Object.entries(source)) out[k] = await rewrite(v);
    return out;
  }
  if (typeof value === 'string' && value.startsWith('/media/')) return localMedia(value);
  return value;
}

async function writeJson(rel, data) {
  const file = path.join(outDir, 'demo', rel);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(await rewrite(data)));
}

const escapeHtml = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

async function main() {
  await fs.rm(outDir, { recursive: true, force: true });

  const build = spawnSync('npx', ['vite', 'build', '--base', './', '--outDir', outDir, '--emptyOutDir'], {
    cwd: WEB_ROOT,
    stdio: 'inherit',
    env: { ...process.env, VITE_DEMO: '1' },
  });
  if (build.status !== 0) process.exit(build.status ?? 1);

  const home = await getJson('/api/public/home');
  const site = await getJson('/api/public/site');
  const places = await getJson('/api/public/places');
  await writeJson('home.json', home);
  await writeJson('site.json', site);
  await writeJson('places.json', places);
  await writeJson('plans.json', home.plans);
  for (const place of places) await writeJson(`places/${place.slug}.json`, await getJson(`/api/public/places/${place.slug}`));

  const indexFile = path.join(outDir, 'index.html');
  const title = escapeHtml(`${site.brand.name} — معاينة`);
  const head = [
    `<title>${title}</title>`,
    `<meta name="description" content="${escapeHtml(site.seo.description)}">`,
    '<meta name="robots" content="noindex,nofollow">',
  ].join('\n    ');
  const html = await fs.readFile(indexFile, 'utf8');
  if (!html.includes('<!--s5y-head-->')) throw new Error('index.html is missing the <!--s5y-head--> placeholder');
  await fs.writeFile(indexFile, html.replace('<!--s5y-head-->', head));

  console.log(`\nPreview ready in ${path.relative(REPO_ROOT, outDir)}/ — ${places.length} places, ${copied.size} media files.`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
