/**
 * Mutable, render-loop friendly state shared between the HTML hero and the WebGL scene.
 * Written by DOM listeners, read inside useFrame — never triggers React renders.
 */
export const heroState = {
  /** 0 → 1 scroll progress through the hero runway (camera pushes into the lens). */
  progress: 0,
  /** Pointer position normalised to -1…1 (x: left→right, y: bottom→top). */
  pointerX: 0,
  pointerY: 0,
  /** performance.now() when the intro (camera dolly) should start; null until the loader is dismissed. */
  introAt: null as number | null,
  reducedMotion: false,
};

let pointerBound = false;

export function bindPointer(): void {
  if (pointerBound || typeof window === 'undefined') return;
  pointerBound = true;
  window.addEventListener(
    'pointermove',
    (e) => {
      if (e.pointerType === 'touch') return;
      heroState.pointerX = (e.clientX / window.innerWidth) * 2 - 1;
      heroState.pointerY = -((e.clientY / window.innerHeight) * 2 - 1);
    },
    { passive: true },
  );
}

/** Frame-rate independent exponential smoothing. */
export function damp(current: number, target: number, lambda: number, dt: number): number {
  return current + (target - current) * (1 - Math.exp(-lambda * dt));
}

export const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

export const easeOutExpo = (t: number) => (t >= 1 ? 1 : 1 - 2 ** (-10 * t));
export const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
