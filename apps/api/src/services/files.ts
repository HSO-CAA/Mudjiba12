import fs from 'node:fs/promises';
import path from 'node:path';
import type { PrismaClient } from '@prisma/client';
import { fieldError } from '../lib/errors.js';
import type { Log } from '../media/queue.js';
import { videoKeys } from '../media/video.js';
import type { StorageDriver } from '../storage/types.js';
import type { SettingsService } from './settings.js';

/** File lifecycle helpers: nothing is deleted while another row/setting still points at it. */
export class FileService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly storage: StorageDriver,
    private readonly settings: SettingsService,
    private readonly uploadsDir: string,
    private readonly log: Log,
  ) {}

  /** Temp file that receives chunked upload bytes. */
  uploadTempPath(videoId: string): string {
    return path.join(this.uploadsDir, videoId);
  }

  async isImageReferenced(key: string): Promise<boolean> {
    const [places, videos, settings] = await Promise.all([
      this.prisma.place.count({ where: { OR: [{ coverKey: key }, { logoKey: key }] } }),
      this.prisma.video.count({ where: { posterKey: key } }),
      this.settings.get(),
    ]);
    return places > 0 || videos > 0 || settings.about.avatarKey === key || settings.seo.ogImageKey === key;
  }

  /**
   * Ensures client-supplied image keys point at files that were really uploaded
   * (prevents saving references to images that don't exist). Fields with null/undefined are skipped.
   */
  async assertImagesExist(fields: Record<string, string | null | undefined>): Promise<void> {
    for (const [field, key] of Object.entries(fields)) {
      if (!key) continue;
      if (!(await this.storage.exists(key))) throw fieldError(field, 'الصورة غير موجودة على السيرفر، ارفعها مرة ثانية');
    }
  }

  /** Deletes uploaded images that are no longer referenced anywhere. Never throws. */
  async releaseImages(keys: Iterable<string | null | undefined>): Promise<void> {
    for (const key of new Set(keys)) {
      if (!key || !key.startsWith('images/')) continue;
      try {
        if (!(await this.isImageReferenced(key))) await this.storage.delete(key);
      } catch (err) {
        this.log.warn({ err, key }, 'failed to delete image');
      }
    }
  }

  /** Removes every file of a video (outputs, source, temp upload) plus its custom poster image. */
  async deleteVideoFiles(video: { id: string; posterKey: string | null }): Promise<void> {
    try {
      await this.storage.deletePrefix(videoKeys(video.id).prefix);
    } catch (err) {
      this.log.warn({ err, videoId: video.id }, 'failed to delete video files');
    }
    await fs.rm(this.uploadTempPath(video.id), { force: true }).catch(() => undefined);
    await this.releaseImages([video.posterKey]);
  }
}
