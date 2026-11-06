import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import type { PublicVideo } from '@s5y/shared';
import { useBootTask } from '../app/loading';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { detectQualityTier, hasWebGL, isQualityForced } from '../lib/device';
import { useReducedMotion, useWideHero } from '../hooks/useMediaQuery';

const HeroScene = lazy(() => import('../3d/HeroScene'));

interface Props {
  videos: PublicVideo[];
  accent: string;
  mark: string;
  /** Holds the render lease: on screen, tab visible, not covered by the cut to black. */
  active: boolean;
  /** Keep the screens' video decoders (released while the hero is off screen; paused whenever it is not `active`). */
  decode: boolean;
  /** WebGL is unavailable or the scene died (context loss / error): the hero switches to its static layout. */
  onUnavailable: () => void;
}

/** The WebGL studio, with a still-beautiful static fallback (no WebGL, errors, context loss, while loading). */
export function HeroStage({ videos, accent, mark, active, decode, onUnavailable }: Props) {
  const [webgl] = useState(() => hasWebGL());
  const [failed, setFailed] = useState(false);
  const [ready, setReady] = useState(false);
  const tier = useMemo(() => detectQualityTier(), []);
  const lockTier = useMemo(() => isQualityForced(), []);
  const compact = !useWideHero();
  const reduced = useReducedMotion();
  const useGL = webgl && !failed;

  useBootTask('scene', ready || !useGL, useGL ? 0.35 : 1);

  const onReady = useCallback(() => setReady(true), []);
  const onFatal = useCallback(() => setFailed(true), []);
  useEffect(() => {
    if (!useGL) onUnavailable();
  }, [useGL, onUnavailable]);
  const fallback = <HeroFallback videos={videos} accent={accent} />;

  if (!useGL) return fallback;
  return (
    <ErrorBoundary fallback={fallback} onError={onFatal}>
      <Suspense fallback={fallback}>
        <div className="absolute inset-0" data-hero-canvas data-tier={tier}>
          <HeroScene
            videos={videos}
            accent={accent}
            mark={mark}
            tier={tier}
            lockTier={lockTier}
            active={active}
            decode={decode}
            compact={compact}
            reducedMotion={reduced}
            onReady={onReady}
            onFatal={onFatal}
          />
        </div>
      </Suspense>
    </ErrorBoundary>
  );
}

/** Poster collage on a soft studio gradient — used without WebGL. */
export function HeroFallback({ videos, accent }: { videos: PublicVideo[]; accent: string }) {
  const items = videos.length ? Array.from({ length: 5 }, (_, i) => videos[i % videos.length] as PublicVideo) : [];
  const slots = items.length ? items : Array.from({ length: 5 }, () => null);
  return (
    <div className="absolute inset-0 overflow-hidden bg-bg" aria-hidden="true">
      <div className="absolute inset-0 bg-[radial-gradient(60%_50%_at_35%_55%,color-mix(in_oklab,var(--accent)_22%,transparent),transparent_70%)]" />
      <div className="absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-bg to-transparent" />
      {/* side-by-side: the row gathers behind the lens on the far side, clear of the copy column (as in 3D) */}
      <div className="absolute inset-y-0 left-0 flex w-full items-center justify-center [perspective:1400px] wide:w-[60%]">
        <div className="relative flex items-center gap-3 [transform-style:preserve-3d] sm:gap-5" style={{ transform: 'rotateX(6deg)' }}>
          {slots.map((v, i) => {
            const offset = i - 2;
            return (
              <div
                key={i}
                className="relative aspect-[9/19] w-[22vw] max-w-[150px] overflow-hidden rounded-[1.1rem] border-[3px] border-[#8e8b86]/70 bg-surface-2 shadow-[0_30px_80px_-20px_rgba(0,0,0,0.9)] sm:w-[13vw] wide:w-[9.5vw] wide:max-w-[130px]"
                style={{
                  transform: `translateZ(${-Math.abs(offset) * 70}px) rotateY(${offset * -14}deg)`,
                  boxShadow: `0 0 80px -30px ${accent}`,
                }}
              >
                {v?.posterUrl ? (
                  <img src={v.posterUrl} alt="" className="h-full w-full object-cover" />
                ) : (
                  <div className="h-full w-full bg-[linear-gradient(160deg,color-mix(in_oklab,var(--accent)_45%,#000),#09090b_70%)]" />
                )}
              </div>
            );
          })}
        </div>
      </div>
      {/* CSS lens */}
      <div className="absolute left-1/2 top-[44%] size-[min(42vw,300px)] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(circle_at_50%_50%,#0c0b16_0%,#16122a_38%,#050507_52%,#1a1a1d_53%,#0d0d0f_66%,var(--accent)_67%,#0d0d0f_69%,#151517_80%,#070708_100%)] shadow-[0_40px_120px_-20px_rgba(0,0,0,0.95),inset_0_0_30px_rgba(255,255,255,0.06)] wide:left-[30%]">
        <span className="absolute left-[30%] top-[28%] h-[10%] w-[18%] rotate-[-30deg] rounded-full bg-white/25 blur-[6px]" />
      </div>
    </div>
  );
}
