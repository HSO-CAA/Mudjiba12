import { existsSync } from 'node:fs';
import path from 'node:path';
import fastifyStatic from '@fastify/static';
import type { SiteSettings } from '@s5y/shared';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { AppContext } from '../context.js';
import { sendError } from '../plugins/errors.js';
import { notFound } from '../lib/errors.js';
import { SLUG_RE } from '../lib/slug.js';
import { IMMUTABLE_CACHE_CONTROL } from '../storage/types.js';
import {
  type PageMeta,
  TemplateFile,
  WEB_HEAD_PLACEHOLDER,
  escapeHtml,
  injectAdminHead,
  injectHead,
  renderWebHead,
} from './html.js';

const WORK_RE = /^\/work\/([^/]+)\/?$/;

const pathnameOf = (request: FastifyRequest): string => {
  const raw = request.url.split('?')[0] ?? '/';
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
};

const hasExtension = (p: string): boolean => /\.[A-Za-z0-9]{1,8}$/.test(p.split('/').pop() ?? '');

const PUBLIC_FILE_CACHE = 'public, max-age=3600';

/**
 * Serves a Vite build: `assets/` (content-hashed → immutable, wildcard route so files from a rebuild are
 * served without a restart) plus the other root files copied from `public/` (short cache).
 * `index.html` is never served raw — it goes through the HTML injection handlers.
 */
async function registerDist(
  app: FastifyInstance,
  root: string,
  prefix: string,
  ignore: string[],
  extraHeaders: Record<string, string> = {},
): Promise<void> {
  const common = { decorateReply: false, cacheControl: false, index: false as const, logLevel: 'warn' as const };
  const assets = path.join(root, 'assets');
  if (existsSync(assets)) {
    await app.register(fastifyStatic, {
      ...common,
      root: assets,
      prefix: `${prefix}assets/`,
      setHeaders: (reply) => {
        reply.header('cache-control', IMMUTABLE_CACHE_CONTROL);
        for (const [k, v] of Object.entries(extraHeaders)) reply.header(k, v);
      },
    });
  }
  await app.register(fastifyStatic, {
    ...common,
    root,
    prefix,
    wildcard: false,
    globIgnore: ['index.html', 'assets/**', ...ignore],
    setHeaders: (reply) => {
      reply.header('cache-control', PUBLIC_FILE_CACHE);
      for (const [k, v] of Object.entries(extraHeaders)) reply.header(k, v);
    },
  });
}

export interface FrontendsStatus {
  web: boolean;
  admin: boolean;
}

/** Production serving of the two Vite builds (skipped gracefully when a dist folder is missing). */
export async function registerFrontends(app: FastifyInstance, ctx: AppContext): Promise<FrontendsStatus> {
  const { config } = ctx;
  const adminIndex = path.join(config.adminDist, 'index.html');
  const webIndex = path.join(config.webDist, 'index.html');
  const status: FrontendsStatus = { web: existsSync(webIndex), admin: existsSync(adminIndex) };

  /* ───────────── Admin dashboard at ADMIN_PATH (never linked from the public site) ───────────── */
  if (status.admin) {
    const template = new TemplateFile(adminIndex);
    const base = config.adminPath;
    const head = [
      `<base href="${escapeHtml(base)}/">`,
      `<meta name="s5y-admin-base" content="${escapeHtml(base)}">`,
      '<meta name="robots" content="noindex,nofollow">',
    ].join('\n    ');

    await registerDist(app, config.adminDist, `${base}/`, [], { 'x-robots-tag': 'noindex, nofollow' });

    const serveAdmin = async (request: FastifyRequest, reply: FastifyReply) => {
      const rest = (request.params as { '*'?: string })['*'] ?? '';
      if (rest && hasExtension(rest)) return sendError(request, reply, notFound('الملف غير موجود'));
      const html = injectAdminHead(await template.read(), head);
      return reply
        .header('cache-control', 'no-cache')
        .header('x-robots-tag', 'noindex, nofollow')
        .header('referrer-policy', 'same-origin')
        .type('text/html; charset=utf-8')
        .send(html);
    };
    app.get(base, serveAdmin);
    app.get(`${base}/*`, serveAdmin);
  }

  /* ───────────── Public portfolio at "/" with SEO meta injection ───────────── */
  if (status.web) {
    const template = new TemplateFile(webIndex);

    await registerDist(app, config.webDist, '/', ['robots.txt', 'sitemap.xml']);

    const absolute = (url: string | null): string | null =>
      url ? (/^https?:\/\//i.test(url) ? url : `${config.publicUrl}${url.startsWith('/') ? '' : '/'}${url}`) : null;

    const siteMeta = (settings: SiteSettings, pathname: string): PageMeta => {
      const instagram = settings.contact.instagram;
      return {
        title: settings.seo.title || settings.brand.name,
        description: settings.seo.description || settings.brand.tagline,
        keywords: settings.seo.keywords,
        canonical: `${config.publicUrl}${pathname === '/' ? '/' : pathname}`,
        image: absolute(ctx.serialize.url(settings.seo.ogImageKey) ?? ctx.serialize.url(settings.about.avatarKey)),
        siteName: settings.brand.name,
        type: 'website',
        jsonLd:
          pathname === '/'
            ? {
                '@context': 'https://schema.org',
                '@type': 'Person',
                name: settings.brand.name,
                alternateName: settings.brand.handle ? `@${settings.brand.handle}` : undefined,
                jobTitle: settings.brand.title,
                description: settings.seo.description,
                url: `${config.publicUrl}/`,
                image: absolute(ctx.serialize.url(settings.about.avatarKey)) ?? undefined,
                address: settings.about.location ? { '@type': 'PostalAddress', addressCountry: 'IQ', addressLocality: settings.about.location } : undefined,
                sameAs: instagram
                  ? [/^https?:\/\//.test(instagram) ? instagram : `https://instagram.com/${instagram}`]
                  : undefined,
              }
            : undefined,
      };
    };

    const serveWeb = async (request: FastifyRequest, reply: FastifyReply) => {
      const pathname = pathnameOf(request);
      if (pathname === '/api' || pathname.startsWith('/api/') || pathname.startsWith('/media/')) {
        return sendError(request, reply, notFound('المسار غير موجود'));
      }
      const normalized = pathname === '/index.html' ? '/' : pathname;
      if (normalized !== '/' && hasExtension(normalized)) return sendError(request, reply, notFound('الملف غير موجود'));

      const settings = await ctx.settings.get();
      let meta = siteMeta(settings, normalized);
      let statusCode = 200;

      const slug = WORK_RE.exec(normalized)?.[1];
      if (slug !== undefined) {
        const place = SLUG_RE.test(slug)
          ? await ctx.prisma.place.findFirst({
              where: { slug, published: true },
              include: {
                videos: {
                  where: { status: 'READY', published: true, posterKey: { not: null } },
                  orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
                  take: 1,
                  select: { posterKey: true },
                },
              },
            })
          : null;
        if (place) {
          const description = (place.summary ?? place.description ?? '').trim().slice(0, 200) || settings.seo.description;
          const where = [place.category, place.location].filter(Boolean).join(' · ');
          meta = {
            ...meta,
            title: `${place.name}${where ? ` — ${where}` : ''} | ${settings.brand.name}`,
            description,
            canonical: `${config.publicUrl}/work/${place.slug}`,
            image: absolute(ctx.serialize.url(place.coverKey) ?? ctx.serialize.url(place.videos[0]?.posterKey)) ?? meta.image,
            type: 'article',
            jsonLd: undefined,
          };
        } else {
          statusCode = 404;
          meta = {
            ...meta,
            title: `المشهد مو موجود | ${settings.brand.name}`,
            description: 'الصفحة اللي تدور عليها غير موجودة.',
            noindex: true,
            jsonLd: undefined,
          };
        }
      }

      const html = injectHead(await template.read(), WEB_HEAD_PLACEHOLDER, renderWebHead(meta), true);
      return reply.code(statusCode).header('cache-control', 'no-cache').type('text/html; charset=utf-8').send(html);
    };
    app.get('/', serveWeb);
    app.get('/*', serveWeb);
  }

  return status;
}
