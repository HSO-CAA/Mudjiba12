import { useRef, useState } from 'react';
import { Link } from 'react-router';
import { motion, useMotionTemplate, useMotionValue, useReducedMotion, useSpring } from 'motion/react';
import type { PlaceSummary } from '@s5y/shared';
import { pad2, videosLabel } from '../lib/format';
import { placeAccentVars } from '../lib/color';
import { useCoarsePointer } from '../hooks/useMediaQuery';
import { useInView } from '../hooks/useInView';
import { FadeImage, PreviewVideo } from './Media';
import { ArrowUpLeftIcon, MapPinIcon } from './Icons';

interface Props {
  place: PlaceSummary;
  index: number;
  className?: string;
}

/** Cinematic place card: pointer-driven 3D tilt, glare, accent glow and a muted preview on hover. */
export function PlaceCard({ place, index, className = '' }: Props) {
  const ref = useRef<HTMLAnchorElement>(null);
  const reduced = useReducedMotion();
  const coarse = useCoarsePointer();
  const [hover, setHover] = useState(false);
  // touch devices: preview plays while the card sits in the middle of the viewport
  const centred = useInView(ref, { rootMargin: '-38% 0px -38% 0px' });
  const active = coarse ? centred : hover;

  const rx = useMotionValue(0);
  const ry = useMotionValue(0);
  const gx = useMotionValue(50);
  const gy = useMotionValue(50);
  const srx = useSpring(rx, { stiffness: 160, damping: 18 });
  const sry = useSpring(ry, { stiffness: 160, damping: 18 });
  const glare = useMotionTemplate`radial-gradient(520px circle at ${gx}% ${gy}%, rgba(255,255,255,0.14), transparent 45%)`;
  const tilt = !reduced && !coarse;

  const preview = place.previews.find((v) => v.previewUrl) ?? place.previews[0];
  const cover = place.coverUrl ?? place.previews[0]?.posterUrl ?? null;

  return (
    <div className={`[perspective:1200px] ${className}`}>
      <motion.div style={tilt ? { rotateX: srx, rotateY: sry, transformStyle: 'preserve-3d' } : undefined} className="h-full">
        <Link
          ref={ref}
          to={`/work/${place.slug}`}
          className="group relative block h-full min-h-[24rem] overflow-hidden rounded-[1.6rem] bg-surface ring-1 ring-white/[0.07] transition-shadow duration-700 focus-visible:outline-offset-4"
          style={{ ...placeAccentVars(place.accentColor), boxShadow: active ? `0 30px 90px -40px ${place.accentColor}` : undefined }}
          onPointerEnter={() => setHover(true)}
          onPointerLeave={() => {
            setHover(false);
            rx.set(0);
            ry.set(0);
          }}
          onPointerMove={(e) => {
            if (!tilt || !ref.current) return;
            const r = ref.current.getBoundingClientRect();
            const px = (e.clientX - r.left) / r.width;
            const py = (e.clientY - r.top) / r.height;
            ry.set((px - 0.5) * 10);
            rx.set((0.5 - py) * 8);
            gx.set(px * 100);
            gy.set(py * 100);
          }}
          onFocus={() => setHover(true)}
          onBlur={() => setHover(false)}
          aria-label={`${place.name}${place.category ? ` — ${place.category}` : ''}`}
        >
          {/* media */}
          <div className="absolute inset-0">
            {cover ? (
              <FadeImage
                src={cover}
                alt=""
                className={`h-full w-full object-cover ${active ? 'scale-[1.03]' : 'scale-[1.08]'} duration-[1.2s]`}
              />
            ) : (
              <div className="h-full w-full bg-[linear-gradient(150deg,color-mix(in_oklab,var(--place-accent)_40%,#000),#0b0b0d_75%)]" />
            )}
            <PreviewVideo
              src={preview?.previewUrl}
              poster={preview?.posterUrl}
              active={active}
              className="absolute inset-0 h-full w-full object-cover"
            />
            <div className="absolute inset-0 bg-[linear-gradient(to_top,rgba(6,6,7,0.97)_0%,rgba(6,6,7,0.92)_44%,rgba(6,6,7,0.55)_66%,rgba(6,6,7,0.1)_82%,rgba(6,6,7,0.5))]" />
            <div className="absolute inset-0 opacity-0 transition-opacity duration-700 group-hover:opacity-100 bg-[radial-gradient(90%_60%_at_50%_110%,color-mix(in_oklab,var(--place-accent)_45%,transparent),transparent_70%)]" />
            {tilt && <motion.div className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-500 group-hover:opacity-100" style={{ background: glare }} />}
          </div>

          {/* safe-area guides */}
          <div
            aria-hidden="true"
            className={`viewfinder pointer-events-none absolute inset-5 transition-opacity duration-500 [--vf-c:rgba(243,240,234,0.75)] ${active ? 'opacity-100' : 'opacity-0'}`}
          />

          {/* top row */}
          <div className="relative flex items-start justify-between p-6 sm:p-7">
            <div className="flex items-center gap-3">
              {place.logoUrl ? (
                <img src={place.logoUrl} alt="" className="size-12 rounded-full bg-black/40 object-cover ring-1 ring-white/15 backdrop-blur" loading="lazy" />
              ) : (
                <span className="grid size-12 place-items-center rounded-full bg-black/40 font-display text-lg font-bold ring-1 ring-white/15">
                  {place.name.slice(0, 1)}
                </span>
              )}
              <span className="rounded-full bg-bg/75 px-3.5 py-2 font-display text-base leading-none text-text ring-1 ring-white/10 backdrop-blur">
                {videosLabel(place.videoCount)}
              </span>
            </div>
            <span className="hud hud-plate text-text">
              {pad2(index + 1)}
              {place.year ? <span className="text-soft"> · {place.year}</span> : null}
            </span>
          </div>

          {/* bottom */}
          <div className="absolute inset-x-0 bottom-0 p-6 sm:p-7">
            <div className="text-on-media mb-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[0.9375rem] text-text">
              {place.category && (
                <span className="flex items-center gap-2">
                  <span className="size-1.5 rounded-full" style={{ background: place.accentColor }} aria-hidden="true" />
                  {place.category}
                </span>
              )}
              {place.location && (
                <span className="flex items-center gap-1.5">
                  <MapPinIcon size={15} className="text-place" />
                  {place.location}
                </span>
              )}
            </div>
            <div className="flex items-end justify-between gap-4">
              <h3 className="text-on-media font-display text-[clamp(1.9rem,3.4vw,2.8rem)] leading-[1.2]">{place.name}</h3>
              <span
                className="grid size-12 shrink-0 translate-y-1 place-items-center rounded-full bg-bg/60 text-text ring-1 ring-white/20 backdrop-blur transition-all duration-500 group-hover:bg-[var(--place-accent)] group-hover:text-[var(--place-ink)]"
                aria-hidden="true"
              >
                <ArrowUpLeftIcon size={20} />
              </span>
            </div>
            {place.summary && (
              <p className="text-on-media mt-3 line-clamp-2 max-w-md text-[0.9375rem] leading-7 text-soft transition-colors duration-500 group-hover:text-text">
                {place.summary}
              </p>
            )}
          </div>
        </Link>
      </motion.div>
    </div>
  );
}
