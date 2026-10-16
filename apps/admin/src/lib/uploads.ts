import type { AdminVideo, VideoUploadSession } from '@s5y/shared';
import { ApiError, errorMessage, isAbortError } from './api';
import { api } from './endpoints';
import { probeVideoFile, validateVideoFile, videoMimeType, type ProbeResult } from './media';
import { qk, queryClient } from './query';
import { titleFromFileName } from './format';
import { uploadImage } from './upload-image';

/**
 * Resumable chunked video uploads (docs/CONTRACT.md → "Chunked upload protocol").
 *
 * A module-level queue so uploads keep running while the owner moves around the dashboard.
 * Each file: POST /videos/uploads → PATCH chunks with `Upload-Offset` → POST …/complete.
 * - Chunk size adapts to the connection (≈2 s per request, capped by the server's `chunkSize`)
 *   so progress, speed and ETA stay live even on slow mobile networks.
 * - Network / 5xx / 429 failures retry with exponential backoff + jitter, re-syncing the offset
 *   with GET /videos/:id/upload first; `409 OFFSET_MISMATCH` jumps to the server's offset.
 * - Pause aborts the in-flight chunk; resume re-syncs and continues. Cancel deletes the video.
 * - While uploading, a poster frame + metadata are read locally from a <video> element and
 *   sent with `complete` (the poster goes through /uploads/image first).
 */

export type UploadPhase =
  | 'queued'
  | 'starting'
  | 'uploading'
  | 'retrying'
  | 'offline'
  | 'paused'
  | 'finalizing'
  | 'done'
  | 'error';

export interface UploadItem {
  id: string;
  placeId: string;
  fileName: string;
  size: number;
  title: string;
  phase: UploadPhase;
  videoId: string | null;
  uploaded: number;
  /** Smoothed throughput in bytes/second (0 until the first chunk lands). */
  speed: number;
  /** Seconds remaining, null when unknown. */
  eta: number | null;
  error: string | null;
  /** The error can't be fixed by retrying (e.g. the file isn't a real video): offer removal, not "retry". */
  fatal: boolean;
  /** Consecutive failed attempts for the current chunk. */
  attempt: number;
  /** Countdown until the next automatic retry. */
  retryInSec: number | null;
  /** Local object URL of the captured poster frame (for the queue thumbnail). */
  posterPreview: string | null;
  result: AdminVideo | null;
  addedAt: number;
}

interface Internal {
  file: File;
  controller: AbortController | null;
  intent: 'pause' | 'cancel' | null;
  probe: Promise<ProbeResult> | null;
  chunk: number;
}

export interface UploadNotifier {
  onDone?: (item: UploadItem) => void;
  onError?: (item: UploadItem) => void;
  onRejected?: (message: string) => void;
}

const CONCURRENCY = 2;
const MAX_ATTEMPTS = 8;
const MAX_MISMATCHES = 6;
const MIN_CHUNK = 256 * 1024;
const FIRST_CHUNK = 1024 * 1024;
const TARGET_CHUNK_SECONDS = 2;
const PROBE_WAIT_MS = 20_000;
const ACTIVE: ReadonlySet<UploadPhase> = new Set(['starting', 'uploading', 'retrying', 'offline', 'finalizing']);
export const isActivePhase = (phase: UploadPhase): boolean => ACTIVE.has(phase);

class AbortedError extends Error {
  constructor() {
    super('aborted');
    this.name = 'AbortError';
  }
}

function isRetryable(error: unknown): boolean {
  if (!(error instanceof ApiError)) return true; // unknown fetch failure → treat as transient
  if (error.isNetwork) return true;
  return error.status === 408 || error.status === 429 || error.status >= 500;
}

function backoffSeconds(attempt: number, error: unknown): number {
  const base = Math.min(30, 2 ** Math.max(0, attempt - 1));
  const jittered = base * (0.8 + Math.random() * 0.4);
  const retryAfter = error instanceof ApiError ? error.retryAfterSec : null;
  return Math.max(1, Math.round(retryAfter ? Math.max(retryAfter, jittered) : jittered));
}

const roundChunk = (bytes: number) => Math.max(MIN_CHUNK, Math.round(bytes / MIN_CHUNK) * MIN_CHUNK);

let localSeq = 0;

class UploadManager {
  private items = new Map<string, UploadItem>();
  private internals = new Map<string, Internal>();
  private order: string[] = [];
  private listeners = new Set<() => void>();
  private snapshot: UploadItem[] = [];
  private notifier: UploadNotifier = {};

  /* ── store ── */

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): UploadItem[] => this.snapshot;

  setNotifier(notifier: UploadNotifier): void {
    this.notifier = notifier;
  }

  private emit(): void {
    this.snapshot = this.order.flatMap((id) => {
      const item = this.items.get(id);
      return item ? [item] : [];
    });
    for (const listener of this.listeners) listener();
  }

  private patch(id: string, changes: Partial<UploadItem>): UploadItem | null {
    const current = this.items.get(id);
    if (!current) return null;
    const next = { ...current, ...changes };
    this.items.set(id, next);
    this.emit();
    return next;
  }

  hasActiveUploads(): boolean {
    for (const item of this.items.values()) if (item.phase !== 'done' && item.phase !== 'error') return true;
    return false;
  }

  /* ── public actions ── */

  /** Queues new files for a place. Invalid files are reported and skipped. */
  add(placeId: string, files: Iterable<File>): number {
    let added = 0;
    for (const file of files) {
      const problem = validateVideoFile(file);
      if (problem) {
        this.notifier.onRejected?.(problem);
        continue;
      }
      this.enqueue(placeId, file, null);
      added += 1;
    }
    this.pump();
    return added;
  }

  /** Continues an upload left unfinished (e.g. after a page reload) once the owner re-selects the file. */
  resumeExisting(video: AdminVideo, file: File): string | null {
    if (file.size !== video.sizeBytes) {
      return `حجم «${file.name}» ما يطابق الملف الأصلي (${video.originalName ?? 'الفيديو'}) — اختار نفس الملف`;
    }
    const existing = [...this.items.values()].find((item) => item.videoId === video.id);
    if (existing) this.remove(existing.id);
    this.enqueue(video.placeId, file, video.id, video.title ?? undefined, video.uploadedBytes);
    this.pump();
    return null;
  }

  pause(id: string): void {
    const item = this.items.get(id);
    const internal = this.internals.get(id);
    if (!item || !internal) return;
    if (item.phase === 'queued') {
      this.patch(id, { phase: 'paused', speed: 0, eta: null });
      return;
    }
    if (!isActivePhase(item.phase) || item.phase === 'finalizing') return;
    internal.intent = 'pause';
    internal.controller?.abort();
    this.patch(id, { phase: 'paused', speed: 0, eta: null, retryInSec: null });
  }

  resume(id: string): void {
    const item = this.items.get(id);
    if (!item || (item.phase !== 'paused' && item.phase !== 'error')) return;
    if (item.fatal) return;
    this.patch(id, { phase: 'queued', error: null, attempt: 0, retryInSec: null });
    this.pump();
  }

  async cancel(id: string): Promise<void> {
    const item = this.items.get(id);
    const internal = this.internals.get(id);
    if (!item || !internal) return;
    internal.intent = 'cancel';
    internal.controller?.abort();
    this.remove(id);
    if (item.videoId && item.phase !== 'done') {
      await api.videos.remove(item.videoId).catch(() => undefined);
      void queryClient.invalidateQueries({ queryKey: qk.place(item.placeId) });
      void queryClient.invalidateQueries({ queryKey: qk.videosAll });
    }
    this.pump();
  }

  /** Removes a finished/failed row from the queue (does not touch the server). */
  dismiss(id: string): void {
    const item = this.items.get(id);
    if (!item || isActivePhase(item.phase)) return;
    this.remove(id);
  }

  clearFinished(placeId?: string): void {
    for (const item of [...this.items.values()]) {
      if (item.phase === 'done' && (!placeId || item.placeId === placeId)) this.remove(item.id);
    }
  }

  /* ── internals ── */

  private enqueue(placeId: string, file: File, videoId: string | null, title?: string, uploaded = 0): string {
    localSeq += 1;
    const id = `u${Date.now().toString(36)}${localSeq}`;
    this.items.set(id, {
      id,
      placeId,
      fileName: file.name,
      size: file.size,
      title: title ?? titleFromFileName(file.name),
      phase: 'queued',
      videoId,
      uploaded,
      speed: 0,
      eta: null,
      error: null,
      fatal: false,
      attempt: 0,
      retryInSec: null,
      posterPreview: null,
      result: null,
      addedAt: Date.now(),
    });
    this.internals.set(id, { file, controller: null, intent: null, probe: null, chunk: FIRST_CHUNK });
    this.order.push(id);
    this.emit();
    return id;
  }

  private remove(id: string): void {
    const item = this.items.get(id);
    if (item?.posterPreview) URL.revokeObjectURL(item.posterPreview);
    this.items.delete(id);
    this.internals.delete(id);
    this.order = this.order.filter((x) => x !== id);
    this.emit();
  }

  private pump(): void {
    let active = 0;
    for (const item of this.items.values()) if (isActivePhase(item.phase)) active += 1;
    for (const id of this.order) {
      if (active >= CONCURRENCY) break;
      const item = this.items.get(id);
      if (item?.phase === 'queued') {
        active += 1;
        void this.run(id);
      }
    }
  }

  private startProbe(id: string, internal: Internal): void {
    if (internal.probe) return;
    internal.probe = probeVideoFile(internal.file).then((result) => {
      if (result.poster && this.items.has(id)) {
        this.patch(id, { posterPreview: URL.createObjectURL(result.poster) });
      }
      return result;
    });
  }

  private async run(id: string): Promise<void> {
    const internal = this.internals.get(id);
    const initial = this.items.get(id);
    if (!internal || !initial) return;
    const controller = new AbortController();
    internal.controller = controller;
    internal.intent = null;
    const { signal } = controller;
    this.patch(id, { phase: 'starting', error: null, retryInSec: null });
    this.startProbe(id, internal);

    try {
      let session: VideoUploadSession;
      let videoId = initial.videoId;
      if (!videoId) {
        session = await this.withRetries(id, signal, () =>
          api.videos.initUpload(
            {
              placeId: initial.placeId,
              fileName: internal.file.name,
              size: internal.file.size,
              mimeType: videoMimeType(internal.file) ?? 'video/mp4',
              title: initial.title || null,
            },
            signal,
          ),
        );
        videoId = session.videoId;
        this.patch(id, { videoId, attempt: 0 });
        void queryClient.invalidateQueries({ queryKey: qk.place(initial.placeId) });
      } else {
        const existingId = videoId;
        session = await this.withRetries(id, signal, () => api.videos.uploadStatus(existingId, signal));
      }

      await this.sendChunks(id, videoId, session, signal);

      this.patch(id, { phase: 'finalizing', speed: 0, eta: 0, uploaded: internal.file.size });
      const video = await this.finalize(id, videoId, signal);
      const done = this.patch(id, { phase: 'done', result: video, uploaded: internal.file.size, eta: null });
      this.invalidateAfterUpload(initial.placeId);
      if (done) this.notifier.onDone?.(done);
    } catch (error) {
      if (isAbortError(error) || signal.aborted) {
        // Paused or cancelled: state was already updated by pause()/cancel().
        if (internal.intent !== 'pause' && internal.intent !== 'cancel') this.patch(id, { phase: 'paused' });
      } else {
        const failed = this.patch(id, {
          phase: 'error',
          error: errorMessage(error, 'تعذّر رفع الفيديو'),
          // 401 is fixed by signing in again; other 4xx (bad file, too large, deleted video) won't change on retry.
          fatal: error instanceof ApiError && !isRetryable(error) && error.status !== 401,
          speed: 0,
          eta: null,
          retryInSec: null,
        });
        if (failed) this.notifier.onError?.(failed);
      }
    } finally {
      if (internal.controller === controller) internal.controller = null;
      this.pump();
    }
  }

  private async sendChunks(id: string, videoId: string, session: VideoUploadSession, signal: AbortSignal): Promise<void> {
    const internal = this.internals.get(id);
    if (!internal) throw new AbortedError();
    const { file } = internal;
    const size = file.size;
    const maxChunk = Math.max(MIN_CHUNK, session.chunkSize);
    let offset = session.offset;
    let mismatches = 0;
    this.patch(id, { phase: 'uploading', uploaded: offset });

    while (offset < size) {
      if (signal.aborted) throw new AbortedError();
      const length = Math.min(internal.chunk, maxChunk, size - offset);
      const startedAt = performance.now();
      try {
        const { offset: next } = await api.videos.uploadChunk(videoId, offset, file.slice(offset, offset + length), signal);
        const seconds = Math.max(0.05, (performance.now() - startedAt) / 1000);
        const sent = Math.max(0, next - offset);
        if (sent === 0) {
          // The server didn't advance; guard against looping forever on a misbehaving proxy.
          mismatches += 1;
          if (mismatches > MAX_MISMATCHES) throw new ApiError(500, 'INTERNAL_ERROR', 'الخادم ما استلم أجزاء الفيديو، حاول مرة ثانية');
          offset = next;
          continue;
        }
        offset = next;
        mismatches = 0;
        // Adapt the next chunk to ≈2 s of transfer.
        internal.chunk = Math.min(maxChunk, roundChunk(length * (TARGET_CHUNK_SECONDS / seconds)));
        const current = this.items.get(id);
        const instant = sent / seconds;
        const speed = current && current.speed > 0 ? current.speed * 0.65 + instant * 0.35 : instant;
        this.patch(id, {
          phase: 'uploading',
          uploaded: offset,
          speed,
          eta: speed > 0 ? (size - offset) / speed : null,
          attempt: 0,
          retryInSec: null,
          error: null,
        });
      } catch (error) {
        if (isAbortError(error) || signal.aborted) throw new AbortedError();
        if (error instanceof ApiError && error.code === 'OFFSET_MISMATCH' && error.serverOffset !== null) {
          mismatches += 1;
          if (mismatches > MAX_MISMATCHES) throw error;
          offset = error.serverOffset;
          this.patch(id, { uploaded: offset });
          continue;
        }
        if (!isRetryable(error)) throw error;
        // Smaller chunks survive flaky networks better.
        internal.chunk = Math.max(MIN_CHUNK, roundChunk(internal.chunk / 2));
        await this.waitBeforeRetry(id, error, signal);
        const status = await this.withRetries(id, signal, () => api.videos.uploadStatus(videoId, signal));
        offset = status.offset;
        this.patch(id, { phase: 'uploading', uploaded: offset });
      }
    }
  }

  private async finalize(id: string, videoId: string, signal: AbortSignal): Promise<AdminVideo> {
    const internal = this.internals.get(id);
    if (!internal) throw new AbortedError();
    const probe = await Promise.race([
      internal.probe ?? Promise.resolve<ProbeResult>({ meta: null, poster: null }),
      new Promise<ProbeResult>((resolve) => window.setTimeout(() => resolve({ meta: null, poster: null }), PROBE_WAIT_MS)),
    ]);

    let posterKey: string | null = null;
    if (probe.poster) {
      try {
        const image = await uploadImage(probe.poster, { fileName: 'poster.jpg', signal });
        posterKey = image.key;
      } catch (error) {
        if (isAbortError(error)) throw error;
        // Non-fatal: the server generates a poster when none is supplied.
      }
    }

    const body = {
      durationSec: probe.meta?.durationSec ?? null,
      width: probe.meta?.width ?? null,
      height: probe.meta?.height ?? null,
      ...(posterKey ? { posterKey } : {}),
    };

    for (let round = 0; ; round += 1) {
      try {
        return await this.withRetries(id, signal, () => api.videos.completeUpload(videoId, body, signal));
      } catch (error) {
        // The server is missing bytes (e.g. a lost final chunk): resend from its offset, then complete again.
        if (error instanceof ApiError && error.code === 'OFFSET_MISMATCH' && round < 2) {
          const status = await this.withRetries(id, signal, () => api.videos.uploadStatus(videoId, signal));
          await this.sendChunks(id, videoId, status, signal);
          this.patch(id, { phase: 'finalizing' });
          continue;
        }
        throw error;
      }
    }
  }

  /** Runs a request, retrying transient failures with backoff. */
  private async withRetries<T>(id: string, signal: AbortSignal, fn: () => Promise<T>): Promise<T> {
    for (;;) {
      try {
        return await fn();
      } catch (error) {
        if (isAbortError(error) || signal.aborted) throw new AbortedError();
        if (!isRetryable(error)) throw error;
        await this.waitBeforeRetry(id, error, signal);
      }
    }
  }

  private async waitBeforeRetry(id: string, error: unknown, signal: AbortSignal): Promise<void> {
    const item = this.items.get(id);
    if (!item) throw new AbortedError();
    const attempt = item.attempt + 1;
    if (attempt > MAX_ATTEMPTS) {
      throw error instanceof ApiError && !error.isNetwork
        ? error
        : new ApiError(0, 'NETWORK_ERROR', 'انقطع الاتصال أكثر من مرة — تأكد من الإنترنت واضغط «إعادة المحاولة»');
    }
    const resumePhase: UploadPhase = item.phase === 'retrying' || item.phase === 'offline' ? 'uploading' : item.phase;

    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      this.patch(id, { phase: 'offline', attempt, speed: 0, eta: null, retryInSec: null });
      await waitForOnline(signal);
    }

    let remaining = backoffSeconds(attempt, error);
    this.patch(id, { phase: 'retrying', attempt, retryInSec: remaining, speed: 0, eta: null });
    while (remaining > 0) {
      await sleep(1000, signal);
      remaining -= 1;
      this.patch(id, { retryInSec: remaining });
    }
    this.patch(id, { phase: resumePhase, retryInSec: null });
  }

  private invalidateAfterUpload(placeId: string): void {
    void queryClient.invalidateQueries({ queryKey: qk.place(placeId) });
    void queryClient.invalidateQueries({ queryKey: qk.places });
    void queryClient.invalidateQueries({ queryKey: qk.videosAll });
    void queryClient.invalidateQueries({ queryKey: qk.overviewAll });
  }
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(new AbortedError());
      return;
    }
    const timer = window.setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      window.clearTimeout(timer);
      reject(new AbortedError());
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

function waitForOnline(signal: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (navigator.onLine) {
      resolve();
      return;
    }
    const onOnline = () => {
      cleanup();
      resolve();
    };
    const onAbort = () => {
      cleanup();
      reject(new AbortedError());
    };
    const cleanup = () => {
      window.removeEventListener('online', onOnline);
      signal.removeEventListener('abort', onAbort);
    };
    window.addEventListener('online', onOnline);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

export const uploads = new UploadManager();

if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', (event) => {
    if (!uploads.hasActiveUploads()) return;
    event.preventDefault();
    // Legacy browsers need returnValue set to show the native "leave site?" prompt.
    event.returnValue = '';
  });
}
