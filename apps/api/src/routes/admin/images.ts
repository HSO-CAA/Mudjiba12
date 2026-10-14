import multipart from '@fastify/multipart';
import type { UploadedImage } from '@s5y/shared';
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../../context.js';
import { badRequest } from '../../lib/errors.js';
import { MAX_IMAGE_BYTES, storeImage } from '../../media/images.js';

export async function imageUploadRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  await app.register(multipart, {
    limits: { fileSize: MAX_IMAGE_BYTES, files: 1, fields: 10, parts: 12, fieldSize: 1024, headerPairs: 100 },
    throwFileSizeLimit: true,
  });

  app.post('/uploads/image', { bodyLimit: MAX_IMAGE_BYTES + 1024 * 1024 }, async (request, reply) => {
    const file = await request.file();
    if (!file) throw badRequest('ما وصلني أي ملف، اختار صورة وحاول مرة ثانية');
    if (file.fieldname !== 'file') throw badRequest('اسم الحقل لازم يكون "file"');
    const buffer = await file.toBuffer();
    if (buffer.length === 0) throw badRequest('الملف فارغ');
    const image: UploadedImage = await storeImage({ storage: ctx.storage, tools: ctx.tools, tmpDir: ctx.paths.work }, buffer);
    request.log.info({ key: image.key, bytes: buffer.length }, 'image uploaded');
    return reply.code(201).send(image);
  });
}
