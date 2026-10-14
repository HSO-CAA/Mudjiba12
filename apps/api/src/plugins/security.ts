import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context.js';
import { AppError, forbidden } from '../lib/errors.js';

/** Per-route limits from docs/CONTRACT.md (`config: { rateLimit: … }`). */
export const RATE_LIMITS = {
  login: { max: 10, timeWindow: '15 minutes' },
  inquiries: { max: 5, timeWindow: '10 minutes' },
  track: { max: 120, timeWindow: '1 minute' },
} as const;

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export async function registerSecurity(app: FastifyInstance, ctx: AppContext): Promise<void> {
  const extraOrigins = ctx.storage.publicOrigin ? [ctx.storage.publicOrigin] : [];
  const directives: Record<string, string[]> = {
    'default-src': ["'self'"],
    'script-src': ["'self'"],
    'script-src-attr': ["'none'"],
    'style-src': ["'self'", "'unsafe-inline'"],
    'img-src': ["'self'", 'data:', 'blob:', ...extraOrigins],
    'media-src': ["'self'", 'blob:', ...extraOrigins],
    'font-src': ["'self'", 'data:'],
    'connect-src': ["'self'"],
    'worker-src': ["'self'", 'blob:'],
    'manifest-src': ["'self'"],
    'form-action': ["'self'"],
    'frame-ancestors': ["'none'"],
    'object-src': ["'none'"],
    'base-uri': ["'self'"],
  };
  // Only meaningful (and harmless) when the site is actually served over HTTPS.
  if (ctx.config.cookieSecure) directives['upgrade-insecure-requests'] = [];

  await app.register(helmet, {
    global: true,
    contentSecurityPolicy: { useDefaults: false, directives },
    crossOriginEmbedderPolicy: false,
    xFrameOptions: { action: 'deny' },
    crossOriginResourcePolicy: { policy: 'same-origin' },
    crossOriginOpenerPolicy: { policy: 'same-origin' },
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    strictTransportSecurity: ctx.config.cookieSecure ? { maxAge: 31_536_000, includeSubDomains: true } : false,
  });

  await app.register(rateLimit, {
    global: true,
    max: 600,
    timeWindow: '1 minute',
    keyGenerator: (request) => request.ip,
    errorResponseBuilder: (_request, context) =>
      new AppError(429, 'RATE_LIMITED', 'طلبات كثيرة خلال وقت قصير، حاول بعد شوي', {
        retryAfterSec: Math.max(1, Math.ceil(context.ttl / 1000)),
      }),
  });

  // CSRF defense-in-depth: every state-changing admin request must carry `X-S5Y-Admin: 1`.
  // Browsers never add custom headers to cross-site form posts, and a cross-origin fetch with one needs CORS (not enabled).
  app.addHook('onRequest', async (request) => {
    if (SAFE_METHODS.has(request.method)) return;
    // Match on the resolved route pattern, not the raw URL, so encoding tricks can't bypass it.
    const route = request.routeOptions.url ?? '';
    if (route !== '/api/admin' && !route.startsWith('/api/admin/')) return;
    if (request.headers['x-s5y-admin'] !== '1') throw forbidden('الطلب مرفوض (رأس الحماية X-S5Y-Admin مفقود)');
  });
}
