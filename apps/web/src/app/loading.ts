import { useEffect, useSyncExternalStore } from 'react';
import { heroState } from '../3d/heroState';

/**
 * Tiny boot-progress store behind the cinematic loader.
 * Pages register what the first paint depends on (data, fonts, the 3D scene); the loader
 * shows the average progress and lifts once everything is done (or after a hard timeout).
 */
interface Task {
  progress: number;
  done: boolean;
}

interface Snapshot {
  progress: number;
  ready: boolean;
  dismissed: boolean;
}

const tasks = new Map<string, Task>();
const listeners = new Set<() => void>();
let snapshot: Snapshot = { progress: 0, ready: false, dismissed: false };

function emit(): void {
  const list = [...tasks.values()];
  const progress = list.length ? list.reduce((a, t) => a + (t.done ? 1 : t.progress), 0) / list.length : 0;
  const ready = list.length > 0 && list.every((t) => t.done);
  snapshot = { progress, ready, dismissed: snapshot.dismissed };
  listeners.forEach((l) => l());
}

export const boot = {
  register(key: string): void {
    if (snapshot.dismissed || tasks.has(key)) return;
    tasks.set(key, { progress: 0, done: false });
    emit();
  },
  progress(key: string, value: number): void {
    const t = tasks.get(key);
    if (!t || t.done) return;
    t.progress = Math.max(t.progress, Math.min(1, value));
    emit();
  },
  complete(key: string): void {
    const t = tasks.get(key);
    if (!t) {
      if (!snapshot.dismissed) {
        tasks.set(key, { progress: 1, done: true });
        emit();
      }
      return;
    }
    if (t.done) return;
    t.done = true;
    t.progress = 1;
    emit();
  },
  dismiss(): void {
    if (snapshot.dismissed) return;
    snapshot = { ...snapshot, dismissed: true, progress: 1, ready: true };
    heroState.introAt = performance.now();
    listeners.forEach((l) => l());
  },
  isDismissed(): boolean {
    return snapshot.dismissed;
  },
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  getSnapshot(): Snapshot {
    return snapshot;
  },
};

export function useBoot(): Snapshot {
  return useSyncExternalStore(boot.subscribe, boot.getSnapshot, boot.getSnapshot);
}

/** Registers a boot task for the lifetime of the component and completes it when `done` flips true. */
export function useBootTask(key: string, done: boolean, progress?: number): void {
  useEffect(() => {
    boot.register(key);
  }, [key]);
  useEffect(() => {
    if (typeof progress === 'number') boot.progress(key, progress);
  }, [key, progress]);
  useEffect(() => {
    if (done) boot.complete(key);
  }, [key, done]);
}
