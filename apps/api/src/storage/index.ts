import type { Config } from '../config.js';
import { LocalStorage } from './local.js';
import { S3Storage } from './s3.js';
import { StagedSourceStorage } from './staged.js';
import { SupabaseStorage } from './supabase.js';
import type { StorageDriver } from './types.js';

export { LocalStorage } from './local.js';
export { S3Storage } from './s3.js';
export { StagedSourceStorage } from './staged.js';
export { SupabaseStorage } from './supabase.js';
export * from './types.js';

export interface CreateStorageOptions {
  /**
   * Keep video sources on the local disk next to a remote driver (true when ffmpeg is available, because the
   * source is only a processing input then). Ignored for the local driver.
   */
  stageVideoSources?: boolean;
}

export function createStorage(config: Config, options: CreateStorageOptions = {}): StorageDriver {
  const local = new LocalStorage(config.storage.dir);
  let remote: StorageDriver;
  if (config.storage.driver === 's3') {
    if (!config.storage.s3) throw new Error('S3 storage selected but S3 configuration is incomplete');
    remote = new S3Storage(config.storage.s3);
  } else if (config.storage.driver === 'supabase') {
    if (!config.storage.supabase) throw new Error('Supabase storage selected but Supabase configuration is incomplete');
    remote = new SupabaseStorage(config.storage.supabase);
  } else {
    return local;
  }
  return new StagedSourceStorage(remote, local, options.stageVideoSources ?? false);
}
