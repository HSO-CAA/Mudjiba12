import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { boot, useBoot } from '../app/loading';
import { useSmoothScroll } from '../app/SmoothScroll';

const BLADES = 9;
const HARD_TIMEOUT_MS = 9000;
const MIN_VISIBLE_MS = 900;
const F_STOPS = [16, 11, 8, 5.6, 4, 2.8, 2, 1.4];

function nonagon(cx: number, cy: number, r: number, rot = 0): [number, number][] {
  return Array.from({ length: BLADES }, (_, i) => {
    const a = rot + (i / BLADES) * Math.PI * 2;
    return [cx + Math.cos(a) * r, cy + Math.sin(a) * r];
  });
}

/** Camera-iris icon: blade edges radiate from the nonagon opening to the barrel. */
function Aperture({ open }: { open: number }) {
  const R = 46;
  const a = 4 + open * 30;
  const rot = open * 0.9;
  const pts = nonagon(50, 50, a, rot);
  const lines = pts.map((v, i) => {
    const prev = pts[(i + BLADES - 1) % BLADES] ?? v;
    const dx = v[0] - prev[0];
    const dy = v[1] - prev[1];
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len;
    const uy = dy / len;
    // extend from v along (v - prev) until the outer circle
    const ox = v[0] - 50;
    const oy = v[1] - 50;
    const b = ox * ux + oy * uy;
    const c = ox * ox + oy * oy - R * R;
    const t = -b + Math.sqrt(Math.max(b * b - c, 0));
    return { x1: v[0], y1: v[1], x2: v[0] + ux * t, y2: v[1] + uy * t };
  });
  return (
    <svg viewBox="0 0 100 100" className="h-full w-full" aria-hidden="true">
      <defs>
        <radialGradient id="ld-glass" cx="42%" cy="38%" r="70%">
          <stop offset="0" stopColor="var(--accent)" stopOpacity="0.55" />
          <stop offset="0.5" stopColor="#1b1530" stopOpacity="0.6" />
          <stop offset="1" stopColor="#060607" stopOpacity="0" />
        </radialGradient>
      </defs>
      <circle cx="50" cy="50" r="49" fill="none" stroke="rgb(243 240 234 / 0.14)" strokeWidth="0.6" />
      <circle cx="50" cy="50" r={R} fill="#0b0b0d" stroke="rgb(243 240 234 / 0.3)" strokeWidth="0.5" />
      <polygon points={pts.map((p) => p.join(',')).join(' ')} fill="url(#ld-glass)" />
      {lines.map((l, i) => (
        <line key={i} {...l} stroke="rgb(243 240 234 / 0.42)" strokeWidth="0.45" strokeLinecap="round" />
      ))}
      <polygon points={pts.map((p) => p.join(',')).join(' ')} fill="none" stroke="var(--accent)" strokeOpacity="0.85" strokeWidth="0.5" />
    </svg>
  );
}

/**
 * First-load overlay: the iris opens as the site loads (f/16 → f/1.4), then the frame "opens up"
 * into the studio and the camera dolly starts.
 */
export function Loader() {
  const { progress, ready, dismissed } = useBoot();
  const reduced = useReducedMotion();
  const [shown, setShown] = useState(0);
  const [phase, setPhase] = useState<'loading' | 'opening' | 'gone'>('loading');
  const mountedAt = useRef(performance.now());
  const shownRef = useRef(0);

  // fonts are part of the first paint
  useEffect(() => {
    boot.register('fonts');
    const done = () => boot.complete('fonts');
    if (document.fonts?.ready) document.fonts.ready.then(done, done);
    else done();
    const hard = window.setTimeout(() => boot.dismiss(), HARD_TIMEOUT_MS);
    return () => window.clearTimeout(hard);
  }, []);

  // ease the displayed number towards the real progress
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const target = ready ? 1 : progress * 0.96;
      shownRef.current += (target - shownRef.current) * (ready ? 0.16 : 0.07);
      if (Math.abs(target - shownRef.current) < 0.002) shownRef.current = target;
      setShown(shownRef.current);
      if (shownRef.current < 1 || !ready) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [progress, ready]);

  useEffect(() => {
    if (phase !== 'loading') return;
    if (dismissed || (ready && shown >= 0.999)) {
      const wait = Math.max(0, MIN_VISIBLE_MS - (performance.now() - mountedAt.current));
      const t = window.setTimeout(() => {
        boot.dismiss();
        setPhase('opening');
      }, wait + (reduced ? 0 : 180));
      return () => window.clearTimeout(t);
    }
  }, [ready, shown, dismissed, phase, reduced]);

  // no scrolling underneath the loader
  const { lock, unlock } = useSmoothScroll();
  useEffect(() => {
    if (phase !== 'loading') return;
    lock();
    return unlock;
  }, [phase, lock, unlock]);

  const fIndex = Math.min(F_STOPS.length - 1, Math.floor(shown * (F_STOPS.length - 1) + 0.0001));
  const pct = String(Math.round(shown * 100)).padStart(3, '0');

  return (
    <AnimatePresence>
      {phase !== 'gone' && (
        <motion.div
          key="loader"
          className="fixed inset-0 z-[100] flex items-center justify-center"
          role="progressbar"
          aria-label="جاري تحميل الموقع"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(shown * 100)}
          initial={false}
        >
          {/* backdrop with an iris-shaped hole that grows open */}
          <motion.svg
            className="absolute inset-0 h-full w-full"
            viewBox="0 0 100 100"
            preserveAspectRatio="xMidYMid slice"
            aria-hidden="true"
          >
            <defs>
              <mask id="ld-iris">
                <rect width="100" height="100" fill="white" />
                <motion.polygon
                  points={nonagon(50, 50, 1).map((p) => p.join(',')).join(' ')}
                  fill="black"
                  style={{ transformOrigin: '50px 50px', transformBox: 'view-box' }}
                  initial={{ scale: 0, rotate: 0 }}
                  animate={phase === 'opening' ? { scale: 95, rotate: 40 } : { scale: 0, rotate: 0 }}
                  transition={{ duration: reduced ? 0.2 : 1.25, ease: [0.77, 0, 0.18, 1] }}
                  onAnimationComplete={() => {
                    if (phase === 'opening') setPhase('gone');
                  }}
                />
              </mask>
            </defs>
            <rect width="100" height="100" fill="#060607" mask="url(#ld-iris)" />
          </motion.svg>

          <motion.div
            className="relative flex flex-col items-center gap-7"
            animate={phase === 'opening' ? { opacity: 0, scale: 1.08, filter: 'blur(6px)' } : { opacity: 1, scale: 1, filter: 'blur(0px)' }}
            transition={{ duration: reduced ? 0.15 : 0.45, ease: [0.16, 1, 0.3, 1] }}
          >
            <div className="viewfinder relative size-[min(46vw,13rem)] p-4">
              <Aperture open={shown} />
            </div>
            <div className="flex flex-col items-center gap-3">
              <div className="hud flex items-center gap-3 text-text">
                <span className="rec-dot inline-block size-1.5 rounded-full bg-rec" />
                <span>FOCUS {pct}%</span>
                <span className="text-muted">·</span>
                <span className="text-accent">ƒ/{F_STOPS[fIndex]}</span>
              </div>
              <div className="h-px w-44 overflow-hidden bg-line">
                <div className="h-full origin-right bg-accent" style={{ transform: `scaleX(${shown})` }} />
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
