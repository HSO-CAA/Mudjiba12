#!/usr/bin/env node
/**
 * Netlify build: the site (/) and the dashboard (ADMIN_PATH) as static files, with Netlify's proxy forwarding
 * the API to the server that runs it (Railway, a VPS, …). Run by netlify.toml; locally:
 *
 *   API_URL=https://api.example.com ADMIN_PATH=/studio-k39x NETLIFY_PROXY_SECRET=… node deploy/netlify-build.mjs
 *
 * Netlify environment variables:
 *   API_URL               the API server's public address, e.g. https://raw-vision.up.railway.app   (required)
 *   ADMIN_PATH            the dashboard's secret path — the same value as on the API server        (required)
 *   NETLIFY_PROXY_SECRET  the same random secret as on the API server (24+ letters/digits/-/_)     (required)
 *   SUPABASE_URL          only when media is stored on Supabase Storage (allowed by the page's CSP)
 *   URL                   set by Netlify: the site's address, used for canonical / Open Graph links
 *
 * Output (netlify-dist/): the site at the root, the dashboard under ADMIN_PATH, plus `_redirects` (API proxy and
 * the two SPA fallbacks) and `_headers` (security headers and caching). Netlify reads both files at deploy and
 * does not serve them.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'netlify-dist');
const RESERVED = ['/api', '/media', '/work', '/assets', '/robots.txt', '/sitemap.xml', '/_nf'];

function fail(message) {
  console.error(`\n✖ ${message}\n`);
  process.exit(1);
}

function readEnv() {
  const apiRaw = (process.env.API_URL ?? '').trim();
  let api;
  try {
    api = new URL(apiRaw);
  } catch {
    fail('API_URL is missing or not a URL. Set it in Netlify → Site configuration → Environment variables, e.g. https://raw-vision.up.railway.app');
  }
  if (api.protocol !== 'https:' && api.hostname !== 'localhost' && api.hostname !== '127.0.0.1') fail('API_URL must start with https://');
  const apiUrl = api.origin;

  const adminPath = `/${(process.env.ADMIN_PATH ?? '').trim().replace(/^\/+|\/+$/g, '')}`;
  if (!/^(\/[A-Za-z0-9_-]+)+$/.test(adminPath)) fail('ADMIN_PATH is missing or invalid: letters, digits, "-" or "_", e.g. /studio-k39x (the same value as on the API server)');
  if (RESERVED.includes(`/${adminPath.split('/')[1]}`)) fail(`ADMIN_PATH must not start with ${RESERVED.join(', ')}`);

  const secret = (process.env.NETLIFY_PROXY_SECRET ?? '').trim();
  if (!/^[A-Za-z0-9_-]{24,128}$/.test(secret)) fail('NETLIFY_PROXY_SECRET is missing or invalid: 24–128 letters, digits, "-" or "_" (the same value as on the API server)');

  const mediaOrigins = [apiUrl];
  const supabase = (process.env.SUPABASE_URL ?? '').trim();
  if (supabase) {
    try {
      mediaOrigins.push(new URL(supabase).origin);
    } catch {
      fail('SUPABASE_URL is not a URL');
    }
  }
  const siteUrl = (process.env.URL ?? '').replace(/\/+$/, '') || null;
  return { apiUrl, adminPath, secret, mediaOrigins, siteUrl };
}

function run(command, args) {
  const res = spawnSync(command, args, { cwd: ROOT, stdio: 'inherit', env: process.env });
  if (res.status !== 0) fail(`${command} ${args.join(' ')} failed`);
}

const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const escapeJsonInHtml = (value) => JSON.stringify(value).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');

/** The site's own SEO data, read from the running API (falls back to neutral tags if it is unreachable). */
async function siteHead(apiUrl, siteUrl) {
  let site = null;
  try {
    const res = await fetch(`${apiUrl}/api/public/site`, { signal: AbortSignal.timeout(15000), headers: { accept: 'application/json' } });
    if (res.ok) site = await res.json();
    else console.warn(`! ${apiUrl}/api/public/site answered ${res.status}; using neutral meta tags`);
  } catch (err) {
    console.warn(`! could not reach ${apiUrl} (${err instanceof Error ? err.message : err}); using neutral meta tags`);
  }
  const name = site?.brand?.name || 'Raw Vision';
  const title = site?.seo?.title || name;
  const description = site?.seo?.description || site?.brand?.tagline || '';
  const image = site?.seo?.ogImageUrl || site?.about?.avatarUrl || null;
  const absolute = (url) => (url && /^https?:\/\//i.test(url) ? url : url && siteUrl ? `${siteUrl}${url.startsWith('/') ? '' : '/'}${url}` : null);
  const ogImage = absolute(image);
  const tags = [
    `<title>${escapeHtml(title)}</title>`,
    description && `<meta name="description" content="${escapeHtml(description)}">`,
    site?.seo?.keywords && `<meta name="keywords" content="${escapeHtml(site.seo.keywords)}">`,
    siteUrl && `<link rel="canonical" href="${escapeHtml(`${siteUrl}/`)}">`,
    `<meta property="og:type" content="website">`,
    `<meta property="og:site_name" content="${escapeHtml(name)}">`,
    `<meta property="og:title" content="${escapeHtml(title)}">`,
    description && `<meta property="og:description" content="${escapeHtml(description)}">`,
    siteUrl && `<meta property="og:url" content="${escapeHtml(`${siteUrl}/`)}">`,
    ogImage && `<meta property="og:image" content="${escapeHtml(ogImage)}">`,
    `<meta name="twitter:card" content="${ogImage ? 'summary_large_image' : 'summary'}">`,
    site &&
      `<script type="application/ld+json">${escapeJsonInHtml({
        '@context': 'https://schema.org',
        '@type': 'Person',
        name,
        ...(site.brand?.handle ? { alternateName: `@${site.brand.handle}` } : {}),
        ...(site.brand?.title ? { jobTitle: site.brand.title } : {}),
        ...(description ? { description } : {}),
        ...(siteUrl ? { url: `${siteUrl}/` } : {}),
      })}</script>`,
  ];
  return tags.filter(Boolean).join('\n    ');
}

async function inject(file, placeholder, html) {
  const text = await fs.readFile(file, 'utf8');
  if (!text.includes(placeholder)) fail(`${path.relative(ROOT, file)} has no ${placeholder} placeholder`);
  await fs.writeFile(file, text.replace(placeholder, html));
}

function redirectsFile({ apiUrl, adminPath, secret }) {
  const proxy = `${apiUrl}/_nf/${secret}`;
  return `# Generated by deploy/netlify-build.mjs — edit that script, not this file.
# API and SEO files: proxied to the API server (same origin for the browser: cookies, CSP and CORS stay simple).
/api/*        ${proxy}/api/:splat   200!
/robots.txt   ${proxy}/robots.txt   200!
/sitemap.xml  ${proxy}/sitemap.xml  200!
# Media is served straight from the API server (MEDIA_PUBLIC_URL); old relative links still work.
/media/*      ${apiUrl}/media/:splat  302
# Dashboard (single-page app) at its secret path.
${adminPath}      ${adminPath}/index.html  200
${adminPath}/*    ${adminPath}/index.html  200
# Public site (single-page app).
/*            /index.html  200
`;
}

function headersFile({ adminPath, mediaOrigins }) {
  const csp = [
    "default-src 'self'",
    "script-src 'self'",
    "script-src-attr 'none'",
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob: ${mediaOrigins.join(' ')}`,
    `media-src 'self' blob: ${mediaOrigins.join(' ')}`,
    "font-src 'self' data:",
    "connect-src 'self'",
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    'upgrade-insecure-requests',
  ].join('; ');
  return `# Generated by deploy/netlify-build.mjs — edit that script, not this file.
/*
  Content-Security-Policy: ${csp}
  Strict-Transport-Security: max-age=31536000; includeSubDomains
  X-Content-Type-Options: nosniff
  X-Frame-Options: DENY
  Referrer-Policy: strict-origin-when-cross-origin
  Cross-Origin-Opener-Policy: same-origin
  Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=()

/assets/*
  Cache-Control: public, max-age=31536000, immutable

${adminPath}/*
  X-Robots-Tag: noindex, nofollow
  Referrer-Policy: same-origin

${adminPath}/assets/*
  Cache-Control: public, max-age=31536000, immutable
`;
}

async function main() {
  const env = readEnv();
  console.log(`▶ Netlify build — API ${env.apiUrl}, dashboard at ${env.adminPath.replace(/(?<=^\/.{3}).*/, '…')}`);

  run('npm', ['run', 'build', '-w', '@s5y/web']);
  run('npm', ['run', 'build', '-w', '@s5y/admin']);

  await fs.rm(OUT, { recursive: true, force: true });
  await fs.cp(path.join(ROOT, 'apps/web/dist'), OUT, { recursive: true });
  const adminDir = path.join(OUT, ...env.adminPath.split('/').filter(Boolean));
  await fs.mkdir(path.dirname(adminDir), { recursive: true });
  await fs.cp(path.join(ROOT, 'apps/admin/dist'), adminDir, { recursive: true });

  await inject(path.join(OUT, 'index.html'), '<!--s5y-head-->', await siteHead(env.apiUrl, env.siteUrl));
  await inject(
    path.join(adminDir, 'index.html'),
    '<!--s5y-admin-head-->',
    [`<base href="${escapeHtml(env.adminPath)}/">`, `<meta name="s5y-admin-base" content="${escapeHtml(env.adminPath)}">`].join('\n    '),
  );

  await fs.writeFile(path.join(OUT, '_redirects'), redirectsFile(env));
  await fs.writeFile(path.join(OUT, '_headers'), headersFile(env));
  console.log(`✔ netlify-dist ready (site at /, dashboard at its secret path, API proxied to ${env.apiUrl})`);
}

main().catch((err) => fail(err instanceof Error ? err.stack ?? err.message : String(err)));
