import type { InquiryCreated } from '@s5y/shared';
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../../context.js';
import { fakeRowId } from '../../lib/crypto.js';
import { fieldError, notFound } from '../../lib/errors.js';
import { SLUG_RE } from '../../lib/slug.js';
import { idSchema, parse, z } from '../../lib/validation.js';
import { RATE_LIMITS } from '../../plugins/security.js';
import { inquiryInputSchema, trackEventSchema } from './schemas.js';

const PUBLIC_CACHE = 'public, max-age=30, stale-while-revalidate=300';
const WORK_PATH_RE = /^\/work\/([^/?#]+)\/?$/;

const slugParams = z.object({ slug: z.string().max(80) });

export async function publicRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  // Short shared caching on successful reads; writes and errors are never cached.
  app.addHook('onSend', async (request, reply, payload) => {
    if (!reply.hasHeader('cache-control')) {
      const cacheable = (request.method === 'GET' || request.method === 'HEAD') && reply.statusCode < 400;
      reply.header('cache-control', cacheable ? PUBLIC_CACHE : 'no-store');
    }
    return payload;
  });

  // sendBeacon may post `text/plain`; accept it for the track endpoint and parse it as JSON.
  app.removeContentTypeParser('text/plain');
  app.addContentTypeParser('text/plain', { parseAs: 'string', bodyLimit: 4096 }, (_req, body, done) => {
    try {
      done(null, body === '' ? {} : JSON.parse(body as string));
    } catch {
      done(null, {});
    }
  });

  app.get('/home', async () => ctx.publicData.home());

  app.get('/site', async () => ctx.publicData.site());

  app.get('/places', async () => ctx.publicData.places());

  app.get('/places/:slug', async (request) => {
    const { slug } = parse(slugParams, request.params);
    const place = SLUG_RE.test(slug) ? await ctx.publicData.place(slug) : null;
    if (!place) throw notFound('المكان غير موجود');
    return place;
  });

  app.get('/plans', async () => ctx.publicData.plans());

  app.post('/inquiries', { config: { rateLimit: RATE_LIMITS.inquiries } }, async (request, reply) => {
    const raw = (request.body ?? {}) as Record<string, unknown>;
    // Honeypot: bots fill hidden fields. Pretend success, store nothing.
    if (typeof raw.website === 'string' && raw.website.trim() !== '') {
      request.log.info('inquiry honeypot triggered');
      const fake: InquiryCreated = { ok: true, id: fakeRowId() };
      return reply.code(201).send(fake);
    }
    const input = parse(inquiryInputSchema, raw);
    if (input.planId) {
      const plan = await ctx.prisma.plan.findFirst({ where: { id: input.planId, active: true }, select: { id: true } });
      if (!plan) throw fieldError('planId', 'الباقة المختارة غير متوفرة حالياً');
    }
    const created = await ctx.prisma.inquiry.create({
      data: {
        name: input.name,
        phone: input.phone ?? null,
        email: input.email ?? null,
        message: input.message,
        planId: input.planId ?? null,
        source: input.source ?? null,
      },
      select: { id: true },
    });
    const body: InquiryCreated = { ok: true, id: created.id };
    return reply.code(201).send(body);
  });

  app.post('/track', { config: { rateLimit: RATE_LIMITS.track }, logLevel: 'warn' }, async (request, reply) => {
    const event = parse(trackEventSchema, request.body ?? {});
    if (event.type === 'pageview') {
      await ctx.stats.increment('pageview');
      const slug = WORK_PATH_RE.exec(event.path)?.[1];
      if (slug && SLUG_RE.test(slug)) {
        const place = await ctx.prisma.place.findFirst({ where: { slug, published: true }, select: { id: true } });
        if (place) await ctx.stats.increment('place_view', place.id);
      }
    } else if (idSchema.safeParse(event.videoId).success) {
      const updated = await ctx.prisma.video.updateMany({
        where: { id: event.videoId, status: 'READY', published: true, place: { published: true } },
        data: { plays: { increment: 1 } },
      });
      if (updated.count > 0) await ctx.stats.increment('play', event.videoId);
    }
    return reply.code(204).send();
  });
}
