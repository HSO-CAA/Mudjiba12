import fs from 'node:fs/promises';
import path from 'node:path';
import type { Prisma, Video } from '@prisma/client';
import type { AdminVideo, AdminVideoWithPlace, VideoStatus, VideoUploadSession } from '@s5y/shared';
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../../context.js';
import { AppError, STORAGE_MESSAGES, badRequest, conflict, notFound, payloadTooLarge, unsupportedMediaType } from '../../lib/errors.js';
import { idParams, idSchema, imageKeySchema, nullableText, parse, z } from '../../lib/validation.js';
import { looksLikeVideo } from '../../media/sniff.js';
import { RATE_LIMITS } from '../../plugins/security.js';
import { EXT_BY_VIDEO_MIME, VIDEO_EXTENSIONS, VIDEO_MIME_BY_EXT, type VideoExt, videoKeys } from '../../media/video.js';
import { videoWithPlaceInclude } from '../../services/serializers.js';
import { StorageObjectTooLargeError } from '../../storage/types.js';

/** Max bytes per PATCH chunk (contract: 8 MiB). */
export const CHUNK_SIZE = 8 * 1024 * 1024;
const CHUNK_BODY_LIMIT = CHUNK_SIZE + 1024 * 1024;
const DISK_HEADROOM_BYTES = 256 * 1024 * 1024;

const STATUSES = ['UPLOADING', 'PROCESSING', 'READY', 'FAILED'] as const satisfies readonly VideoStatus[];

const emptyToUndefined = (v: unknown) => (v === '' || v === null ? undefined : v);

const listQuery = z.object({
  placeId: z.preprocess(emptyToUndefined, idSchema.optional()),
  status: z.preprocess(emptyToUndefined, z.enum(STATUSES).optional()),
});

const initSchema = z.object({
  placeId: idSchema,
  fileName: z.string({ error: 'اسم الملف مطلوب' }).trim().min(1, 'اسم الملف مطلوب').max(255, 'اسم الملف طويل جداً'),
  size: z.number({ error: 'حجم الملف مطلوب' }).int().positive('حجم الملف لازم يكون أكبر من صفر'),
  mimeType: z.preprocess((v) => (v === null || v === undefined ? '' : v), z.string().trim().toLowerCase().max(200)),
  title: nullableText(150).optional(),
});

const optionalMetric = (max: number, int: boolean) =>
  z.preprocess(
    (v) => (v === 0 ? null : v),
    (int ? z.number().int().positive().max(max) : z.number().positive().max(max)).nullable().optional(),
  );

const completeSchema = z.object({
  durationSec: optionalMetric(24 * 3600, false),
  width: optionalMetric(16_384, true),
  height: optionalMetric(16_384, true),
  posterKey: imageKeySchema.nullable().optional(),
});

const updateSchema = z
  .object({
    title: nullableText(150),
    description: nullableText(2000),
    featured: z.boolean(),
    published: z.boolean(),
    posterKey: z.string().max(300).nullable(),
    placeId: idSchema,
  })
  .partial();

const extOf = (fileName: string): VideoExt | null => {
  const ext = path.extname(fileName).slice(1).toLowerCase();
  return (VIDEO_EXTENSIONS as readonly string[]).includes(ext) ? (ext as VideoExt) : null;
};

/** Container decided from the extension first, then the MIME type (browsers often send empty/odd types). */
function resolveContainer(fileName: string, mimeType: string): { ext: VideoExt; mime: string } | null {
  const byExt = extOf(fileName);
  const byMime = EXT_BY_VIDEO_MIME[mimeType.split(';')[0]?.trim() ?? ''];
  const ext = byExt ?? byMime ?? null;
  return ext ? { ext, mime: VIDEO_MIME_BY_EXT[ext] } : null;
}

const sanitizeFileName = (name: string): string =>
  path
    .basename(name.replace(/\\/g, '/'))
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .slice(0, 255) || 'video';

async function fileSize(file: string): Promise<number | null> {
  try {
    return (await fs.stat(file)).size;
  } catch {
    return null;
  }
}

/** Serializes concurrent requests per video (chunk writes, complete, delete). */
class KeyedLock {
  private readonly tails = new Map<string, Promise<unknown>>();

  async run<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(key) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(fn);
    const tail = next.catch(() => undefined);
    this.tails.set(key, tail);
    try {
      return await next;
    } finally {
      if (this.tails.get(key) === tail) this.tails.delete(key);
    }
  }
}

export async function videoRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  const { prisma, serialize, files, storage } = ctx;
  const locks = new KeyedLock();

  app.addContentTypeParser('application/octet-stream', { parseAs: 'buffer', bodyLimit: CHUNK_BODY_LIMIT }, (_req, body, done) =>
    done(null, body),
  );

  const getVideo = async (id: string): Promise<Video> => {
    const video = await prisma.video.findUnique({ where: { id } });
    if (!video) throw notFound('الفيديو غير موجود');
    return video;
  };

  const sessionOf = (video: Video, offset: number): VideoUploadSession => ({
    videoId: video.id,
    chunkSize: CHUNK_SIZE,
    offset,
    size: Number(video.sizeBytes),
  });

  /** Actual bytes on disk are the source of truth for the resume offset. */
  const syncOffset = async (video: Video): Promise<number> => {
    const tmp = files.uploadTempPath(video.id);
    let size = await fileSize(tmp);
    if (size === null) {
      await fs.writeFile(tmp, new Uint8Array(0));
      size = 0;
    }
    if (BigInt(size) !== video.uploadedBytes) {
      await prisma.video.update({ where: { id: video.id }, data: { uploadedBytes: size } });
    }
    return size;
  };

  const pruneHero = async (ids: Set<string>) =>
    ctx.settings.update((s) => {
      const kept = s.hero.videoIds.filter((v) => !ids.has(v));
      return kept.length === s.hero.videoIds.length ? null : { ...s, hero: { videoIds: kept } };
    });

  app.get('/videos', async (request): Promise<AdminVideoWithPlace[]> => {
    const query = parse(listQuery, request.query ?? {});
    const where: Prisma.VideoWhereInput = {};
    if (query.placeId) where.placeId = query.placeId;
    if (query.status) where.status = query.status;
    const rows = await prisma.video.findMany({ where, orderBy: [{ createdAt: 'desc' }], include: videoWithPlaceInclude, take: 2000 });
    return rows.map((v) => serialize.adminVideoWithPlace(v));
  });

  /* ───────────── chunked, resumable upload ───────────── */

  app.post('/videos/uploads', async (request, reply) => {
    const input = parse(initSchema, request.body ?? {});
    const place = await prisma.place.findUnique({ where: { id: input.placeId }, select: { id: true } });
    if (!place) throw notFound('المكان غير موجود');
    const container = resolveContainer(input.fileName, input.mimeType);
    if (!container) throw unsupportedMediaType('صيغة الفيديو غير مدعومة (MP4 أو MOV أو WebM أو MKV أو M4V)');
    if (input.size > ctx.config.maxVideoBytes) {
      throw payloadTooLarge(`حجم الفيديو أكبر من الحد المسموح (${Math.round(ctx.config.maxVideoBytes / 1024 / 1024)} ميغابايت)`);
    }
    try {
      const stats = await fs.statfs(ctx.paths.uploads);
      if (stats.bavail * stats.bsize < input.size * 2 + DISK_HEADROOM_BYTES) {
        throw new AppError(507, 'INSUFFICIENT_STORAGE', 'مساحة التخزين بالسيرفر غير كافية لهذا الفيديو');
      }
    } catch (err) {
      if (err instanceof AppError) throw err;
    }

    const last = await prisma.video.aggregate({ where: { placeId: input.placeId }, _max: { sortOrder: true } });
    const video = await prisma.video.create({
      data: {
        placeId: input.placeId,
        title: input.title ?? null,
        status: 'UPLOADING',
        originalName: sanitizeFileName(input.fileName),
        mimeType: container.mime,
        sizeBytes: input.size,
        uploadedBytes: 0,
        sortOrder: (last._max.sortOrder ?? -1) + 1,
      },
    });
    await fs.writeFile(files.uploadTempPath(video.id), new Uint8Array(0));
    request.log.info({ videoId: video.id, size: input.size }, 'video upload started');
    return reply.code(201).send(sessionOf(video, 0));
  });

  app.get('/videos/:id/upload', async (request): Promise<VideoUploadSession> => {
    const { id } = parse(idParams, request.params);
    return locks.run(id, async () => {
      const video = await getVideo(id);
      if (video.status !== 'UPLOADING') return sessionOf(video, Number(video.sizeBytes));
      return sessionOf(video, await syncOffset(video));
    });
  });

  app.patch('/videos/:id/upload', { bodyLimit: CHUNK_BODY_LIMIT, logLevel: 'warn', config: { rateLimit: RATE_LIMITS.upload } }, async (request) => {
    const { id } = parse(idParams, request.params);
    const header = request.headers['upload-offset'];
    const offsetRaw = Array.isArray(header) ? header[0] : header;
    if (offsetRaw === undefined || !/^\d{1,15}$/.test(offsetRaw.trim())) {
      throw badRequest('رأس Upload-Offset مفقود أو غير صالح');
    }
    const offset = Number(offsetRaw.trim());
    const body = request.body;
    if (!Buffer.isBuffer(body)) throw unsupportedMediaType('أرسل أجزاء الفيديو بصيغة application/octet-stream');

    return locks.run(id, async () => {
      const video = await getVideo(id);
      if (video.status !== 'UPLOADING') throw conflict('رفع هذا الفيديو مكتمل مسبقاً');
      const current = await syncOffset(video);
      if (offset !== current) {
        throw new AppError(409, 'OFFSET_MISMATCH', 'موضع الرفع غير متطابق، سيتم الاستئناف من الموضع الصحيح', { offset: current });
      }
      const size = Number(video.sizeBytes);
      if (body.length === 0) throw badRequest('الجزء المرسل فارغ');
      if (body.length > CHUNK_SIZE) throw badRequest(`حجم الجزء أكبر من المسموح (${CHUNK_SIZE} بايت)`);
      if (current + body.length > size) throw badRequest('البيانات المرسلة أكبر من حجم الملف المعلن');

      const handle = await fs.open(files.uploadTempPath(id), 'r+');
      try {
        await handle.write(body, 0, body.length, current);
      } finally {
        await handle.close();
      }
      const next = current + body.length;
      await prisma.video.update({ where: { id }, data: { uploadedBytes: next } });
      return { offset: next };
    });
  });

  app.post('/videos/:id/upload/complete', async (request): Promise<AdminVideo> => {
    const { id } = parse(idParams, request.params);
    const meta = parse(completeSchema, request.body ?? {});
    await files.assertImagesExist({ posterKey: meta.posterKey });

    const result = await locks.run(id, async () => {
      const video = await getVideo(id);
      if (video.status !== 'UPLOADING') return video; // idempotent retry after a lost response
      const size = Number(video.sizeBytes);
      const tmp = files.uploadTempPath(id);
      const received = (await fileSize(tmp)) ?? 0;
      if (received !== size) {
        throw new AppError(409, 'OFFSET_MISMATCH', 'الرفع غير مكتمل، كمّل إرسال باقي الملف', { offset: received, size });
      }

      const head = Buffer.alloc(64);
      const fh = await fs.open(tmp, 'r');
      try {
        await fh.read(head, 0, head.length, 0);
      } finally {
        await fh.close();
      }
      if (!looksLikeVideo(head)) {
        await fs.rm(tmp, { force: true });
        await prisma.video.update({
          where: { id },
          data: { status: 'FAILED', processingError: 'الملف المرفوع ليس فيديو صالح', uploadedBytes: 0 },
        });
        throw unsupportedMediaType('الملف المرفوع ليس فيديو صالح');
      }

      const container = resolveContainer(video.originalName ?? '', video.mimeType ?? '') ?? { ext: 'mp4', mime: 'video/mp4' };
      const sourceKey = videoKeys(id).source(container.ext);
      try {
        await storage.putFile(sourceKey, tmp, { contentType: container.mime, move: true });
      } catch (err) {
        // Only possible without ffmpeg (sources are otherwise kept on this server): retrying can't help.
        if (!(err instanceof StorageObjectTooLargeError)) throw err;
        await fs.rm(tmp, { force: true });
        await prisma.video.update({
          where: { id },
          data: { status: 'FAILED', processingError: STORAGE_MESSAGES.fileTooLarge, uploadedBytes: 0 },
        });
        throw payloadTooLarge(STORAGE_MESSAGES.fileTooLarge);
      }

      const processing = ctx.tools.available;
      const updated = await prisma.video.update({
        where: { id },
        data: {
          status: processing ? 'PROCESSING' : 'READY',
          processingError: null,
          sourceKey,
          fileKey: processing ? null : sourceKey,
          uploadedBytes: size,
          ...(meta.durationSec !== undefined ? { durationSec: meta.durationSec } : {}),
          ...(meta.width !== undefined ? { width: meta.width } : {}),
          ...(meta.height !== undefined ? { height: meta.height } : {}),
          ...(meta.posterKey ? { posterKey: meta.posterKey } : {}),
        },
      });
      if (processing) ctx.queue.enqueue(id);
      request.log.info({ videoId: id, processing }, 'video upload completed');
      return updated;
    });
    return serialize.adminVideo(result);
  });

  /* ───────────── video management ───────────── */

  app.get('/videos/:id', async (request): Promise<AdminVideo> => {
    const { id } = parse(idParams, request.params);
    return serialize.adminVideo(await getVideo(id));
  });

  app.patch('/videos/:id', async (request): Promise<AdminVideo> => {
    const { id } = parse(idParams, request.params);
    const input = parse(updateSchema, request.body ?? {});
    const video = await getVideo(id);
    const generatedPoster = videoKeys(id).poster;

    const data: Prisma.VideoUncheckedUpdateInput = {};
    if (input.title !== undefined) data.title = input.title;
    if (input.description !== undefined) data.description = input.description;
    if (input.featured !== undefined) data.featured = input.featured;
    if (input.published !== undefined) data.published = input.published;
    if (input.posterKey !== undefined) {
      const ok =
        input.posterKey === null ||
        input.posterKey === video.posterKey ||
        input.posterKey === generatedPoster ||
        imageKeySchema.safeParse(input.posterKey).success;
      if (!ok) throw badRequest('مفتاح صورة الغلاف غير صالح — ارفع الصورة أولاً');
      if (input.posterKey !== video.posterKey && input.posterKey !== generatedPoster) {
        await files.assertImagesExist({ posterKey: input.posterKey });
      }
      data.posterKey = input.posterKey;
    }
    if (input.placeId !== undefined && input.placeId !== video.placeId) {
      const target = await prisma.place.findUnique({ where: { id: input.placeId }, select: { id: true } });
      if (!target) throw notFound('المكان المطلوب غير موجود');
      const last = await prisma.video.aggregate({ where: { placeId: input.placeId }, _max: { sortOrder: true } });
      data.placeId = input.placeId;
      data.sortOrder = (last._max.sortOrder ?? -1) + 1;
    }

    const updated = await prisma.video.update({ where: { id }, data });
    const oldPoster = video.posterKey;
    if (input.posterKey !== undefined && oldPoster && oldPoster !== updated.posterKey) {
      if (oldPoster === generatedPoster) await storage.delete(oldPoster).catch(() => undefined);
      else await files.releaseImages([oldPoster]);
    }
    return serialize.adminVideo(updated);
  });

  app.post('/videos/:id/reprocess', async (request): Promise<AdminVideo> => {
    const { id } = parse(idParams, request.params);
    const video = await getVideo(id);
    if (video.status === 'UPLOADING') throw conflict('الفيديو لسه ما اكتمل رفعه');
    if (!video.sourceKey && !video.fileKey) throw conflict('ملف الفيديو غير موجود، ارفعه من جديد');
    if (!ctx.tools.available) throw conflict('معالجة الفيديو غير متاحة على هذا السيرفر (ffmpeg غير مثبت)');
    const updated = await prisma.video.update({ where: { id }, data: { status: 'PROCESSING', processingError: null } });
    ctx.queue.enqueue(id);
    return serialize.adminVideo(updated);
  });

  app.delete('/videos/:id', async (request, reply) => {
    const { id } = parse(idParams, request.params);
    await locks.run(id, async () => {
      const video = await getVideo(id);
      ctx.queue.cancel(id);
      await prisma.video.delete({ where: { id } });
      await pruneHero(new Set([id]));
      await files.deleteVideoFiles(video);
    });
    request.log.info({ videoId: id }, 'video deleted');
    return reply.code(204).send();
  });
}
