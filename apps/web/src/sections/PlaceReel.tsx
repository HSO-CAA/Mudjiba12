import { lazy, Suspense, useCallback, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent, type WheelEvent } from 'react';
import type { PublicVideo } from '@s5y/shared';
import { createCarouselController } from '../3d/carouselController';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { ChevronLeftIcon, ChevronRightIcon, PlayIcon } from '../components/Icons';
import { VideoCard } from '../components/VideoCard';
import { useInView } from '../hooks/useInView';
import { useIsMobile, useReducedMotion } from '../hooks/useMediaQuery';
import { usePageVisible } from '../hooks/usePageVisible';
import { detectQualityTier, hasWebGL, isQualityForced } from '../lib/device';
import { formatDuration, pad2 } from '../lib/format';

const ReelCarouselScene = lazy(() => import('../3d/ReelCarouselScene'));
const noop = () => undefined;

interface Props {
  videos: PublicVideo[];
  accent: string;
  placeName: string;
  onOpen: (index: number) => void;
}

/** 3D cylinder of the place's reels (drag / wheel / arrows / keyboard); 2D swipe carousel on low tier. */
export function PlaceReel({ videos, accent, placeName, onOpen }: Props) {
  const tier = useMemo(() => detectQualityTier(), []);
  const lockTier = useMemo(() => isQualityForced(), []);
  const [webgl] = useState(() => hasWebGL());
  const [failed, setFailed] = useState(false);
  const use3D = webgl && !failed && tier !== 'low';

  if (!videos.length) return null;
  return use3D ? (
    <ErrorBoundary fallback={<Reel2D videos={videos} placeName={placeName} onOpen={onOpen} />} onError={() => setFailed(true)}>
      <Reel3D videos={videos} accent={accent} placeName={placeName} onOpen={onOpen} tier={tier} lockTier={lockTier} />
    </ErrorBoundary>
  ) : (
    <Reel2D videos={videos} placeName={placeName} onOpen={onOpen} />
  );
}

function Reel3D({ videos, accent, placeName, onOpen, tier, lockTier }: Props & { tier: ReturnType<typeof detectQualityTier>; lockTier: boolean }) {
  const wrap = useRef<HTMLDivElement>(null);
  const controller = useMemo(() => createCarouselController(), []);
  const [front, setFront] = useState(0);
  const drag = useRef<{ x: number; rot: number; lastX: number; lastT: number; moved: boolean } | null>(null);
  const inView = useInView(wrap, { rootMargin: '100px 0px' });
  const visible = usePageVisible();
  const reduced = useReducedMotion();
  const compact = useIsMobile();

  const current = videos[front] as PublicVideo;

  const goBy = useCallback(
    (delta: number) => {
      const slot = Math.round(-controller.rotation / controller.step);
      controller.target = slot + delta;
      controller.lastInteraction = performance.now();
    },
    [controller],
  );

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    controller.dragging = true;
    controller.dragMoved = false;
    controller.target = null;
    controller.lastInteraction = performance.now();
    drag.current = { x: e.clientX, rot: controller.rotation, lastX: e.clientX, lastT: performance.now(), moved: false };
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x;
    if (Math.abs(dx) > 4) {
      d.moved = true;
      controller.dragMoved = true;
    }
    const now = performance.now();
    const dt = Math.max(1, now - d.lastT) / 1000;
    controller.velocity = ((e.clientX - d.lastX) * 0.006) / dt;
    controller.rotation = d.rot + dx * 0.006;
    d.lastX = e.clientX;
    d.lastT = now;
    controller.lastInteraction = now;
  };
  const endDrag = () => {
    controller.dragging = false;
    if (drag.current && !drag.current.moved) controller.velocity = 0;
    controller.velocity = Math.max(-4, Math.min(4, controller.velocity));
    drag.current = null;
  };
  const onWheel = (e: WheelEvent<HTMLDivElement>) => {
    const horizontal = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.shiftKey ? e.deltaY : 0;
    if (!horizontal) return;
    controller.target = null;
    controller.rotation -= horizontal * 0.0025;
    controller.velocity = 0;
    controller.lastInteraction = performance.now();
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      goBy(1);
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      goBy(-1);
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onOpen(front);
    }
  };

  return (
    <div className="relative">
      <div
        ref={wrap}
        role="group"
        aria-roledescription="عرض دوّار"
        aria-label={`فيديوهات ${placeName} — استخدم الأسهم للتنقل و Enter للتشغيل`}
        tabIndex={0}
        className="relative h-[min(78svh,44rem)] min-h-[28rem] cursor-grab touch-pan-y overflow-hidden rounded-[2rem] border border-line bg-bg active:cursor-grabbing"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onPointerLeave={endDrag}
        onWheel={onWheel}
        onKeyDown={onKeyDown}
      >
        <Suspense fallback={<div className="skeleton absolute inset-0" />}>
          <ReelCarouselScene
            videos={videos}
            accent={accent}
            tier={tier}
            lockTier={lockTier}
            active={inView && visible}
            reducedMotion={reduced}
            compact={compact}
            controller={controller}
            onFrontChange={setFront}
            onOpen={onOpen}
            onReady={noop}
          />
        </Suspense>
        <div aria-hidden="true" className="viewfinder pointer-events-none absolute inset-5 opacity-50" />
        <div className="pointer-events-none absolute inset-x-8 top-8 flex items-center justify-between">
          <span className="hud hud-plate flex items-center gap-2 text-text">
            <span className="rec-dot inline-block size-1.5 rounded-full bg-rec" /> REEL {pad2(front + 1)} / {pad2(videos.length)}
          </span>
          <span className="hud hud-plate hidden text-soft sm:inline">DRAG · WHEEL · ← →</span>
        </div>
      </div>

      <div className="mt-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0" aria-live="polite">
          <p className="truncate pb-1 font-ui text-[1.3125rem] font-bold leading-[1.4]">{current?.title || placeName}</p>
          <p className="hud mt-1.5 text-muted">
            {pad2(front + 1)} / {pad2(videos.length)} · {formatDuration(current?.durationSec)}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => goBy(-1)} className="grid size-12 place-items-center rounded-full border border-line-strong transition hover:border-accent hover:text-accent" aria-label="الفيديو السابق">
            <ChevronRightIcon size={22} />
          </button>
          <button
            type="button"
            onClick={() => onOpen(front)}
            className="inline-flex h-12 items-center gap-2 rounded-full bg-accent px-6 font-ui text-base font-bold leading-none text-[var(--accent-ink)] transition hover:brightness-110"
          >
            <PlayIcon size={16} /> شغّل الفيديو
          </button>
          <button type="button" onClick={() => goBy(1)} className="grid size-12 place-items-center rounded-full border border-line-strong transition hover:border-accent hover:text-accent" aria-label="الفيديو التالي">
            <ChevronLeftIcon size={22} />
          </button>
        </div>
      </div>
    </div>
  );
}

function Reel2D({ videos, placeName, onOpen }: Omit<Props, 'accent'>) {
  return (
    <div role="group" aria-roledescription="عرض متحرك" aria-label={`فيديوهات ${placeName}`}>
      <ul className="scrollbar-none -mx-[var(--gutter)] flex snap-x snap-mandatory gap-4 overflow-x-auto px-[var(--gutter)] pb-4 [scroll-padding-inline:var(--gutter)]">
        {videos.map((v, i) => (
          <li key={v.id} className="w-[min(70vw,18rem)] shrink-0 snap-center">
            <VideoCard video={v} index={i} caption={placeName} autoplayInView onOpen={() => onOpen(i)} />
          </li>
        ))}
      </ul>
      <p className="mt-3 flex items-center justify-center gap-2 text-muted">
        <span className="hud">SWIPE</span>
        <span aria-hidden="true">·</span>
        <span className="font-ui text-[0.9375rem] leading-none text-soft">اسحب للتنقل</span>
      </p>
    </div>
  );
}
