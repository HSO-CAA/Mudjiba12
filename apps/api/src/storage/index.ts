import type { Config } from '../config.js';
import { LocalStorage } from './local.js';
import { S3Storage } from './s3.js';
import type { StorageDriver } from './types.js';

export { LocalStorage } from './local.js';
export { S3Storage } from './s3.js';
export * from './types.js';

export function createStorage(config: Config): StorageDriver {
  if (config.storage.driver === 's3') {
    if (!config.storage.s3) throw new Error('S3 storage selected but S3 configuration is incomplete');
    return new S3Storage(config.storage.s3);
  }
  return new LocalStorage(config.storage.dir);
}
