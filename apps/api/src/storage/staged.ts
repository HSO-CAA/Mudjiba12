import { existsSync } from 'node:fs';
import type { LocalStorage } from './local.js';
import { type LocalFileHandle, type PutOptions, type StorageDriver, type StorageLog, isVideoSourceKey } from './types.js';

/**
 * A remote driver (S3 / Supabase) with video SOURCES (`videos/<id>/source.<ext>`) kept on this server's disk.
 *
 * With ffmpeg the original upload is only an input for processing (it is deleted once the video is READY), so
 * uploading it would waste bandwidth — and big phone originals would hit Supabase's per-file limit (50 MB on the
 * Free plan) even though the processed MP4 fits. `stageSources` is false without ffmpeg: sources are then served
 * as-is, so they go to the remote store like every other key.
 *
 * Reads always look on disk first and fall back to the remote store, so sources uploaded before (or by a server
 * without ffmpeg) keep working; every other key always goes to the remote driver.
 */
export class StagedSourceStorage implements StorageDriver {
  readonly kind: StorageDriver['kind'];
  readonly publicOrigin: string | null;
  readonly localMediaDir: string;

  constructor(
    readonly remote: StorageDriver,
    readonly local: LocalStorage,
    readonly stageSources: boolean,
  ) {
    this.kind = remote.kind;
    this.publicOrigin = remote.publicOrigin;
    this.localMediaDir = local.root;
  }

  async init(log: StorageLog): Promise<void> {
    await this.remote.init?.(log);
    log.info(
      { storage: this.kind, localSources: this.stageSources, dir: this.local.root },
      this.stageSources
        ? 'video originals stay on this server until processed (only the processed files are uploaded)'
        : 'ffmpeg not available: video originals are uploaded and served as-is',
    );
  }

  url(key: string): string {
    if (isVideoSourceKey(key) && existsSync(this.local.resolve(key))) return this.local.url(key);
    return this.remote.url(key);
  }

  putFile(key: string, filePath: string, options: PutOptions): Promise<void> {
    if (this.stageSources && isVideoSourceKey(key)) return this.local.putFile(key, filePath, options);
    return this.remote.putFile(key, filePath, options);
  }

  async exists(key: string): Promise<boolean> {
    if (isVideoSourceKey(key) && (await this.local.exists(key))) return true;
    return this.remote.exists(key);
  }

  async getLocalFile(key: string, tmpDir: string): Promise<LocalFileHandle> {
    if (isVideoSourceKey(key) && (await this.local.exists(key))) return this.local.getLocalFile(key);
    return this.remote.getLocalFile(key, tmpDir);
  }

  async delete(key: string): Promise<void> {
    if (isVideoSourceKey(key) && (await this.local.exists(key))) {
      await this.local.delete(key);
      return;
    }
    await this.remote.delete(key);
  }

  async deletePrefix(prefix: string): Promise<void> {
    await this.local.deletePrefix(prefix);
    await this.remote.deletePrefix(prefix);
  }

  usageBytes(): Promise<number | null> {
    return this.remote.usageBytes();
  }
}
