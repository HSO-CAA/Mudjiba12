import { useRef, useState } from 'react';
import type { PublicVideo } from '@s5y/shared';
import { formatCompact, formatDuration } from '../lib/format';
import { useCoarsePointer } from '../hooks/useMediaQuery';
import { useInView } from '../hooks/useInView';
import { FadeImage, PreviewVideo } from './Media';
import { PlayIcon } from './Icons';

interface Props {
  video: PublicVideo;
  caption?: string | null;
  onOpen: () => void;
  /** Autoplay the muted preview whenever the card is in view (showreel). */
  autoplayInView?: boolean;
  className?: string;
  index?: number;
}

/** Vertical reel card: poster, duration badge, muted preview on hover / in view. */
export function VideoCard({ video, caption, onOpen, autoplayInView = false, className = '', index }: Props) {
  const ref = useRef<HTMLButtonElement>(null);
  const [hover, setHover] = useState(false);
  const coarse = useCoarsePointer();
  const inView = useInView(ref, { threshold: 0.6 });
  const active = autoplayInView || coarse ? inView || hover : hover;
  const label = video.title || caption || 'فيديو';

  return (
    <button
      ref={ref}
      type="button"
      onClick={onOpen}
      onPointerEnter={() => setHover(true)}
      onPointerLeave={() => setHover(false)}
      onFocus={() => setHover(true)}
      onBlur={() => setHover(false)}
      className={`group relative block aspect-[9/16] w-full overflow-hidden rounded-[1.25rem] bg-surface-2 text-start ring-1 ring-white/[0.07] transition-[box-shadow,transform] duration-500 hover:-translate-y-1 hover:shadow-[0_30px_70px_-30px_var(--accent)] ${className}`}
      aria-label={`تشغيل: ${label}${caption && video.title ? ` — ${caption}` : ''}`}
    >
      {video.posterUrl ? (
        <FadeImage src={video.posterUrl} alt="" className="absolute inset-0 h-full w-full object-cover transition-transform duration-[1.2s] group-hover:scale-[1.04]" />
      ) : (
        <div className="absolute inset-0 bg-[linear-gradient(160deg,color-mix(in_oklab,var(--accent)_35%,#000),#0b0b0d_70%)]" />
      )}
      <PreviewVideo src={video.previewUrl} poster={video.posterUrl} active={active} className="absolute inset-0 h-full w-full object-cover" />
      <div className="absolute inset-0 bg-[linear-gradient(to_top,rgba(6,6,7,0.92)_4%,rgba(6,6,7,0.25)_40%,transparent_62%,rgba(6,6,7,0.4))]" />
      <div aria-hidden="true" className="viewfinder absolute inset-3 opacity-0 transition-opacity duration-500 [--vf-size:14px] group-hover:opacity-80" />

      <div className="absolute inset-x-3 top-3 flex items-center justify-between">
        {typeof index === 'number' ? <span className="hud text-text/70">{String(index + 1).padStart(2, '0')}</span> : <span />}
        <span className="hud rounded-full bg-black/55 px-2 py-1 text-text/90 backdrop-blur">{formatDuration(video.durationSec)}</span>
      </div>

      <span
        aria-hidden="true"
        className="absolute left-1/2 top-1/2 grid size-14 -translate-x-1/2 -translate-y-1/2 scale-90 place-items-center rounded-full bg-white/15 text-text opacity-0 ring-1 ring-white/25 backdrop-blur-md transition-all duration-500 group-hover:scale-100 group-hover:opacity-100"
      >
        <PlayIcon size={22} />
      </span>

      <div className="absolute inset-x-4 bottom-4">
        <p className="line-clamp-2 font-display text-[1.05rem] font-bold leading-snug">{label}</p>
        <p className="mt-1 flex items-center gap-2 text-xs text-text/65">
          {caption && video.title && <span className="truncate">{caption}</span>}
          {video.plays > 0 && (
            <>
              {caption && video.title && <span className="size-0.5 rounded-full bg-text/50" aria-hidden="true" />}
              <span className="whitespace-nowrap">{formatCompact(video.plays)} مشاهدة</span>
            </>
          )}
        </p>
      </div>
    </button>
  );
}
