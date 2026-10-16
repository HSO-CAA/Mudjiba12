import type { PlaceSummary } from '@s5y/shared';
import { SparkIcon } from '../components/Icons';
import { useReducedMotion } from '../hooks/useMediaQuery';

/** Infinite strip of the places he worked with ("اشتغلت ويا"). */
export function Marquee({ places }: { places: PlaceSummary[] }) {
  const reduced = useReducedMotion();
  if (!places.length) return null;
  const loop = places.length < 6 ? [...places, ...places, ...places] : places;
  const duration = Math.max(28, loop.length * 6);

  const row = (copy: number) => (
    <ul className="flex shrink-0 items-center" aria-hidden={copy > 0 ? 'true' : undefined}>
      {loop.map((p, i) => (
        <li key={`${copy}-${p.id}-${i}`} className="flex items-center gap-6 px-6 sm:gap-10 sm:px-10">
          <span className="flex items-center gap-4">
            {p.logoUrl ? (
              <img src={p.logoUrl} alt="" className="size-10 rounded-full object-cover ring-1 ring-white/10 sm:size-12" loading="lazy" />
            ) : (
              <span className="size-3 rounded-full" style={{ background: p.accentColor }} />
            )}
            <span className="whitespace-nowrap font-display text-[2rem] leading-[1.3] text-text sm:text-5xl sm:leading-[1.3]">{p.name}</span>
          </span>
          <SparkIcon size={18} className="text-accent" />
        </li>
      ))}
    </ul>
  );

  return (
    <section aria-label="أماكن اشتغلت وياها" className="relative border-y border-line bg-surface/40 py-7 sm:py-9">
      <div className="container-cine mb-5 flex items-center gap-3">
        <span className="hud text-accent">CLIENTS</span>
        <span className="h-px w-6 bg-line-strong" aria-hidden="true" />
        <span className="font-ui text-base leading-none text-soft">اشتغلت ويا</span>
      </div>
      <div className="marquee relative overflow-hidden [mask-image:linear-gradient(to_left,transparent,black_8%,black_92%,transparent)]">
        {reduced ? (
          <div className="flex flex-wrap justify-center">{row(0)}</div>
        ) : (
          <div className="marquee-track flex w-max" style={{ ['--marquee-duration' as string]: `${duration}s` }}>
            {row(0)}
            {row(1)}
          </div>
        )}
      </div>
    </section>
  );
}
