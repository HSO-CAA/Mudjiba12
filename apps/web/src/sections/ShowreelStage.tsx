import { lazy, Suspense, useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { motion, useMotionValueEvent } from 'motion/react';
import type { PublicVideo } from '@s5y/shared';
import { useRenderLease } from '../3d/renderLease';
import { SHOWREEL_PER_REEL, detent, progressForReel, reelAt, showreelState } from '../3d/showreelState';
import { useSmoothScroll } from '../app/SmoothScroll';
import { Button } from '../components/Button';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { ChevronLeftIcon, ChevronRightIcon, PlayIcon } from '../components/Icons';
import { useInView } from '../hooks/useInView';
import { useWideHero } from '../hooks/useMediaQuery';
import { usePageVisible } from '../hooks/usePageVisible';
import { useScrollTimeline } from '../hooks/useScrollTimeline';
import type { QualityTier } from '../lib/device';
import { formatDuration, pad2 } from '../lib/format';
import { usePlayer, type PlayerPlaceRef } from '../player/PlayerProvider';

const ShowreelScene = lazy(() => import('../3d/ShowreelScene'));
const EASE = [0.16, 1, 0.3, 1] as const;

interface Props {
  videos: PublicVideo[];
  placeMap: Record<string, PlayerPlaceRef>;
  accent: string;
  tier: QualityTier;
  lockTier: boolean;
  /** The WebGL scene failed: the section falls back to the 2D row. */
  onUnavailable: () => void;
}

/**
 * Pinned, scroll-driven showreel: the featured reels ride a 3D helix that turns one reel to the front per
 * scroll step. The reel in front plays its preview and its title sits on a solid panel; the arrows, the
 * keyboard and the numbered list below it jump straight to any reel, and Play opens the full player.
 */
export function ShowreelStage({ videos, placeMap, accent, tier, lockTier, onUnavailable }: Props) {
  const runway = useRef<HTMLDivElement>(null);
  const n = videos.length;
  const wide = useWideHero();
  const { progress, scrollYAt } = useScrollTimeline(runway, 'contain');
  const { scrollTo } = useSmoothScroll();
  const { open, isOpen } = usePlayer();
  const [current, setCurrent] = useState(0);
  const tcRef = useRef<HTMLSpanElement>(null);

  const sync = useCallback(
    (v: number) => {
      const x = reelAt(v, n);
      showreelState.target = detent(x);
      setCurrent(Math.min(n - 1, Math.max(0, Math.round(x))));
      if (tcRef.current) tcRef.current.textContent = `${Math.round(v * 100)}%`;
    },
    [n],
  );
  useMotionValueEvent(progress, 'change', sync);
  useEffect(() => sync(progress.get()), [progress, sync]);

  // Mount the scene a viewport ahead, drop it (GPU memory, decoders) once it is far behind.
  const inView = useInView(runway);
  const near = useInView(runway, { rootMargin: '120% 0px' });
  const within = useInView(runway, { rootMargin: '260% 0px' });
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    if (near) setMounted(true);
    else if (!within) setMounted(false);
  }, [near, within]);
  const visible = usePageVisible();
  const active = useRenderLease('showreel', inView && visible && !isOpen);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (!mounted) setReady(false);
  }, [mounted]);

  const go = useCallback(
    (i: number) => {
      const target = Math.min(n - 1, Math.max(0, i));
      scrollTo(scrollYAt(progressForReel(target, n)));
    },
    [n, scrollTo, scrollYAt],
  );
  const openAt = useCallback((i: number) => open({ videos, index: i, places: placeMap }), [open, videos, placeMap]);
  const onReady = useCallback(() => setReady(true), []);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    // RTL: the next reel is to the left
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      go(current + 1);
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      go(current - 1);
    } else if (e.key === 'Home') {
      e.preventDefault();
      go(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      go(n - 1);
    } else if ((e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) {
      e.preventDefault();
      openAt(current);
    }
  };

  const video = videos[current] as PublicVideo;
  const place = placeMap[video.placeId];
  const title = video.title || place?.name || 'ريل';
  const perReel = wide ? SHOWREEL_PER_REEL.wide : SHOWREEL_PER_REEL.compact;

  return (
    <div ref={runway} data-showreel-runway className="relative" style={{ height: `${100 + n * perReel}svh` }}>
      <div
        className="sticky top-0 h-[100svh] overflow-hidden outline-none focus-visible:outline-2 focus-visible:-outline-offset-4 focus-visible:outline-accent"
        role="region"
        aria-roledescription="عرض دوّار"
        aria-label="ريلز مختارة — انزل أو استخدم الأسهم للتنقل، و Enter للتشغيل"
        tabIndex={0}
        onKeyDown={onKeyDown}
      >
        <StageFallback video={video} />
        {mounted && (
          <ErrorBoundary fallback={null} onError={onUnavailable}>
            <Suspense fallback={null}>
              <div className={`absolute inset-0 transition-opacity duration-700 ${ready ? 'opacity-100' : 'opacity-0'}`}>
                <ShowreelScene
                  videos={videos}
                  accent={accent}
                  tier={tier}
                  lockTier={lockTier}
                  active={active}
                  compact={!wide}
                  onOpen={openAt}
                  onSelect={go}
                  onReady={onReady}
                />
              </div>
            </Suspense>
          </ErrorBoundary>
        )}

        {/* scrims: every line of text below sits on one of these or on the solid panel */}
        <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 h-40 bg-gradient-to-b from-bg via-bg/60 to-transparent" />
        <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-0 h-[46%] bg-[linear-gradient(to_top,rgba(6,6,7,0.96)_10%,rgba(6,6,7,0.6)_55%,transparent)] wide:hidden" />
        <div aria-hidden="true" className="pointer-events-none absolute inset-y-0 right-0 hidden w-[52%] bg-[linear-gradient(to_left,rgba(6,6,7,0.92),rgba(6,6,7,0.5)_55%,transparent)] wide:block" />

        {/* HUD */}
        <div aria-hidden="true" className="pointer-events-none absolute inset-x-4 bottom-4 top-[calc(var(--header-h)+0.5rem)] sm:inset-x-6 sm:bottom-6">
          <div className="viewfinder absolute inset-0 opacity-60 [--vf-size:20px]" />
          <div className="absolute inset-x-4 top-4 flex items-start justify-between gap-4 sm:inset-x-5 sm:top-5">
            <span className="hud flex items-center gap-2 text-soft">
              <span className="rec-dot inline-block size-1.5 rounded-full bg-rec" /> SHOWREEL · TAKE {pad2(current + 1)}
            </span>
            <span className="hud hidden text-soft sm:inline">
              SCROLL · ← → · <span ref={tcRef} className="text-text">0%</span>
            </span>
          </div>
        </div>

        {/* title panel */}
        <div className="absolute inset-x-4 bottom-[max(1rem,env(safe-area-inset-bottom))] wide:inset-x-auto wide:bottom-auto wide:right-[max(var(--gutter),2.5rem)] wide:top-1/2 wide:w-[min(27rem,36vw)] wide:-translate-y-1/2">
          <div className="rounded-[1.6rem] bg-bg/85 p-5 shadow-[0_30px_80px_-30px_rgba(0,0,0,0.95)] ring-1 ring-white/10 sm:p-7">
            <p className="hud text-accent">
              REEL {pad2(current + 1)} / {pad2(n)} · {formatDuration(video.durationSec)}
            </p>
            <div aria-live="polite" className="mt-3 min-h-[4.6rem] sm:min-h-[5.6rem]">
              {/* keyed enter-only fade: scrubbing fast never leaves the panel empty mid-exit */}
              <motion.div key={video.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35, ease: EASE }}>
                <h3 className="line-clamp-2 font-display text-[clamp(1.75rem,3vw,2.4rem)] leading-[1.3] text-text">{title}</h3>
                {place && video.title && <p className="mt-1.5 text-base text-soft">{place.name}</p>}
              </motion.div>
            </div>
            <div className="mt-5 flex items-center gap-2.5">
              <Button onClick={() => openAt(current)} icon={<PlayIcon size={16} />} className="flex-1 whitespace-nowrap sm:flex-none">
                شغّل الريل
              </Button>
              <button
                type="button"
                onClick={() => go(current - 1)}
                disabled={current === 0}
                className="grid size-11 shrink-0 place-items-center rounded-full border border-line-strong text-text transition hover:border-accent hover:text-accent disabled:opacity-40"
                aria-label="الريل السابق"
              >
                <ChevronRightIcon size={20} />
              </button>
              <button
                type="button"
                onClick={() => go(current + 1)}
                disabled={current === n - 1}
                className="grid size-11 shrink-0 place-items-center rounded-full border border-line-strong text-text transition hover:border-accent hover:text-accent disabled:opacity-40"
                aria-label="الريل التالي"
              >
                <ChevronLeftIcon size={20} />
              </button>
            </div>
            {/* every reel, in order — the accessible list behind the 3D (and a quick jump for everyone) */}
            <ol aria-label="كل الريلز المختارة" className="mt-5 flex gap-1">
              {videos.map((v, i) => (
                <li key={v.id} className="flex-1">
                  <button
                    type="button"
                    onClick={() => go(i)}
                    aria-current={i === current ? 'true' : undefined}
                    aria-label={`${pad2(i + 1)}: ${v.title || placeMap[v.placeId]?.name || 'ريل'}`}
                    className="group/tick flex h-7 w-full items-center"
                  >
                    <span
                      className={`block h-[3px] w-full rounded-full transition-colors duration-300 ${
                        i === current ? 'bg-accent' : 'bg-white/25 group-hover/tick:bg-white/55'
                      }`}
                    />
                  </button>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Static frame while the scene loads (or when it is unmounted far away): the current reel's poster in a phone. */
function StageFallback({ video }: { video: PublicVideo }) {
  return (
    <div aria-hidden="true" className="absolute inset-0 overflow-hidden bg-bg">
      <div className="absolute inset-0 bg-[radial-gradient(45%_45%_at_50%_42%,color-mix(in_oklab,var(--accent)_16%,transparent),transparent_70%)] wide:bg-[radial-gradient(40%_55%_at_34%_50%,color-mix(in_oklab,var(--accent)_16%,transparent),transparent_70%)]" />
      <div className="absolute left-1/2 top-[38%] aspect-[9/19] w-[min(46vw,15rem)] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-[1.6rem] border-[3px] border-[#8e8b86]/70 bg-surface-2 shadow-[0_40px_90px_-30px_rgba(0,0,0,0.95)] wide:left-[34%] wide:top-1/2 wide:w-[min(18vw,15rem)]">
        {video.posterUrl && <img src={video.posterUrl} alt="" className="h-full w-full object-cover" />}
      </div>
    </div>
  );
}
