import './types.js';
import cookie from '@fastify/cookie';
import type { PrismaClient } from '@prisma/client';
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import type { Config } from './config.js';
import { type AppContext, bootstrapContext, createContext, runMaintenance } from './context.js';
import { notFound } from './lib/errors.js';
import { cleanStringsDeep } from './lib/sanitize.js';
import type { MediaTools } from './media/ffmpeg.js';
import { registerErrorHandling, sendError } from './plugins/errors.js';
import { registerSecurity } from './plugins/security.js';
import { adminRoutes } from './routes/admin/index.js';
import { healthRoutes } from './routes/health.js';
import { publicRoutes } from './routes/public/index.js';
import { registerFrontends } from './web/frontends.js';
import { mediaRoutes } from './web/media.js';
import { seoRoutes } from './web/seo.js';

export interface BuildAppOptions {
  config: Config;
  /** Reuse an existing client (tests); otherwise one is created and disconnected on close. */
  prisma?: PrismaClient;
  /** Override ffmpeg detection, e.g. `{ available: false, … }` to simulate a server without ffmpeg. */
  tools?: MediaTools;
  /** Fastify logger options; defaults to pino (pretty in development, JSON in production). */
  logger?: FastifyServerOptions['logger'];
  /** Run first-boot tasks (default settings, owner account, resume jobs) when the app is ready. Default true. */
  bootstrap?: boolean;
  /** Periodic housekeeping interval in ms (0 disables). Default 6 h. */
  maintenanceIntervalMs?: number;
}

/**
 * Proxies trusted for `TRUST_PROXY=true`: loopback, link-local, private networks (Docker/Compose, Nginx or
 * Caddy on the same host, Render/Heroku 10.x) and carrier-grade NAT space (Railway & other PaaS edges).
 * Fastify's own `true` would trust *every* hop, so whoever can reach the app port directly could pick any
 * client IP via `X-Forwarded-For` and bypass the per-IP rate limits (login, inquiries, track).
 */
export const PRIVATE_PROXY_RANGES = ['loopback', 'linklocal', 'uniquelocal', '100.64.0.0/10'];

export function fastifyTrustProxy(value: Config['trustProxy']): FastifyServerOptions['trustProxy'] {
  if (value === true) return PRIVATE_PROXY_RANGES;
  // A hop count is expressed as a function (Fastify's typings only accept boolean | string | string[] | fn).
  if (typeof value === 'number') return ((hops: number) => (_address: string, hop: number) => hop < hops)(value);
  return value;
}

function defaultLogger(config: Config): FastifyServerOptions['logger'] {
  const redact = ['req.headers.cookie', 'req.headers.authorization', 'res.headers["set-cookie"]'];
  if (config.env === 'development') {
    return {
      level: config.logLevel,
      redact,
      transport: { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname', singleLine: true } },
    };
  }
  return { level: config.logLevel, redact };
}

export async function buildApp(options: BuildAppOptions): Promise<FastifyInstance> {
  const { config } = options;

  const app = Fastify({
    logger: options.logger ?? defaultLogger(config),
    trustProxy: fastifyTrustProxy(config.trustProxy),
    bodyLimit: 1024 * 1024,
    routerOptions: { ignoreTrailingSlash: true, maxParamLength: 200 },
    forceCloseConnections: 'idle',
    return503OnClosing: true,
  });

  const ctx: AppContext = await createContext({ config, log: app.log, prisma: options.prisma, tools: options.tools });
  app.decorate('ctx', ctx);
  app.decorateRequest('auth', null);

  registerErrorHandling(app);

  // Same secure parser as Fastify's default, but an empty body with a JSON content type is treated as
  // "no body" (many fetch wrappers always send the header, e.g. on logout or reprocess).
  const jsonParser = app.getDefaultJsonParser('error', 'error');
  app.removeContentTypeParser('application/json');
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (request, body, done) => {
    if ((body as string).trim() === '') done(null, undefined);
    else jsonParser(request, body as string, done);
  });

  // NUL characters / lone surrogates in client strings would make PostgreSQL throw (→ 500): clean them
  // before any route validates the input (bodies, query strings and params alike).
  app.addHook('preValidation', async (request) => {
    request.body = cleanStringsDeep(request.body);
    request.query = cleanStringsDeep(request.query);
    request.params = cleanStringsDeep(request.params);
  });

  await app.register(cookie);
  await registerSecurity(app, ctx);

  await healthRoutes(app, ctx);
  await app.register(async (scope) => publicRoutes(scope, ctx), { prefix: '/api/public' });
  await app.register(async (scope) => adminRoutes(scope, ctx), { prefix: '/api/admin' });
  await app.register(async (scope) => mediaRoutes(scope, ctx));
  await app.register(async (scope) => seoRoutes(scope, ctx));
  const frontends = await registerFrontends(app, ctx);

  app.setNotFoundHandler({ preHandler: app.rateLimit() }, async (request, reply) =>
    sendError(request, reply, notFound(request.url.startsWith('/api') ? 'المسار غير موجود' : 'الصفحة غير موجودة')),
  );

  let maintenance: NodeJS.Timeout | undefined;
  app.addHook('onReady', async () => {
    if (options.bootstrap !== false) await bootstrapContext(ctx);
    if (!ctx.tools.available) app.log.warn('ffmpeg/ffprobe not found — videos are served as uploaded (no transcoding, previews or posters)');
    if (config.isProduction && config.adminPath === '/studio') {
      app.log.warn('ADMIN_PATH is still the default "/studio" — set a secret path in production');
    }
    app.log.info({ web: frontends.web, admin: frontends.admin, storage: ctx.storage.kind, ffmpeg: ctx.tools.version }, 'app ready');
    const interval = options.maintenanceIntervalMs ?? 6 * 3600_000;
    if (interval > 0) {
      maintenance = setInterval(() => {
        runMaintenance(ctx).catch((err: unknown) => app.log.warn({ err }, 'maintenance failed'));
      }, interval);
      maintenance.unref();
    }
  });

  app.addHook('onClose', async () => {
    if (maintenance) clearInterval(maintenance);
    await ctx.dispose();
  });

  return app;
}
