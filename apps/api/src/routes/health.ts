import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context.js';

export async function healthRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  app.get('/api/health', { logLevel: 'warn' }, async (_request, reply) => {
    let db = true;
    try {
      await ctx.prisma.$queryRaw`SELECT 1`;
    } catch {
      db = false;
    }
    reply.header('cache-control', 'no-store');
    if (!db) reply.code(503);
    return { ok: db, db, ffmpeg: ctx.tools.available, version: ctx.config.version };
  });
}
