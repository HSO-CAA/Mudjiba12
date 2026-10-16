import { useEffect, useRef } from 'react';
import { formatTimecode } from '../lib/format';
import { useReducedMotion } from '../hooks/useMediaQuery';

/** Blinking REC dot + running SMPTE timecode (updates the DOM directly, no React renders). */
export function RecTimecode({ className = '' }: { className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const reduced = useReducedMotion();
  useEffect(() => {
    if (reduced) return;
    const start = performance.now();
    let raf = 0;
    let last = '';
    const tick = () => {
      const tc = formatTimecode((performance.now() - start) / 1000);
      if (tc !== last && ref.current) {
        ref.current.textContent = tc;
        last = tc;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [reduced]);
  return (
    <span className={`hud hud-plate inline-flex items-center gap-2 ${className}`}>
      <span className="rec-dot inline-block size-2 rounded-full bg-rec shadow-[0_0_10px_rgba(255,59,48,0.8)]" aria-hidden="true" />
      <span className="text-danger">REC</span>
      <span ref={ref} className="text-text">
        00:00:00:00
      </span>
    </span>
  );
}
