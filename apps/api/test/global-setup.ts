import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import type { TestProject } from 'vitest/node';
import { API_ROOT } from '../src/config.js';
import { TEST_DATABASE_URL, assertSafeTestDatabase } from './env.js';

const require = createRequire(import.meta.url);

function ffmpeg(args: string[]): void {
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: 'pipe' });
}

/** Applies migrations to the test database and generates tiny media fixtures with ffmpeg. */
export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  assertSafeTestDatabase();
  const prismaCli = require.resolve('prisma/build/index.js');
  execFileSync(process.execPath, [prismaCli, 'migrate', 'deploy'], {
    cwd: API_ROOT,
    env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
    stdio: 'pipe',
  });

  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 's5y-api-fixtures-'));
  // 2 s vertical H.264/AAC MP4 (remux path) …
  ffmpeg([
    '-f', 'lavfi', '-i', 'testsrc2=size=180x320:rate=24',
    '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=44100',
    '-t', '2', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest',
    path.join(dir, 'tiny.mp4'),
  ]);
  // … a VP9 WebM (transcode path) …
  ffmpeg([
    '-f', 'lavfi', '-i', 'testsrc2=size=160x284:rate=24', '-t', '1.5',
    '-c:v', 'libvpx-vp9', '-deadline', 'realtime', '-cpu-used', '8', '-b:v', '200k',
    path.join(dir, 'tiny.webm'),
  ]);
  // … a landscape H.264 clip flagged as rotated 90° (phone footage) …
  ffmpeg(['-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=24', '-t', '1', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', path.join(dir, 'landscape.mp4')]);
  ffmpeg(['-display_rotation:v:0', '90', '-i', path.join(dir, 'landscape.mp4'), '-c', 'copy', path.join(dir, 'rotated.mp4')]);
  // … and a PNG image.
  ffmpeg(['-f', 'lavfi', '-i', 'testsrc2=size=640x400', '-frames:v', '1', path.join(dir, 'image.png')]);

  project.provide('fixturesDir', dir);
  return async () => {
    await fs.rm(dir, { recursive: true, force: true });
  };
}
