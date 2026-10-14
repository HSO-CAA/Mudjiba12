import { useEffect, useRef } from 'react';
import { animate, useInView, useReducedMotion } from 'motion/react';
import { formatNumber, NUMERALS, type Numerals } from '../lib/format';

/** Counts up to `value` once visible (Arabic numerals via formatNumber). */
export function Counter({ value, className, numerals = NUMERALS }: { value: number; className?: string; numerals?: Numerals }) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, margin: '0px 0px -15% 0px' });
  const reduced = useReducedMotion();
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (!inView || reduced) {
      el.textContent = formatNumber(reduced || inView ? value : 0, numerals);
      return;
    }
    const controls = animate(0, value, {
      duration: Math.min(2.4, 1.1 + Math.log10(Math.max(10, value)) * 0.3),
      ease: [0.16, 1, 0.3, 1],
      onUpdate: (v) => {
        el.textContent = formatNumber(Math.round(v), numerals);
      },
    });
    return () => controls.stop();
  }, [inView, reduced, value, numerals]);
  return (
    <span ref={ref} className={className}>
      {formatNumber(0, numerals)}
    </span>
  );
}
