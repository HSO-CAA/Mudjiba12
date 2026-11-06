#!/usr/bin/env node
/**
 * Runs the local Prisma CLI with the same env files the API reads (`src/config.ts` → `envFiles()`):
 *   apps/api/.env.local  →  <repo root>/.env.local  →  apps/api/.env
 * Already-set environment variables always win, and an earlier file wins over a later one.
 * Plain ESM + `dotenv` (a runtime dependency) so `npm run db:deploy` also works in production without tsx.
 *
 *   node scripts/prisma-env.mjs migrate deploy
 */
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parse } from 'dotenv';

export const API_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Same order as `envFiles()` in src/config.ts. */
export function envFiles(apiRoot = API_ROOT) {
  return [path.join(apiRoot, '.env.local'), path.resolve(apiRoot, '..', '..', '.env.local'), path.join(apiRoot, '.env')];
}

/** Loads the files into `target` without overriding variables that are already set. Returns the files read. */
export function loadEnvFiles(files = envFiles(), target = process.env) {
  const loaded = [];
  for (const file of files) {
    let text;
    try {
      text = readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    for (const [key, value] of Object.entries(parse(text))) {
      if (target[key] === undefined) target[key] = value;
    }
    loaded.push(file);
  }
  return loaded;
}

/** Friendly checks before Prisma prints a cryptic error. Returns an error message or null; never prints secrets. */
export function databaseUrlProblem(url, command) {
  if (!url) return 'DATABASE_URL is not set — put it in apps/api/.env, apps/api/.env.local or the repo-root .env.local';
  if (/\[(?:YOUR[-_ ]?PASSWORD|PASSWORD|REGION|PROJECT[-_ ]?REF)\]/i.test(url)) {
    return 'DATABASE_URL still contains a placeholder like [YOUR-PASSWORD] or [REGION] — replace it with your real database password / region';
  }
  try {
    const u = new URL(url);
    if (u.hostname.endsWith('.pooler.supabase.com') && u.port === '6543' && command === 'migrate') {
      return (
        'DATABASE_URL uses the Supabase Transaction pooler (port 6543), which cannot run migrations — ' +
        'use the Session pooler string (Supabase → Connect → Session pooler, port 5432)'
      );
    }
  } catch {
    // Let Prisma report malformed URLs.
  }
  return null;
}

function main() {
  const args = process.argv.slice(2);
  const loaded = loadEnvFiles();
  if (loaded.length > 0) {
    console.error(`[s5y] env files: ${loaded.map((f) => path.relative(process.cwd(), f) || f).join(', ')}`);
  }
  const needsDb = args[0] === 'migrate' || args[0] === 'db';
  if (needsDb) {
    const problem = databaseUrlProblem(process.env.DATABASE_URL, args[0]);
    if (problem) {
      console.error(`[s5y] ✖ ${problem}`);
      process.exit(1);
    }
  }
  const require = createRequire(import.meta.url);
  const cli = require.resolve('prisma/build/index.js');
  const child = spawn(process.execPath, [cli, ...args], { cwd: API_ROOT, env: process.env, stdio: 'inherit' });
  const forward = (signal) => child.kill(signal);
  process.on('SIGINT', forward);
  process.on('SIGTERM', forward);
  child.on('error', (err) => {
    console.error(`[s5y] ✖ could not start prisma: ${err.message}`);
    process.exit(1);
  });
  child.on('exit', (code, signal) => {
    if (signal) {
      process.removeListener('SIGINT', forward);
      process.removeListener('SIGTERM', forward);
      process.kill(process.pid, signal);
      return;
    }
    process.exit(code ?? 1);
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main();
