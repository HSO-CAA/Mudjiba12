import { useEffect, useSyncExternalStore } from 'react';

/**
 * One WebGL canvas renders at a time. Every scene asks for the lease while it is on screen; the most recent
 * claimant wins (the section scrolling in), and the lease falls back to an earlier claimant that still wants
 * it when the newer one leaves. No three.js imports — safe for the main chunk.
 */
const claims: string[] = [];
const listeners = new Set<() => void>();
let owner: string | null = null;

function emit(): void {
  const next = claims.length ? (claims[claims.length - 1] as string) : null;
  if (next === owner) return;
  owner = next;
  listeners.forEach((l) => l());
}

function claim(id: string): void {
  const i = claims.indexOf(id);
  if (i >= 0) claims.splice(i, 1);
  claims.push(id);
  emit();
}

function release(id: string): void {
  const i = claims.indexOf(id);
  if (i < 0) return;
  claims.splice(i, 1);
  emit();
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

/** True when the scene `id` (which wants to render: on screen, tab visible) holds the render lease. */
export function useRenderLease(id: string, wants: boolean): boolean {
  useEffect(() => {
    if (!wants) return;
    claim(id);
    return () => release(id);
  }, [id, wants]);
  const current = useSyncExternalStore(
    subscribe,
    () => owner,
    () => null,
  );
  return wants && current === id;
}
