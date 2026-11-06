import { useEffect, type RefObject } from 'react';
import { useMotionValue, type MotionValue } from 'motion/react';

/**
 * How far the page has scrolled through an element, as a plain MotionValue (0…1).
 *
 * - `contain`: offset ['start start', 'end end'] — a sticky runway (the hero).
 * - `exit`: offset ['start start', 'end start'] — the element scrolling out of the top.
 *
 * Use this instead of motion's `useScroll({ target })`. In framer-motion 14, any value from that hook
 * that drives an accelerated style (opacity/transform/filter) gets a native `ViewTimeline` that is
 * cached in a module-level Map keyed by the target element and never released. That pins the element,
 * and through its React fiber the whole previous page, including the WebGL renderer, scene textures
 * and decoded <video>s. A page's memory would grow on every home ↔ place navigation.
 */
export function useScrollProgress(ref: RefObject<HTMLElement | null>, mode: 'contain' | 'exit'): MotionValue<number> {
  const progress = useMotionValue(0);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => {
      const r = el.getBoundingClientRect();
      const span = mode === 'contain' ? r.height - window.innerHeight : r.height;
      const v = span > 0 ? -r.top / span : r.top <= 0 ? 1 : 0;
      progress.set(Math.min(1, Math.max(0, v)));
    };
    update();
    window.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update);
    ro?.observe(el);
    return () => {
      window.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
      ro?.disconnect();
    };
  }, [ref, mode, progress]);

  return progress;
}
