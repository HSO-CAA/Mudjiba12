import { createReadStream, createWriteStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import {
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  S3Client,
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import type { S3Config } from '../config.js';
import { randomId } from '../lib/crypto.js';
import {
  IMMUTABLE_CACHE_CONTROL,
  assertSafeKey,
  assertSafePrefix,
  type LocalFileHandle,
  type PutOptions,
  type StorageDriver,
} from './types.js';

/** S3 / Cloudflare R2 driver. Objects are public-read through `S3_PUBLIC_URL` (bucket policy / CDN). */
export class S3Storage implements StorageDriver {
  readonly kind = 's3' as const;
  readonly publicOrigin: string;
  private readonly client: S3Client;

  constructor(private readonly cfg: S3Config) {
    this.publicOrigin = new URL(cfg.publicUrl).origin;
    this.client = new S3Client({
      region: cfg.region,
      endpoint: cfg.endpoint,
      forcePathStyle: cfg.forcePathStyle,
      credentials:
        cfg.accessKeyId && cfg.secretAccessKey
          ? { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey }
          : undefined,
    });
  }

  url(key: string): string {
    return `${this.cfg.publicUrl}/${key}`;
  }

  async putFile(key: string, filePath: string, options: PutOptions): Promise<void> {
    assertSafeKey(key);
    const upload = new Upload({
      client: this.client,
      queueSize: 4,
      partSize: 8 * 1024 * 1024,
      params: {
        Bucket: this.cfg.bucket,
        Key: key,
        Body: createReadStream(filePath),
        ContentType: options.contentType,
        CacheControl: IMMUTABLE_CACHE_CONTROL,
      },
    });
    await upload.done();
    if (options.move) await fs.rm(filePath, { force: true });
  }

  async delete(key: string): Promise<void> {
    assertSafeKey(key);
    await this.client.send(new DeleteObjectCommand({ Bucket: this.cfg.bucket, Key: key }));
  }

  async deletePrefix(prefix: string): Promise<void> {
    assertSafePrefix(prefix);
    let token: string | undefined;
    do {
      const page = await this.client.send(
        new ListObjectsV2Command({ Bucket: this.cfg.bucket, Prefix: prefix, ContinuationToken: token, MaxKeys: 1000 }),
      );
      const keys = (page.Contents ?? []).flatMap((o) => (o.Key ? [{ Key: o.Key }] : []));
      if (keys.length > 0) {
        await this.client.send(new DeleteObjectsCommand({ Bucket: this.cfg.bucket, Delete: { Objects: keys, Quiet: true } }));
      }
      token = page.IsTruncated ? page.NextContinuationToken : undefined;
    } while (token);
  }

  async exists(key: string): Promise<boolean> {
    assertSafeKey(key);
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.cfg.bucket, Key: key }));
      return true;
    } catch (err) {
      const status = (err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
      if (status === 404) return false;
      throw err;
    }
  }

  async getLocalFile(key: string, tmpDir: string): Promise<LocalFileHandle> {
    assertSafeKey(key);
    await fs.mkdir(tmpDir, { recursive: true });
    const dest = path.join(tmpDir, `${randomId(10)}-${path.posix.basename(key)}`);
    const res = await this.client.send(new GetObjectCommand({ Bucket: this.cfg.bucket, Key: key }));
    if (!res.Body) throw new Error(`Empty S3 object: ${key}`);
    const body = res.Body as unknown;
    const stream = body instanceof Readable ? body : Readable.fromWeb(body as import('node:stream/web').ReadableStream);
    await pipeline(stream, createWriteStream(dest));
    return { path: dest, cleanup: () => fs.rm(dest, { force: true }) };
  }

  async usageBytes(): Promise<number | null> {
    return null;
  }
}
