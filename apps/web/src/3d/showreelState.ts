import { smoothstep } from './heroState';

/**
 * Scroll → reel mapping for the pinned 3D showreel, shared by the HTML stage (which owns the scroll) and the
 * WebGL helix (which reads `showreelState.target` every frame). No three.js imports — main-chunk safe.
 */
export const showreelState = {
  /** Continuous reel index the helix eases to (detented: it rests on each reel for part of the scroll). */
  target: 0,
};

/** Fractions of the runway that hold on the first / last reel (arrive and leave on a settled frame). */
const LEAD = 0.05;
const TAIL = 0.07;

/** Scroll distance per reel (svh) on wide screens / phones; the runway is one viewport plus this per reel. */
export const SHOWREEL_PER_REEL = { wide: 36, compact: 34 } as const;

/** Raw continuous reel index (0…n-1) at runway progress `p`. */
export function reelAt(p: number, n: number): number {
  if (n <= 1) return 0;
  const k = Math.min(1, Math.max(0, (p - LEAD) / (1 - LEAD - TAIL)));
  return k * (n - 1);
}

/**
 * Detents: each reel holds still for half of its share of the scroll and the helix turns over the other
 * half, so a reel that is "in front" is really parked there — without hijacking the scroll.
 */
export function detent(x: number): number {
  const base = Math.floor(x);
  return base + smoothstep(0.25, 0.75, x - base);
}

/** Runway progress at which reel `i` is parked in front. */
export function progressForReel(i: number, n: number): number {
  if (n <= 1) return 0;
  return LEAD + (i / (n - 1)) * (1 - LEAD - TAIL);
}
