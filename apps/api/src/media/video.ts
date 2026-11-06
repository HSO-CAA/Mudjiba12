import fs from 'node:fs/promises';
import path from 'node:path';
import type { PrismaClient } from '@prisma/client';
import { randomId } from '../lib/crypto.js';
import { cleanString, truncate } from '../lib/sanitize.js';
import { StorageAuthError, StorageObjectTooLargeError, StorageRequestError, type StorageDriver } from '../storage/types.js';
import { AbortedError, FfmpegError, type MediaTools, type ProbeResult, probe, run, stderrSummary } from './ffmpeg.js';
import type { Log } from './queue.js';

export const VIDEO_EXTENSIONS = ['mp4', 'mov', 'webm', 'mkv', 'm4v'] as const;
export type VideoExt = (typeof VIDEO_EXTENSIONS)[number];

export const VIDEO_MIME_BY_EXT: Record<VideoExt, string> = {
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  webm: 'video/webm',
  mkv: 'video/x-matroska',
  m4v: 'video/x-m4v',
};

export const EXT_BY_VIDEO_MIME: Record<string, VideoExt> = {
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
  'video/webm': 'webm',
  'video/x-matroska': 'mkv',
  'video/matroska': 'mkv',
  'video/x-m4v': 'm4v',
};

export const videoKeys = (videoId: string) => ({
  prefix: `videos/${videoId}/`,
  source: (ext: string) => `videos/${videoId}/source.${ext}`,
  file: `videos/${videoId}/video.mp4`,
  preview: `videos/${videoId}/preview.mp4`,
  poster: `videos/${videoId}/poster.jpg`,
});

export interface VideoProcessorDeps {
  prisma: PrismaClient;
  storage: StorageDriver;
  tools: MediaTools;
  /** Local scratch directory (inside STORAGE_DIR so renames stay on one filesystem). */
  workDir: string;
  log: Log;
}

/** An expected processing failure with a user-facing Arabic reason. */
class MediaJobError extends Error {}

/** User-facing (Arabic) reasons for storage failures while saving processed files. */
export const STORAGE_TOO_LARGE_MESSAGE =
  'الفيديو بعد المعالجة أكبر من الحد المسموح بخطة Supabase (50MB بالخطة المجانية) — قصّر الفيديو أو رقّي الخطة';
export const STORAGE_AUTH_MESSAGE =
  'التخزين السحابي (Supabase) رفض الرفع: تأكد إن SUPABASE_SERVICE_ROLE_KEY هو مفتاح service_role السري لنفس المشروع، وإن المشروع مو موقوف';
export const STORAGE_UNAVAILABLE_MESSAGE =
  'تعذّر رفع الفيديو للتخزين السحابي — تأكد من الاتصال وإن مشروع Supabase شغّال، وبعدين اضغط «إعادة المعالجة»';

function storageFailureReason(err: unknown): string | null {
  if (err instanceof StorageObjectTooLargeError) return STORAGE_TOO_LARGE_MESSAGE;
  if (err instanceof StorageAuthError) return STORAGE_AUTH_MESSAGE;
  if (err instanceof StorageRequestError) return STORAGE_UNAVAILABLE_MESSAGE;
  return null;
}

// Inputs are local files only: ffmpeg may never follow a URL/playlist reference found inside an upload.
const FFMPEG_BASE = ['-hide_banner', '-nostdin', '-loglevel', 'error', '-y', '-protocol_whitelist', 'file'];
const HDR_TRANSFERS = new Set(['smpte2084', 'arib-std-b67']);
const MAX_LONG_SIDE = 1920;
const PREVIEW_SECONDS = 6;
const PREVIEW_SHORT_SIDE = 360;
const POSTER_LONG_SIDE = 1280;

const even = (expr: string) => `trunc(${expr}/2)*2`;

function isRemuxable(info: ProbeResult): boolean {
  const v = info.video;
  if (!v || v.codec !== 'h264') return false;
  if (!/(^|,)(mov|mp4)(,|$)/.test(info.formatName)) return false;
  if (v.pixFmt !== null && v.pixFmt !== 'yuv420p' && v.pixFmt !== 'yuvj420p') return false;
  // Rotation metadata is baked in by a transcode: WebGL video textures don't always honour it.
  if (v.rotation !== 0) return false;
  return !(v.colorTransfer && HDR_TRANSFERS.has(v.colorTransfer));
}

function audioArgs(info: ProbeResult, allowCopy: boolean): string[] {
  if (!info.audio) return ['-an'];
  if (allowCopy && (info.audio.codec === 'aac' || info.audio.codec === 'mp3')) return ['-c:a', 'copy'];
  return ['-c:a', 'aac', '-b:a', '160k', '-ac', '2'];
}

function transcodeFilters(info: ProbeResult, tools: MediaTools): string {
  const filters: string[] = [];
  const transfer = info.video?.colorTransfer;
  if (transfer && HDR_TRANSFERS.has(transfer) && tools.tonemap) {
    // HDR (HLG/PQ phone footage) → SDR BT.709, so colours don't look washed out in browsers.
    filters.push(
      'zscale=t=linear:npl=100',
      'format=gbrpf32le',
      'zscale=p=bt709',
      'tonemap=tonemap=hable:desat=0',
      'zscale=t=bt709:m=bt709:r=tv',
    );
  }
  filters.push(
    `scale=w='min(${MAX_LONG_SIDE},iw)':h='min(${MAX_LONG_SIDE},ih)':force_original_aspect_ratio=decrease:force_divisible_by=2`,
    'format=yuv420p',
  );
  return filters.join(',');
}

function mainArgs(
  input: string,
  output: string,
  info: ProbeResult,
  tools: MediaTools,
  forceTranscode = false,
): { args: string[]; mode: 'remux' | 'transcode' } {
  if (!forceTranscode && isRemuxable(info)) {
    return {
      mode: 'remux',
      args: [
        ...FFMPEG_BASE, '-i', input,
        '-map', '0:v:0', '-map', '0:a:0?',
        '-c:v', 'copy', ...audioArgs(info, true),
        '-map_metadata', '-1', '-map_chapters', '-1',
        '-movflags', '+faststart',
        output,
      ],
    };
  }
  return {
    mode: 'transcode',
    args: [
      ...FFMPEG_BASE, '-i', input,
      '-map', '0:v:0', '-map', '0:a:0?',
      '-vf', transcodeFilters(info, tools),
      '-c:v', 'libx264', '-preset', 'medium', '-crf', '22', '-profile:v', 'high',
      '-fpsmax', '60',
      ...audioArgs(info, false),
      '-map_metadata', '-1', '-map_chapters', '-1',
      '-max_muxing_queue_size', '1024',
      '-movflags', '+faststart',
      output,
    ],
  };
}

function previewArgs(input: string, output: string): string[] {
  const s = PREVIEW_SHORT_SIDE;
  return [
    ...FFMPEG_BASE, '-ss', '0', '-t', String(PREVIEW_SECONDS), '-i', input,
    '-map', '0:v:0', '-an',
    '-vf', `scale=w='if(lt(iw,ih),${even(`min(${s},iw)`)},-2)':h='if(lt(iw,ih),-2,${even(`min(${s},ih)`)})',format=yuv420p`,
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '30', '-profile:v', 'main',
    '-fpsmax', '30',
    '-map_metadata', '-1', '-movflags', '+faststart',
    output,
  ];
}

function posterArgs(input: string, output: string, atSec: number): string[] {
  return [
    ...FFMPEG_BASE, '-ss', atSec.toFixed(3), '-i', input,
    '-frames:v', '1',
    '-vf', `scale=w='min(${POSTER_LONG_SIDE},iw)':h='min(${POSTER_LONG_SIDE},ih)':force_original_aspect_ratio=decrease`,
    '-q:v', '3', '-update', '1',
    output,
  ];
}

const fileExists = (p: string) =>
  fs.stat(p).then(
    (s) => s.isFile() && s.size > 0,
    () => false,
  );

function jobTimeoutMs(durationSec: number | null): number {
  const d = durationSec ?? 600;
  return Math.min(12 * 3600_000, Math.max(10 * 60_000, d * 30_000));
}

/**
 * Processes one `PROCESSING` video: probe → remux/transcode to H.264 MP4 (faststart) →
 * 6 s muted preview → poster (unless one was uploaded) → READY. Errors mark it FAILED.
 * Aborts (shutdown / delete / reprocess) leave the row PROCESSING and rethrow.
 */
export async function processVideo(deps: VideoProcessorDeps, videoId: string, signal: AbortSignal): Promise<void> {
  const { prisma, storage, tools, log } = deps;
  const video = await prisma.video.findUnique({ where: { id: videoId } });
  if (!video || video.status !== 'PROCESSING') return;

  const keys = videoKeys(videoId);
  const inputKey = video.sourceKey ?? video.fileKey;
  const jobDir = path.join(deps.workDir, `${videoId}-${randomId(6)}`);
  const startedAt = Date.now();

  try {
    if (!inputKey) throw new MediaJobError('ملف الفيديو الأصلي غير موجود');
    if (!tools.available) throw new MediaJobError('أداة المعالجة ffmpeg غير متوفرة على السيرفر');
    await fs.mkdir(jobDir, { recursive: true });
    const source = await storage.getLocalFile(inputKey, jobDir).catch(() => {
      throw new MediaJobError('تعذّر قراءة ملف الفيديو الأصلي');
    });

    try {
      const info = await probe(tools, source.path, signal).catch((err: unknown) => {
        if (err instanceof AbortedError) throw err;
        throw new MediaJobError('الملف تالف أو ليس فيديو مدعوم');
      });
      if (!info.video) throw new MediaJobError('الملف لا يحتوي على مسار فيديو');
      const timeoutMs = jobTimeoutMs(info.durationSec);

      const mainOut = path.join(jobDir, 'video.mp4');
      const main = mainArgs(source.path, mainOut, info, tools);
      let mode = main.mode;
      try {
        await run(tools.ffmpeg, main.args, { signal, timeoutMs });
      } catch (err) {
        if (main.mode !== 'remux' || !(err instanceof FfmpegError)) throw err;
        // Some "H.264 MP4" files still refuse a clean stream copy → fall back to a transcode.
        log.warn({ videoId, reason: stderrSummary(err.stderr) }, 'remux failed, transcoding instead');
        const retry = mainArgs(source.path, mainOut, info, tools, true);
        await run(tools.ffmpeg, retry.args, { signal, timeoutMs });
        mode = 'transcode';
      }
      const out = await probe(tools, mainOut, signal);
      if (!out.video) throw new MediaJobError('فشل إنتاج ملف الفيديو النهائي');
      let final = { durationSec: out.durationSec, width: out.video.width, height: out.video.height };

      const previewOut = path.join(jobDir, 'preview.mp4');
      await run(tools.ffmpeg, previewArgs(mainOut, previewOut), { signal, timeoutMs: 10 * 60_000 });

      const generatePoster = !video.posterKey || video.posterKey === keys.poster;
      const posterOut = path.join(jobDir, 'poster.jpg');
      if (generatePoster) {
        const at = out.durationSec ? Math.min(1, out.durationSec / 2) : 0;
        await run(tools.ffmpeg, posterArgs(mainOut, posterOut, at), { signal, timeoutMs: 120_000 });
        if (!(await fileExists(posterOut)) && at > 0) {
          await run(tools.ffmpeg, posterArgs(mainOut, posterOut, 0), { signal, timeoutMs: 120_000 });
        }
      }
      const hasPoster = generatePoster && (await fileExists(posterOut));
      if (signal.aborted) throw new AbortedError();

      try {
        await storage.putFile(keys.file, mainOut, { contentType: 'video/mp4', move: true });
      } catch (err) {
        // A stream-copied phone original keeps its high bitrate; re-encoding (CRF 22, ≤1920) usually shrinks it
        // enough for a per-file limit such as Supabase Free's 50 MB. Still too large → FAILED with a clear reason.
        if (!(err instanceof StorageObjectTooLargeError) || mode !== 'remux') throw err;
        log.warn({ videoId }, 'remuxed video is over the storage per-file limit, transcoding to shrink it');
        await run(tools.ffmpeg, mainArgs(source.path, mainOut, info, tools, true).args, { signal, timeoutMs });
        const shrunk = await probe(tools, mainOut, signal);
        if (!shrunk.video) throw new MediaJobError('فشل إنتاج ملف الفيديو النهائي');
        final = { durationSec: shrunk.durationSec, width: shrunk.video.width, height: shrunk.video.height };
        if (signal.aborted) throw new AbortedError();
        mode = 'transcode';
        await storage.putFile(keys.file, mainOut, { contentType: 'video/mp4', move: true });
      }
      await storage.putFile(keys.preview, previewOut, { contentType: 'video/mp4', move: true });
      if (hasPoster) await storage.putFile(keys.poster, posterOut, { contentType: 'image/jpeg', move: true });

      const sourceToDelete = video.sourceKey && video.sourceKey !== keys.file ? video.sourceKey : null;
      const updated = await prisma.video.updateMany({
        where: { id: videoId, status: 'PROCESSING' },
        data: {
          status: 'READY',
          processingError: null,
          fileKey: keys.file,
          previewKey: keys.preview,
          sourceKey: sourceToDelete ? null : video.sourceKey,
          ...(hasPoster ? { posterKey: keys.poster } : {}),
          durationSec: final.durationSec,
          width: final.width,
          height: final.height,
        },
      });
      if (updated.count === 0) {
        // Deleted (or re-queued) while we were working: don't leave orphaned files behind.
        const still = await prisma.video.findUnique({ where: { id: videoId }, select: { id: true } });
        if (!still) await storage.deletePrefix(keys.prefix);
        return;
      }
      if (sourceToDelete) await storage.delete(sourceToDelete).catch(() => undefined);
      log.info(
        { videoId, mode, ms: Date.now() - startedAt, width: final.width, height: final.height },
        'video processed',
      );
    } finally {
      await source.cleanup().catch(() => undefined);
    }
  } catch (err) {
    if (err instanceof AbortedError || signal.aborted) throw err instanceof AbortedError ? err : new AbortedError();
    const reason =
      err instanceof MediaJobError
        ? err.message
        : (storageFailureReason(err) ??
          (err instanceof FfmpegError
            ? `تعذّرت معالجة الفيديو (${stderrSummary(err.stderr) || 'ffmpeg'})`
            : 'تعذّرت معالجة الفيديو بسبب خطأ غير متوقع'));
    log.warn({ videoId, err }, 'video processing failed');
    await prisma.video
      .updateMany({ where: { id: videoId, status: 'PROCESSING' }, data: { status: 'FAILED', processingError: truncate(cleanString(reason), 500) } })
      .catch(() => undefined);
  } finally {
    await fs.rm(jobDir, { recursive: true, force: true }).catch(() => undefined);
  }
}
