import { useMemo, useRef, useState } from 'react';
import type { PlaceSummary, PublicVideo } from '@s5y/shared';
import { useHome } from '../api/queries';
import { ChevronLeftIcon, ChevronRightIcon } from '../components/Icons';
import { SectionHeading } from '../components/SectionHeading';
import { VideoCard } from '../components/VideoCard';
import { useReducedMotion } from '../hooks/useMediaQuery';
import { safeColor } from '../lib/color';
import { detectQualityTier, hasWebGL, isQualityForced } from '../lib/device';
import { usePlayer, type PlayerPlaceRef } from '../player/PlayerProvider';
import { ShowreelStage } from './ShowreelStage';

/** The 3D helix needs a few reels to read as one; fewer stay in the row. */
const MIN_REELS_3D = 3;

/**
 * Featured reels. Capable devices get the pinned, scroll-driven 3D helix (ShowreelStage); low tier, reduced
 * motion, no WebGL (or a scene failure) keep the horizontal, drag-scrollable row of cards.
 */
export function Showreel({ videos, places, index, total }: { videos: PublicVideo[]; places: PlaceSummary[]; index: number; total: number }) {
  const accent = safeColor(useHome().data?.site.brand.accent);
  const placeMap = useMemo<Record<string, PlayerPlaceRef>>(() => Object.fromEntries(places.map((p) => [p.id, { name: p.name, slug: p.slug }])), [places]);
  const tier = useMemo(() => detectQualityTier(), []);
  const lockTier = useMemo(() => isQualityForced(), []);
  const [webgl] = useState(() => hasWebGL());
  const [failed, setFailed] = useState(false);
  const reduced = useReducedMotion();
  const use3D = webgl && !failed && !reduced && tier !== 'low' && videos.length >= MIN_REELS_3D;

  if (!videos.length) return null;
  if (!use3D) return <ShowreelRow videos={videos} placeMap={placeMap} index={index} total={total} />;

  return (
    <section id="showreel" aria-labelledby="showreel-title" className="relative scroll-mt-24 pt-24 sm:pt-32">
      <div className="container-cine relative">
        <SectionHeading
          id="showreel"
          index={index}
          total={total}
          code="SHOWREEL"
          kicker="مختارات"
          title="ريلز مختارة"
          description="انزل وخلّي الريلز تدور قدامك — اضغط على أي ريل حتى تشوفه بجودة كاملة وبالصوت."
        />
      </div>
      <ShowreelStage
        videos={videos}
        placeMap={placeMap}
        accent={accent}
        tier={tier}
        lockTier={lockTier}
        onUnavailable={() => setFailed(true)}
      />
    </section>
  );
}

/** Horizontal, drag-scrollable strip of featured reels; each autoplays muted in view. */
function ShowreelRow({ videos, placeMap, index, total }: { videos: PublicVideo[]; placeMap: Record<string, PlayerPlaceRef>; index: number; total: number }) {
  const scroller = useRef<HTMLUListElement>(null);
  const drag = useRef<{ x: number; left: number; moved: boolean } | null>(null);
  const [dragging, setDragging] = useState(false);
  const { open } = usePlayer();

  const scrollByCard = (dir: 1 | -1) => {
    const el = scroller.current;
    if (!el) return;
    const card = el.querySelector('li');
    const step = (card?.getBoundingClientRect().width ?? 280) + 20;
    // RTL: "next" moves towards the left (negative scrollLeft)
    el.scrollBy({ left: -dir * step, behavior: 'smooth' });
  };

  return (
    <section id="showreel" aria-labelledby="showreel-title" className="relative scroll-mt-24 overflow-hidden py-24 sm:py-32">
      <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-1/3 h-2/3 bg-[radial-gradient(50%_50%_at_50%_50%,color-mix(in_oklab,var(--accent)_8%,transparent),transparent)]" />
      <div className="container-cine relative">
        <SectionHeading
          id="showreel"
          index={index}
          total={total}
          code="SHOWREEL"
          kicker="مختارات"
          title="ريلز مختارة"
          description="لقطات من شغل مختلف الأماكن — اضغط على أي ريل حتى تشوفه بجودة كاملة وبالصوت."
          aside={
            <div className="hidden gap-2 sm:flex">
              <button
                type="button"
                onClick={() => scrollByCard(-1)}
                className="grid size-12 place-items-center rounded-full border border-line-strong transition hover:border-accent hover:text-accent"
                aria-label="السابق"
              >
                <ChevronRightIcon size={22} />
              </button>
              <button
                type="button"
                onClick={() => scrollByCard(1)}
                className="grid size-12 place-items-center rounded-full border border-line-strong transition hover:border-accent hover:text-accent"
                aria-label="التالي"
              >
                <ChevronLeftIcon size={22} />
              </button>
            </div>
          }
        />
      </div>
      <ul
        ref={scroller}
        className={`scrollbar-none relative flex snap-x snap-mandatory gap-5 overflow-x-auto px-[var(--gutter)] pb-6 [scroll-padding-inline:var(--gutter)] ${
          dragging ? 'cursor-grabbing snap-none select-none' : 'cursor-grab'
        }`}
        onPointerDown={(e) => {
          if (e.pointerType !== 'mouse' || !scroller.current) return;
          drag.current = { x: e.clientX, left: scroller.current.scrollLeft, moved: false };
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d || !scroller.current) return;
          const dx = e.clientX - d.x;
          if (!d.moved && Math.abs(dx) > 6) {
            d.moved = true;
            setDragging(true);
            scroller.current.setPointerCapture(e.pointerId);
          }
          if (d.moved) scroller.current.scrollLeft = d.left - dx;
        }}
        onPointerUp={(e) => {
          if (scroller.current?.hasPointerCapture(e.pointerId)) scroller.current.releasePointerCapture(e.pointerId);
          window.setTimeout(() => {
            drag.current = null;
            setDragging(false);
          }, 0);
        }}
        onClickCapture={(e) => {
          if (drag.current?.moved) {
            e.preventDefault();
            e.stopPropagation();
          }
        }}
      >
        {videos.map((video, i) => (
          <li key={video.id} className="w-[min(68vw,17.5rem)] shrink-0 snap-start sm:w-[17.5rem]">
            <VideoCard
              video={video}
              index={i}
              caption={placeMap[video.placeId]?.name}
              autoplayInView
              onOpen={() => open({ videos, index: i, places: placeMap })}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}
