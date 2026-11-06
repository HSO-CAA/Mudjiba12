import { useEffect, useRef } from 'react';
import { useCoarsePointer, useReducedMotion } from '../hooks/useMediaQuery';

/** Site-wide film grain (very subtle, animated). */
export function Grain() {
  return <div className="grain-layer pointer-events-none fixed inset-0 z-[70] opacity-[0.055] mix-blend-overlay" aria-hidden="true" />;
}

/** A soft light that follows the cursor (desktop only). */
export function CursorLight() {
  const ref = useRef<HTMLDivElement>(null);
  const coarse = useCoarsePointer();
  const reduced = useReducedMotion();
  useEffect(() => {
    if (coarse || reduced) return;
    const el = ref.current;
    if (!el) return;
    let x = window.innerWidth / 2;
    let y = window.innerHeight / 2;
    let cx = x;
    let cy = y;
    let raf = 0;
    const onMove = (e: PointerEvent) => {
      x = e.clientX;
      y = e.clientY;
    };
    const tick = () => {
      cx += (x - cx) * 0.12;
      cy += (y - cy) * 0.12;
      el.style.transform = `translate3d(${cx - 300}px, ${cy - 300}px, 0)`;
      raf = requestAnimationFrame(tick);
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    raf = requestAnimationFrame(tick);
    return () => {
      window.removeEventListener('pointermove', onMove);
      cancelAnimationFrame(raf);
    };
  }, [coarse, reduced]);
  if (coarse || reduced) return null;
  return (
    <div
      ref={ref}
      className="pointer-events-none fixed left-0 top-0 z-[1] size-[600px] rounded-full opacity-[0.07] mix-blend-screen [background:radial-gradient(circle,var(--accent)_0%,transparent_62%)]"
      aria-hidden="true"
    />
  );
}
