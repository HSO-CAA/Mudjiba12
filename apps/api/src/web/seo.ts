import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context.js';

const xml = (value: string): string =>
  value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c] as string);

const day = (d: Date): string => d.toISOString().slice(0, 10);

/** robots.txt + sitemap.xml — public pages only (the dashboard path is never listed). */
export async function seoRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  const { publicUrl } = ctx.config;

  app.get('/robots.txt', async (_request, reply) => {
    const body = ['User-agent: *', 'Allow: /', 'Disallow: /api/', '', `Sitemap: ${publicUrl}/sitemap.xml`, ''].join('\n');
    return reply.header('cache-control', 'public, max-age=3600').type('text/plain; charset=utf-8').send(body);
  });

  app.get('/sitemap.xml', async (_request, reply) => {
    const places = await ctx.prisma.place.findMany({
      where: { published: true },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      select: { slug: true, updatedAt: true },
    });
    const settingsRow = await ctx.prisma.setting.findUnique({ where: { key: 'site' }, select: { updatedAt: true } });
    const latest = [settingsRow?.updatedAt, ...places.map((p) => p.updatedAt)]
      .filter((d): d is Date => d instanceof Date)
      .reduce<Date | null>((max, d) => (!max || d > max ? d : max), null);

    const urls = [
      { loc: `${publicUrl}/`, lastmod: latest, priority: '1.0' },
      ...places.map((p) => ({ loc: `${publicUrl}/work/${p.slug}`, lastmod: p.updatedAt, priority: '0.8' })),
    ];
    const body = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
      ...urls.map(
        (u) =>
          `  <url><loc>${xml(u.loc)}</loc>${u.lastmod ? `<lastmod>${day(u.lastmod)}</lastmod>` : ''}<priority>${u.priority}</priority></url>`,
      ),
      '</urlset>',
      '',
    ].join('\n');
    return reply.header('cache-control', 'public, max-age=3600').type('application/xml; charset=utf-8').send(body);
  });
}
