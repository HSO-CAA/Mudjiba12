import { spawn } from 'node:child_process';

export interface MediaTools {
  /** ffmpeg + ffprobe + libx264 found: videos are transcoded and posters generated. */
  available: boolean;
  ffmpeg: string;
  ffprobe: string;
  version: string | null;
  /** libwebp encoder present (images re-encoded to WebP). */
  webp: boolean;
  /** zscale + tonemap filters present (HDR phone footage is tone-mapped to SDR). */
  tonemap: boolean;
}

export class FfmpegError extends Error {
  constructor(
    message: string,
    readonly stderr: string,
    readonly exitCode: number | null,
  ) {
    super(message);
    this.name = 'FfmpegError';
  }
}

export class AbortedError extends Error {
  constructor() {
    super('Media job aborted');
    this.name = 'AbortedError';
  }
}

interface RunOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}

const STDERR_LIMIT = 16 * 1024;

/** Runs a binary and resolves with stdout (stderr is kept for error reporting). */
export function run(bin: string, args: string[], options: RunOptions = {}): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    if (options.signal?.aborted) {
      reject(new AbortedError());
      return;
    }
    const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    const stdout: Buffer[] = [];
    let stdoutLength = 0;
    let stderr = '';
    let settled = false;
    let timedOut = false;
    let aborted = false;

    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', onAbort);
      fn();
    };
    const onAbort = () => {
      aborted = true;
      child.kill('SIGKILL');
    };
    const timer = options.timeoutMs
      ? setTimeout(() => {
          timedOut = true;
          child.kill('SIGKILL');
        }, options.timeoutMs)
      : undefined;
    options.signal?.addEventListener('abort', onAbort, { once: true });

    child.stdout.on('data', (chunk: Buffer) => {
      stdoutLength += chunk.length;
      if (stdoutLength <= 8 * 1024 * 1024) stdout.push(chunk);
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr = (stderr + chunk.toString('utf8')).slice(-STDERR_LIMIT);
    });
    child.on('error', (err) => finish(() => reject(err)));
    child.on('close', (code) => {
      finish(() => {
        if (aborted) reject(new AbortedError());
        else if (timedOut) reject(new FfmpegError(`${bin} timed out`, stderr, code));
        else if (code !== 0) reject(new FfmpegError(`${bin} exited with code ${code}`, stderr, code));
        else resolve({ stdout: Buffer.concat(stdout).toString('utf8'), stderr });
      });
    });
  });
}

export async function detectMediaTools(ffmpeg: string, ffprobe: string): Promise<MediaTools> {
  const none: MediaTools = { available: false, ffmpeg, ffprobe, version: null, webp: false, tonemap: false };
  try {
    const [ff] = await Promise.all([
      run(ffmpeg, ['-hide_banner', '-version'], { timeoutMs: 10_000 }),
      run(ffprobe, ['-hide_banner', '-version'], { timeoutMs: 10_000 }),
    ]);
    const version = /ffmpeg version (\S+)/.exec(ff.stdout)?.[1] ?? null;
    const [encoders, filters] = await Promise.all([
      run(ffmpeg, ['-hide_banner', '-encoders'], { timeoutMs: 10_000 }),
      run(ffmpeg, ['-hide_banner', '-filters'], { timeoutMs: 10_000 }),
    ]);
    const hasEncoder = (name: string) => new RegExp(`^\\s*V\\S*\\s+${name}\\s`, 'm').test(encoders.stdout);
    const hasFilter = (name: string) => new RegExp(`^\\s*\\S+\\s+${name}\\s`, 'm').test(filters.stdout);
    if (!hasEncoder('libx264')) return { ...none, version };
    return {
      available: true,
      ffmpeg,
      ffprobe,
      version,
      webp: hasEncoder('libwebp'),
      tonemap: hasFilter('zscale') && hasFilter('tonemap'),
    };
  } catch {
    return none;
  }
}

/* ───────────────────────────── ffprobe ───────────────────────────── */

export interface ProbeResult {
  formatName: string;
  durationSec: number | null;
  video: {
    codec: string;
    pixFmt: string | null;
    /** Display size (rotation applied). */
    width: number;
    height: number;
    rotation: number;
    colorTransfer: string | null;
  } | null;
  audio: { codec: string } | null;
}

interface RawStream {
  codec_type?: string;
  codec_name?: string;
  width?: number;
  height?: number;
  pix_fmt?: string;
  color_transfer?: string;
  duration?: string;
  tags?: Record<string, string>;
  side_data_list?: { rotation?: number | string }[];
  disposition?: { attached_pic?: number };
}

const toNumber = (value: unknown): number | null => {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
  return Number.isFinite(n) ? n : null;
};

export async function probe(tools: MediaTools, file: string, signal?: AbortSignal): Promise<ProbeResult> {
  const { stdout } = await run(
    tools.ffprobe,
    ['-v', 'error', '-protocol_whitelist', 'file', '-print_format', 'json', '-show_format', '-show_streams', file],
    { signal, timeoutMs: 60_000 },
  );
  const data = JSON.parse(stdout) as { format?: { format_name?: string; duration?: string }; streams?: RawStream[] };
  const streams = data.streams ?? [];
  const v = streams.find((s) => s.codec_type === 'video' && !s.disposition?.attached_pic);
  const a = streams.find((s) => s.codec_type === 'audio');

  let video: ProbeResult['video'] = null;
  if (v && v.width && v.height) {
    const rawRotation = toNumber(v.side_data_list?.find((d) => d.rotation !== undefined)?.rotation) ?? toNumber(v.tags?.rotate) ?? 0;
    const rotation = ((Math.round(rawRotation) % 360) + 360) % 360;
    const swap = rotation === 90 || rotation === 270;
    video = {
      codec: v.codec_name ?? 'unknown',
      pixFmt: v.pix_fmt ?? null,
      width: swap ? v.height : v.width,
      height: swap ? v.width : v.height,
      rotation,
      colorTransfer: v.color_transfer ?? null,
    };
  }
  const duration = toNumber(data.format?.duration) ?? toNumber(v?.duration);
  return {
    formatName: data.format?.format_name ?? '',
    durationSec: duration !== null && duration > 0 ? Math.round(duration * 1000) / 1000 : null,
    video,
    audio: a ? { codec: a.codec_name ?? 'unknown' } : null,
  };
}

/** Last meaningful stderr line, for short error messages. */
export function stderrSummary(stderr: string): string {
  const lines = stderr
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  return (lines.at(-1) ?? '').slice(0, 300);
}
