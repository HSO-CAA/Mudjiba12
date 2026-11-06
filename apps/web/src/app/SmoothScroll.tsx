import { createContext, useCallback, useContext, useEffect, useMemo, useRef, type ReactNode } from 'react';
import Lenis from 'lenis';
import { useReducedMotion } from '../hooks/useMediaQuery';

interface ScrollApi {
  scrollTo: (target: number | string | HTMLElement, options?: { offset?: number; immediate?: boolean }) => void;
  lock: () => void;
  unlock: () => void;
}

const ScrollContext = createContext<ScrollApi | null>(null);

const cineEase = (t: number) => Math.min(1, 1.001 - 2 ** (-10 * t));

/** Lenis smooth scrolling (disabled for reduced motion) + a small imperative API. */
export function SmoothScroll({ children }: { children: ReactNode }) {
  const reduced = useReducedMotion();
  const lenisRef = useRef<Lenis | null>(null);
  const locks = useRef(0);

  useEffect(() => {
    if (reduced) return;
    const lenis = new Lenis({
      autoRaf: true,
      lerp: 0.1,
      smoothWheel: true,
      wheelMultiplier: 0.95,
      touchMultiplier: 1.2,
      anchors: false,
      allowNestedScroll: true,
    });
    lenisRef.current = lenis;
    if (locks.current > 0) lenis.stop();
    return () => {
      lenis.destroy();
      lenisRef.current = null;
    };
  }, [reduced]);

  const scrollTo = useCallback<ScrollApi['scrollTo']>((target, options = {}) => {
    const header = document.querySelector<HTMLElement>('[data-site-header]');
    const offset = options.offset ?? (typeof target === 'number' ? 0 : -((header?.offsetHeight ?? 0) + 8));
    const lenis = lenisRef.current;
    if (lenis) {
      lenis.scrollTo(target, { offset, immediate: options.immediate, duration: 1.4, easing: cineEase, force: true });
      return;
    }
    let top: number;
    if (typeof target === 'number') top = target;
    else {
      const el = typeof target === 'string' ? document.querySelector<HTMLElement>(target) : target;
      if (!el) return;
      top = el.getBoundingClientRect().top + window.scrollY + offset;
    }
    window.scrollTo({ top, behavior: options.immediate || reduced ? 'auto' : 'smooth' });
  }, [reduced]);

  const lock = useCallback(() => {
    locks.current++;
    lenisRef.current?.stop();
    document.documentElement.style.overflow = 'hidden';
  }, []);

  const unlock = useCallback(() => {
    locks.current = Math.max(0, locks.current - 1);
    if (locks.current === 0) {
      lenisRef.current?.start();
      document.documentElement.style.overflow = '';
    }
  }, []);

  const api = useMemo(() => ({ scrollTo, lock, unlock }), [scrollTo, lock, unlock]);
  return <ScrollContext.Provider value={api}>{children}</ScrollContext.Provider>;
}

export function useSmoothScroll(): ScrollApi {
  const ctx = useContext(ScrollContext);
  if (!ctx) throw new Error('useSmoothScroll must be used inside <SmoothScroll>');
  return ctx;
}
