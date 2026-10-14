import fs from 'node:fs/promises';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';
import type { Config } from './config.js';
import { type MediaTools, detectMediaTools } from './media/ffmpeg.js';
import { type Log, MediaQueue } from './media/queue.js';
import { processVideo } from './media/video.js';
import { AuthService } from './services/auth.js';
import { FileService } from './services/files.js';
import { PublicService } from './services/public.js';
import { Serializer } from './services/serializers.js';
import { SettingsService } from './services/settings.js';
import { StatsService } from './services/stats.js';
import { createStorage } from './storage/index.js';
import type { StorageDriver } from './storage/types.js';

/** Everything the routes need, wired once per app instance (tests build isolated contexts). */
export interface AppContext {
  config: Config;
  prisma: PrismaClient;
  storage: StorageDriver;
  tools: MediaTools;
  queue: MediaQueue;
  settings: SettingsService;
  auth: AuthService;
  files: FileService;
  stats: StatsService;
  publicData: PublicService;
  serialize: Serializer;
  paths: { uploads: string; work: string };
  log: Log;
  /** Disconnects resources this context created. */
  dispose(): Promise<void>;
}

export interface ContextOptions {
  config: Config;
  log: Log;
  prisma?: PrismaClient;
  /** Override ffmpeg detection (tests simulate a server without ffmpeg). */
  tools?: MediaTools;
}

export async function createContext(options: ContextOptions): Promise<AppContext> {
  const { config, log } = options;
  const ownsPrisma = !options.prisma;
  const prisma = options.prisma ?? new PrismaClient({ datasourceUrl: config.databaseUrl });
  // ffmpeg first: whether video sources are staged on the local disk depends on it.
  const tools = options.tools ?? (await detectMediaTools(config.ffmpegPath, config.ffprobePath));
  const storage = createStorage(config, { stageVideoSources: tools.available });
  const paths = {
    uploads: path.join(config.storage.dir, '.uploads'),
    work: path.join(config.storage.dir, '.work'),
  };
  await fs.mkdir(paths.uploads, { recursive: true });
  await fs.mkdir(paths.work, { recursive: true });

  const settings = new SettingsService(prisma);
  const serialize = new Serializer(storage);
  const queue = new MediaQueue(
    (videoId, signal) => processVideo({ prisma, storage, tools, workDir: paths.work, log }, videoId, signal),
    log,
  );

  return {
    config,
    prisma,
    storage,
    tools,
    queue,
    settings,
    serialize,
    paths,
    log,
    auth: new AuthService(prisma),
    files: new FileService(prisma, storage, settings, paths.uploads, log),
    stats: new StatsService(prisma),
    publicData: new PublicService(prisma, settings, serialize),
    async dispose() {
      await queue.close();
      if (ownsPrisma) await prisma.$disconnect();
    },
  };
}

/** First boot / every boot housekeeping: default settings, initial owner, resume interrupted jobs. */
export async function bootstrapContext(ctx: AppContext): Promise<void> {
  // Remote storage setup (e.g. create/publish the Supabase bucket). Logs problems instead of throwing.
  await ctx.storage.init?.(ctx.log);
  await ctx.settings.ensure();
  const owner = await ctx.auth.ensureInitialOwner(ctx.config.admin);
  if (owner) ctx.log.info({ email: owner.email }, 'created initial owner account');
  else if ((await ctx.prisma.user.count()) === 0) {
    ctx.log.warn(
      {},
      'no admin account exists yet: set ADMIN_EMAIL and ADMIN_PASSWORD (min 10 chars) and restart, or run the create-admin script',
    );
  }
  await ctx.auth.purgeExpired();

  await cleanScratch(ctx);

  const interrupted = await ctx.prisma.video.findMany({
    where: { status: 'PROCESSING' },
    orderBy: { updatedAt: 'asc' },
    select: { id: true },
  });
  if (interrupted.length > 0) {
    if (ctx.tools.available) {
      for (const v of interrupted) ctx.queue.enqueue(v.id);
      ctx.log.info({ count: interrupted.length }, 'resumed video processing jobs');
    } else {
      await finishWithoutProcessing(ctx, interrupted.map((v) => v.id));
    }
  }
}

/** Without ffmpeg, PROCESSING videos are served from their source file as-is. */
export async function finishWithoutProcessing(ctx: AppContext, ids: string[]): Promise<void> {
  for (const id of ids) {
    const video = await ctx.prisma.video.findUnique({ where: { id } });
    if (!video || video.status !== 'PROCESSING') continue;
    const fileKey = video.fileKey ?? video.sourceKey;
    await ctx.prisma.video.update({
      where: { id },
      data: fileKey
        ? { status: 'READY', fileKey, processingError: null }
        : { status: 'FAILED', processingError: 'ملف الفيديو الأصلي غير موجود' },
    });
  }
}

const ABANDONED_UPLOAD_MS = 7 * 24 * 3600_000;
const STALE_WORK_MS = 3600_000;

/**
 * Removes leftovers of killed jobs (work dirs older than an hour, so a seed or job running in another
 * process is never touched) and temp upload files whose video no longer exists or is no longer uploading.
 */
async function cleanScratch(ctx: AppContext): Promise<void> {
  const now = Date.now();
  for (const entry of await fs.readdir(ctx.paths.work).catch(() => [] as string[])) {
    const full = path.join(ctx.paths.work, entry);
    const stat = await fs.stat(full).catch(() => null);
    if (stat && now - stat.mtimeMs > STALE_WORK_MS) await fs.rm(full, { recursive: true, force: true }).catch(() => undefined);
  }
  const uploads = await fs.readdir(ctx.paths.uploads).catch(() => [] as string[]);
  if (uploads.length > 0) {
    const active = await ctx.prisma.video.findMany({ where: { id: { in: uploads }, status: 'UPLOADING' }, select: { id: true } });
    const keep = new Set(active.map((v) => v.id));
    for (const name of uploads) {
      if (!keep.has(name)) await fs.rm(path.join(ctx.paths.uploads, name), { force: true }).catch(() => undefined);
    }
  }
}

/** Periodic housekeeping: expired sessions and uploads abandoned for a week. */
export async function runMaintenance(ctx: AppContext): Promise<void> {
  await ctx.auth.purgeExpired();
  const abandoned = await ctx.prisma.video.findMany({
    where: { status: 'UPLOADING', updatedAt: { lt: new Date(Date.now() - ABANDONED_UPLOAD_MS) } },
    select: { id: true, posterKey: true },
  });
  for (const video of abandoned) {
    await ctx.prisma.video.deleteMany({ where: { id: video.id, status: 'UPLOADING' } });
    await ctx.files.deleteVideoFiles(video);
  }
  if (abandoned.length > 0) ctx.log.info({ count: abandoned.length }, 'removed abandoned uploads');
  await cleanScratch(ctx);
}
