import { useEffect, useState, type RefObject } from 'react';

interface Options {
  rootMargin?: string;
  threshold?: number | number[];
  /** Stop observing after the first time the element becomes visible. */
  once?: boolean;
}

export function useInView<T extends Element>(ref: RefObject<T | null>, { rootMargin = '0px', threshold = 0, once = false }: Options = {}): boolean {
  const [inView, setInView] = useState(false);
  const thresholdKey = Array.isArray(threshold) ? threshold.join(',') : String(threshold);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === 'undefined') {
      setInView(true);
      return;
    }
    const io = new IntersectionObserver(
      ([entry]) => {
        if (!entry) return;
        setInView(entry.isIntersecting);
        if (entry.isIntersecting && once) io.disconnect();
      },
      { rootMargin, threshold },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [ref, rootMargin, thresholdKey, once]);

  return inView;
}
