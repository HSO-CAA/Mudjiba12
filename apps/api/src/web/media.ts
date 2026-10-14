import fastifyStatic from '@fastify/static';
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context.js';
import { IMMUTABLE_CACHE_CONTROL } from '../storage/types.js';

const CONTENT_TYPES: Record<string, string> = {
  mp4: 'video/mp4',
  m4v: 'video/x-m4v',
  mov: 'video/quicktime',
  webm: 'video/webm',
  mkv: 'video/x-matroska',
  webp: 'image/webp',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  avif: 'image/avif',
};

/**
 * `/media/*` for files on this server's disk (the local driver, or video sources staged next to a remote driver):
 * Range (206), ETag/Last-Modified, immutable caching.
 * Only `images/` and `videos/` are reachable; dot-folders (temp uploads, work dirs) never are.
 */
export async function mediaRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  const root = ctx.storage.localMediaDir;
  if (!root) return;
  await app.register(fastifyStatic, {
    root,
    prefix: '/media/',
    decorateReply: false,
    index: false,
    list: false,
    dotfiles: 'deny',
    acceptRanges: true,
    etag: true,
    lastModified: true,
    cacheControl: false,
    logLevel: 'warn',
    allowedPath: (pathName) =>
      /^\/(?:images|videos)\//.test(pathName) && !pathName.split('/').some((segment) => segment.startsWith('.')),
    setHeaders: (reply, filePath) => {
      const ext = filePath.split('.').pop()?.toLowerCase() ?? '';
      const type = CONTENT_TYPES[ext];
      if (type) reply.header('content-type', type);
      reply.header('cache-control', IMMUTABLE_CACHE_CONTROL);
      reply.header('cross-origin-resource-policy', 'same-site');
      reply.header('x-content-type-options', 'nosniff');
    },
  });
}
