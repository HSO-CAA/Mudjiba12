import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../../context.js';
import { requireAdmin } from '../../plugins/auth.js';
import { authRoutes, sessionRoutes } from './auth.js';
import { imageUploadRoutes } from './images.js';
import { inquiryRoutes } from './inquiries.js';
import { overviewRoutes } from './overview.js';
import { placeRoutes } from './places.js';
import { planRoutes } from './plans.js';
import { settingsRoutes } from './settings.js';
import { videoRoutes } from './videos.js';

/** Everything under `/api/admin`. Only login/logout work without a session. */
export async function adminRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  app.addHook('onSend', async (_request, reply, payload) => {
    reply.header('cache-control', 'no-store');
    reply.header('x-robots-tag', 'noindex, nofollow');
    return payload;
  });

  await app.register(async (scope) => authRoutes(scope, ctx));

  await app.register(async (scope) => {
    scope.addHook('onRequest', requireAdmin(ctx));
    await scope.register(async (s) => sessionRoutes(s, ctx));
    await scope.register(async (s) => overviewRoutes(s, ctx));
    await scope.register(async (s) => placeRoutes(s, ctx));
    await scope.register(async (s) => videoRoutes(s, ctx));
    await scope.register(async (s) => imageUploadRoutes(s, ctx));
    await scope.register(async (s) => planRoutes(s, ctx));
    await scope.register(async (s) => inquiryRoutes(s, ctx));
    await scope.register(async (s) => settingsRoutes(s, ctx));
  });
}
