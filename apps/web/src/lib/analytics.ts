import type { TrackEvent } from '@s5y/shared';
import { DEMO } from './demo';

const ENDPOINT = '/api/public/track';

function seen(key: string): boolean {
  try {
    if (sessionStorage.getItem(key)) return true;
    sessionStorage.setItem(key, '1');
    return false;
  } catch {
    // Storage blocked (private mode / disabled): fall back to an in-memory set.
    if (memory.has(key)) return true;
    memory.add(key);
    return false;
  }
}
const memory = new Set<string>();

function send(event: TrackEvent): void {
  if (DEMO) return;
  const body = JSON.stringify(event);
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
      const ok = navigator.sendBeacon(ENDPOINT, new Blob([body], { type: 'application/json' }));
      if (ok) return;
    }
    void fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      keepalive: true,
      credentials: 'same-origin',
    }).catch(() => undefined);
  } catch {
    /* analytics must never break the page */
  }
}

/** One pageview per path per session. */
export function trackPageview(path: string): void {
  const clean = path.split(/[?#]/)[0] || '/';
  if (seen(`s5y:pv:${clean}`)) return;
  send({ type: 'pageview', path: clean });
}

/** One play per video per session. */
export function trackPlay(videoId: string): void {
  if (seen(`s5y:play:${videoId}`)) return;
  send({ type: 'play', videoId });
}
