/** Client-side video helpers: metadata probing and frame capture (for automatic posters and the frame picker). */

export interface VideoMeta {
  durationSec: number | null;
  width: number | null;
  height: number | null;
}

export interface ProbeResult {
  meta: VideoMeta | null;
  poster: Blob | null;
}

const POSTER_MAX_SIDE = 1280;

function once(target: HTMLMediaElement, event: string, timeoutMs: number): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      cleanup();
      reject(new Error(`timeout:${event}`));
    }, timeoutMs);
    const onEvent = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error('media-error'));
    };
    const cleanup = () => {
      window.clearTimeout(timer);
      target.removeEventListener(event, onEvent);
      target.removeEventListener('error', onError);
    };
    target.addEventListener(event, onEvent, { once: true });
    target.addEventListener('error', onError, { once: true });
  });
}

export function readMeta(video: HTMLVideoElement): VideoMeta {
  const duration = Number.isFinite(video.duration) && video.duration > 0 ? Math.round(video.duration * 100) / 100 : null;
  return {
    durationSec: duration,
    width: video.videoWidth || null,
    height: video.videoHeight || null,
  };
}

/** Draws the current frame of a <video> to a JPEG blob (long side ≤ 1280 px). */
export function captureFrame(video: HTMLVideoElement, maxSide = POSTER_MAX_SIDE, quality = 0.88): Promise<Blob> {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (!vw || !vh) return Promise.reject(new Error('no-frame'));
  const scale = Math.min(1, maxSide / Math.max(vw, vh));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(vw * scale);
  canvas.height = Math.round(vh * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) return Promise.reject(new Error('no-canvas'));
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  return new Promise<Blob>((resolve, reject) => {
    try {
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('encode-failed'))), 'image/jpeg', quality);
    } catch (error) {
      // SecurityError: the canvas is tainted (cross-origin media without CORS).
      reject(error instanceof Error ? error : new Error('tainted'));
    }
  });
}

/**
 * Reads duration/size from a local file and grabs a poster frame at ~1 s.
 * Never throws: formats the browser can't decode (e.g. HEVC on some desktops) just yield nulls,
 * and the server generates the poster instead.
 */
export async function probeVideoFile(file: File, timeoutMs = 15_000): Promise<ProbeResult> {
  const url = URL.createObjectURL(file);
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  video.setAttribute('playsinline', '');
  video.setAttribute('muted', '');
  let meta: VideoMeta | null = null;
  try {
    const loaded = once(video, 'loadedmetadata', timeoutMs);
    video.src = url;
    video.load();
    await loaded;
    meta = readMeta(video);
    if (!meta.width || !meta.height) return { meta, poster: null };

    const duration = meta.durationSec ?? 0;
    const target = duration > 2 ? 1 : duration > 0 ? duration / 2 : 0;
    if (video.readyState < 2) await once(video, 'loadeddata', timeoutMs).catch(() => undefined);
    if (target > 0 && Math.abs(video.currentTime - target) > 0.01) {
      const seeked = once(video, 'seeked', timeoutMs);
      video.currentTime = target;
      await seeked;
    }
    const poster = await captureFrame(video).catch(() => null);
    return { meta, poster };
  } catch {
    return { meta, poster: null };
  } finally {
    video.removeAttribute('src');
    video.load();
    URL.revokeObjectURL(url);
  }
}

/* ─────────────────────────── Accepted video files (CONTRACT.md) ─────────────────────────── */

export const VIDEO_TYPES = ['video/mp4', 'video/quicktime', 'video/webm', 'video/x-matroska', 'video/x-m4v'] as const;
const EXT_TO_MIME: Record<string, string> = {
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  webm: 'video/webm',
  mkv: 'video/x-matroska',
  m4v: 'video/x-m4v',
};
export const VIDEO_ACCEPT = [...VIDEO_TYPES, '.mp4', '.mov', '.webm', '.mkv', '.m4v'].join(',');
export const VIDEO_MAX_BYTES = 2048 * 1024 * 1024;

const extension = (name: string): string => name.split('.').pop()?.toLowerCase() ?? '';

/** The MIME type to declare for a file: the browser's when valid, otherwise inferred from the extension. */
export function videoMimeType(file: File): string | null {
  if ((VIDEO_TYPES as readonly string[]).includes(file.type)) return file.type;
  return EXT_TO_MIME[extension(file.name)] ?? null;
}

export function validateVideoFile(file: File): string | null {
  if (!videoMimeType(file)) return `«${file.name}» مو ملف فيديو مدعوم (MP4 أو MOV أو WebM أو MKV أو M4V)`;
  if (file.size === 0) return `«${file.name}» فارغ`;
  if (file.size > VIDEO_MAX_BYTES) return `«${file.name}» أكبر من 2 غيغابايت`;
  return null;
}
