import { createReadStream, createWriteStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { assertSafeKey, assertSafePrefix, type LocalFileHandle, type PutOptions, type StorageDriver } from './types.js';

const USAGE_CACHE_MS = 60_000;

export class LocalStorage implements StorageDriver {
  readonly kind = 'local' as const;
  readonly publicOrigin = null;
  readonly localMediaDir: string;
  private usageCache: { at: number; bytes: number } | null = null;

  constructor(readonly root: string) {
    this.localMediaDir = root;
  }

  /** Absolute path of a key, guaranteed to stay inside the storage root. */
  resolve(key: string): string {
    assertSafeKey(key);
    const full = path.resolve(this.root, key);
    if (!full.startsWith(this.root + path.sep)) throw new Error('Storage key escapes the storage root');
    return full;
  }

  url(key: string): string {
    return `/media/${key}`;
  }

  async putFile(key: string, filePath: string, options: PutOptions): Promise<void> {
    const dest = this.resolve(key);
    await fs.mkdir(path.dirname(dest), { recursive: true });
    if (options.move) {
      try {
        await fs.rename(filePath, dest);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'EXDEV') throw err;
        await copyFile(filePath, dest);
        await fs.rm(filePath, { force: true });
      }
    } else {
      await copyFile(filePath, dest);
    }
    this.usageCache = null;
  }

  async delete(key: string): Promise<void> {
    await fs.rm(this.resolve(key), { force: true });
    this.usageCache = null;
  }

  async deletePrefix(prefix: string): Promise<void> {
    assertSafePrefix(prefix);
    const dir = path.resolve(this.root, prefix);
    if (!dir.startsWith(this.root + path.sep)) throw new Error('Storage prefix escapes the storage root');
    await fs.rm(dir, { recursive: true, force: true });
    this.usageCache = null;
  }

  async exists(key: string): Promise<boolean> {
    try {
      return (await fs.stat(this.resolve(key))).isFile();
    } catch {
      return false;
    }
  }

  async getLocalFile(key: string): Promise<LocalFileHandle> {
    const file = this.resolve(key);
    await fs.access(file);
    return { path: file, cleanup: async () => {} };
  }

  async usageBytes(): Promise<number | null> {
    if (this.usageCache && Date.now() - this.usageCache.at < USAGE_CACHE_MS) return this.usageCache.bytes;
    let bytes = 0;
    for (const top of ['images', 'videos']) bytes += await dirSize(path.join(this.root, top));
    this.usageCache = { at: Date.now(), bytes };
    return bytes;
  }
}

async function copyFile(from: string, to: string): Promise<void> {
  const tmp = `${to}.${process.pid}.tmp`;
  await pipeline(createReadStream(from), createWriteStream(tmp));
  await fs.rename(tmp, to);
}

async function dirSize(dir: string): Promise<number> {
  let entries: import('node:fs').Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  let total = 0;
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) total += await dirSize(full);
    else if (entry.isFile()) total += (await fs.stat(full).catch(() => ({ size: 0 }))).size;
  }
  return total;
}
