import { useCallback, useEffect, useRef, type RefObject } from 'react';
import { useMotionValue, type MotionValue } from 'motion/react';

export interface ScrollTimeline {
  /** 0…1 through the element (see `mode`). A plain MotionValue — never a native ViewTimeline (see useScrollProgress). */
  progress: MotionValue<number>;
  /** Document scroll offset at which the timeline reads `p` (for "go to" controls). */
  scrollYAt: (p: number) => number;
}

/**
 * Scroll progress through a pinned runway without layout reads on scroll: the element's document offset and
 * size are measured on mount / resize / layout changes, and each scroll event only does arithmetic on
 * `window.scrollY` (Lenis scrolls the window natively, so this stays in sync with smooth scrolling).
 *
 * - `contain`: 0 when the element's top reaches the viewport top, 1 when its bottom reaches the viewport bottom.
 * - `exit`: 0 at the top, 1 once the element has fully scrolled out of the top.
 */
export function useScrollTimeline(ref: RefObject<HTMLElement | null>, mode: 'contain' | 'exit' = 'contain'): ScrollTimeline {
  const progress = useMotionValue(0);
  const geo = useRef({ top: 0, span: 1 });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => {
      const { top, span } = geo.current;
      const v = span > 0 ? (window.scrollY - top) / span : window.scrollY >= top ? 1 : 0;
      progress.set(Math.min(1, Math.max(0, v)));
    };
    const measure = () => {
      const top = el.getBoundingClientRect().top + window.scrollY;
      const h = el.offsetHeight;
      geo.current = { top, span: mode === 'contain' ? h - window.innerHeight : h };
      update();
    };
    measure();
    window.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', measure);
    window.addEventListener('load', measure);
    // anything above can change height (images, fonts, data) and move the runway
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    ro?.observe(el);
    ro?.observe(document.body);
    return () => {
      window.removeEventListener('scroll', update);
      window.removeEventListener('resize', measure);
      window.removeEventListener('load', measure);
      ro?.disconnect();
    };
  }, [ref, mode, progress]);

  const scrollYAt = useCallback((p: number) => geo.current.top + geo.current.span * Math.min(1, Math.max(0, p)), []);
  return { progress, scrollYAt };
}
