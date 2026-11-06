import { AbortedError } from './ffmpeg.js';

export interface Log {
  debug(obj: object, msg?: string): void;
  info(obj: object, msg?: string): void;
  warn(obj: object, msg?: string): void;
  error(obj: object, msg?: string): void;
}

export type MediaJob = (videoId: string, signal: AbortSignal) => Promise<void>;

interface Running {
  id: string;
  controller: AbortController;
  promise: Promise<void>;
}

/**
 * In-process FIFO queue with concurrency 1. Durability comes from the database:
 * a video stays `PROCESSING` until its job finishes, and the app re-enqueues
 * every `PROCESSING` video at boot.
 */
export class MediaQueue {
  private readonly pending: string[] = [];
  private current: Running | null = null;
  private closed = false;
  private idleWaiters: (() => void)[] = [];

  constructor(
    private readonly job: MediaJob,
    private readonly log: Log,
  ) {}

  /** Jobs waiting or running. */
  get size(): number {
    return this.pending.length + (this.current ? 1 : 0);
  }

  get runningId(): string | null {
    return this.current?.id ?? null;
  }

  /** Adds a job. Re-enqueueing a running video restarts it (used by "reprocess"). */
  enqueue(videoId: string): void {
    if (this.closed || this.pending.includes(videoId)) return;
    if (this.current?.id === videoId) this.current.controller.abort();
    this.pending.push(videoId);
    this.kick();
  }

  /** Drops a waiting job and aborts it if it is running (used when a video is deleted). */
  cancel(videoId: string): void {
    const index = this.pending.indexOf(videoId);
    if (index !== -1) this.pending.splice(index, 1);
    if (this.current?.id === videoId) this.current.controller.abort();
  }

  /** Resolves when nothing is queued or running. */
  onIdle(): Promise<void> {
    if (!this.current && this.pending.length === 0) return Promise.resolve();
    return new Promise((resolve) => this.idleWaiters.push(resolve));
  }

  /** Stops accepting jobs and aborts the running one (it stays PROCESSING and resumes on next boot). */
  async close(): Promise<void> {
    this.closed = true;
    this.pending.length = 0;
    const running = this.current;
    if (running) {
      running.controller.abort();
      await running.promise;
    }
    this.flushIdle();
  }

  private kick(): void {
    if (this.current) return;
    const id = this.closed ? undefined : this.pending.shift();
    if (id === undefined) {
      this.flushIdle();
      return;
    }
    const controller = new AbortController();
    const promise = Promise.resolve()
      .then(() => this.job(id, controller.signal))
      .catch((err: unknown) => {
        if (err instanceof AbortedError) this.log.info({ videoId: id }, 'media job aborted');
        else this.log.error({ err, videoId: id }, 'media job crashed');
      })
      .finally(() => {
        this.current = null;
        this.kick();
      });
    this.current = { id, controller, promise };
  }

  private flushIdle(): void {
    if (this.current || this.pending.length > 0) return;
    const waiters = this.idleWaiters;
    this.idleWaiters = [];
    for (const resolve of waiters) resolve();
  }
}
