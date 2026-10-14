import path from 'node:path';
import { config as loadDotenv } from 'dotenv';
import { API_ROOT } from '../src/config.js';

loadDotenv({ path: path.join(API_ROOT, '.env'), quiet: true });

/**
 * Tests stay hermetic: a developer's storage settings (shell exports, apps/api/.env, .env.local — which the
 * tests never load) must not change which storage driver a test app uses. Test apps build their config from an
 * explicit object anyway; this also covers anything that reads `process.env` directly.
 */
export const STRIPPED_ENV_PREFIXES = ['SUPABASE_', 'S3_'];
for (const key of Object.keys(process.env)) {
  if (key === 'STORAGE_DRIVER' || STRIPPED_ENV_PREFIXES.some((prefix) => key.startsWith(prefix))) delete process.env[key];
}

export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgresql://s5y:s5y@localhost:5432/s5y_test?schema=public';

/** Refuses to run against the development/production database (tests truncate every table). */
export function assertSafeTestDatabase(): void {
  const dev = process.env.DATABASE_URL;
  if (dev && dev === TEST_DATABASE_URL) {
    throw new Error('TEST_DATABASE_URL must point to a separate database (tests wipe all tables).');
  }
}

declare module 'vitest' {
  interface ProvidedContext {
    fixturesDir: string;
  }
}
