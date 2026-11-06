import fs from 'node:fs/promises';
import path from 'node:path';
import type { UploadedImage } from '@s5y/shared';
import { randomId } from '../lib/crypto.js';
import { AppError, STORAGE_MESSAGES, storageAppError, unsupportedMediaType } from '../lib/errors.js';
import type { StorageDriver } from '../storage/types.js';
import { type MediaTools, probe, run } from './ffmpeg.js';
import { IMAGE_EXT, IMAGE_MIME, type ImageType, imageSize, jpegOrientation, sniffImage } from './sniff.js';

export const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
const MAX_LONG_SIDE = 2400;
const MAX_INPUT_SIDE = 16_384;
const MAX_INPUT_PIXELS = 100_000_000;

/** ffmpeg filters that apply an EXIF orientation when the decoder does not do it itself. */
const ORIENTATION_FILTERS: Record<number, string> = {
  2: 'hflip',
  3: 'hflip,vflip',
  4: 'vflip',
  5: 'transpose=cclock_flip',
  6: 'transpose=clock',
  7: 'transpose=clock_flip',
  8: 'transpose=cclock',
};

export function imageKey(ext: string, date = new Date()): string {
  const yyyy = String(date.getUTCFullYear());
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `images/${yyyy}/${mm}/${randomId(20)}.${ext}`;
}

/** Stores a file, turning remote-storage failures (too large for the bucket, bad key…) into Arabic API errors. */
async function putImage(deps: ImageDeps, key: string, file: string, contentType: string): Promise<void> {
  try {
    await deps.storage.putFile(key, file, { contentType, move: true });
  } catch (err) {
    throw storageAppError(err, STORAGE_MESSAGES.imageTooLarge) ?? err;
  }
}

interface ImageDeps {
  storage: StorageDriver;
  tools: MediaTools;
  /** Scratch directory on the local disk. */
  tmpDir: string;
}

/** Whether ffmpeg itself will rotate this image (newer builds honour the EXIF display matrix). */
async function decoderAppliesOrientation(tools: MediaTools, file: string): Promise<boolean> {
  try {
    const { stdout } = await run(
      tools.ffprobe,
      ['-v', 'error', '-protocol_whitelist', 'file', '-select_streams', 'v:0', '-show_frames', '-read_intervals', '%+#1', '-of', 'json', file],
      { timeoutMs: 30_000 },
    );
    const data = JSON.parse(stdout) as { frames?: { side_data_list?: { side_data_type?: string }[] }[] };
    return (data.frames?.[0]?.side_data_list ?? []).some((d) => /display ?matrix/i.test(d.side_data_type ?? ''));
  } catch {
    return false;
  }
}

/**
 * Validates an uploaded image by its magic bytes and stores it.
 * With ffmpeg (libwebp) it is re-encoded to WebP (long side ≤ 2400, EXIF orientation applied,
 * metadata stripped); GIFs are kept as-is so animations survive.
 */
export async function storeImage(deps: ImageDeps, buffer: Buffer): Promise<UploadedImage> {
  const type = sniffImage(buffer);
  if (!type) throw unsupportedMediaType('الملف لازم يكون صورة (JPEG أو PNG أو WebP أو AVIF أو GIF)');
  const headerSize = imageSize(buffer, type);
  if (
    headerSize &&
    (headerSize.width > MAX_INPUT_SIDE || headerSize.height > MAX_INPUT_SIDE || headerSize.width * headerSize.height > MAX_INPUT_PIXELS)
  ) {
    throw new AppError(400, 'BAD_REQUEST', 'أبعاد الصورة كبيرة جداً، صغّرها وارفعها مرة ثانية');
  }

  const work = path.join(deps.tmpDir, `img-${randomId(12)}`);
  await fs.mkdir(work, { recursive: true });
  try {
    const input = path.join(work, `input.${IMAGE_EXT[type]}`);
    await fs.writeFile(input, buffer);

    if (type !== 'gif' && deps.tools.available && deps.tools.webp) {
      const converted = await convertToWebp(deps.tools, input, type, buffer, work).catch(() => null);
      if (converted) {
        const key = imageKey('webp');
        await putImage(deps, key, converted.file, 'image/webp');
        return { key, url: deps.storage.url(key), width: converted.width, height: converted.height };
      }
    }

    // Fallback: keep the original bytes (GIF, or no ffmpeg/libwebp, or a format this ffmpeg cannot decode).
    let size = headerSize;
    if (!size && deps.tools.available) {
      const info = await probe(deps.tools, input).catch(() => null);
      size = info?.video ? { width: info.video.width, height: info.video.height } : null;
    }
    const key = imageKey(IMAGE_EXT[type]);
    await putImage(deps, key, input, IMAGE_MIME[type]);
    return { key, url: deps.storage.url(key), width: size?.width ?? null, height: size?.height ?? null };
  } finally {
    await fs.rm(work, { recursive: true, force: true });
  }
}

async function convertToWebp(
  tools: MediaTools,
  input: string,
  type: ImageType,
  buffer: Buffer,
  work: string,
): Promise<{ file: string; width: number | null; height: number | null }> {
  const filters: string[] = [];
  if (type === 'jpeg') {
    const orientation = jpegOrientation(buffer);
    if (orientation !== 1 && !(await decoderAppliesOrientation(tools, input))) {
      const f = ORIENTATION_FILTERS[orientation];
      if (f) filters.push(f);
    }
  }
  filters.push(
    `scale=w='min(${MAX_LONG_SIDE},iw)':h='min(${MAX_LONG_SIDE},ih)':force_original_aspect_ratio=decrease:flags=lanczos`,
  );
  const output = path.join(work, 'output.webp');
  await run(
    tools.ffmpeg,
    [
      '-hide_banner', '-nostdin', '-loglevel', 'error', '-y',
      // Decoder-side cap too, in case a header under-reports the real frame size (decompression bombs).
      '-protocol_whitelist', 'file', '-max_pixels', String(MAX_INPUT_PIXELS),
      '-i', input,
      '-map_metadata', '-1',
      '-vf', filters.join(','),
      '-frames:v', '1',
      '-c:v', 'libwebp', '-quality', '84', '-compression_level', '5', '-preset', 'picture',
      output,
    ],
    { timeoutMs: 120_000 },
  );
  const info = await probe(tools, output);
  return { file: output, width: info.video?.width ?? null, height: info.video?.height ?? null };
}
