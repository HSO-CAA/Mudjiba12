import type { PublicSite } from '@s5y/shared';
import { Counter } from '../components/Counter';
import { FadeImage } from '../components/Media';
import { CalendarIcon, MapPinIcon } from '../components/Icons';
import { Reveal } from '../components/Reveal';
import { SectionHeading } from '../components/SectionHeading';
import { formatYear, numeralsFor, yearsLabel, yearsSince } from '../lib/format';

export function About({ site, index, total }: { site: PublicSite; index: number; total: number }) {
  const { about, brand } = site;
  const years = yearsSince(about.since);
  const stats = site.stats.length
    ? site.stats
    : [
        { label: 'مكان', value: site.counts.places },
        { label: 'فيديو', value: site.counts.videos },
        { label: 'مشاهدة', value: site.counts.plays },
      ];
  const paragraphs = about.body.split(/\n+/).map((p) => p.trim()).filter(Boolean);

  return (
    <section id="about" aria-labelledby="about-title" className="relative scroll-mt-24 py-24 sm:py-32">
      <div className="container-cine grid items-center gap-14 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-20">
        {/* portrait in the viewfinder */}
        <Reveal className="relative mx-auto w-full max-w-md lg:max-w-none">
          <div className="relative aspect-[4/5] overflow-hidden rounded-[1.6rem] bg-surface ring-1 ring-white/[0.07]">
            {about.avatarUrl ? (
              <FadeImage src={about.avatarUrl} alt={`${brand.name} — ${brand.title}`} className="h-full w-full object-cover" />
            ) : (
              <div className="grid h-full w-full place-items-center bg-[radial-gradient(60%_60%_at_50%_40%,color-mix(in_oklab,var(--accent)_30%,transparent),#0b0b0d)]">
                <span dir="ltr" className="font-display text-7xl text-text">
                  {brand.heroMark || brand.name}
                </span>
              </div>
            )}
            <div className="absolute inset-0 bg-[linear-gradient(to_top,rgba(6,6,7,0.75),transparent_40%,transparent_75%,rgba(6,6,7,0.5))]" />
            <div aria-hidden="true" className="viewfinder absolute inset-5 [--vf-size:26px] [--vf-w:2px]" />
            <div aria-hidden="true" className="absolute left-1/2 top-[42%] size-16 -translate-x-1/2 -translate-y-1/2 border border-accent/80" />
            <div className="absolute inset-x-7 top-7 flex items-center justify-between">
              <span className="hud hud-plate flex items-center gap-2 text-text">
                <span className="rec-dot inline-block size-1.5 rounded-full bg-rec" /> CAM A
              </span>
              <span className="hud hud-plate text-text">ƒ/1.8 · 85MM</span>
            </div>
            <div className="absolute inset-x-7 bottom-7 flex items-center justify-between">
              <span className="hud hud-plate text-text">@{brand.handle}</span>
              <span className="hud hud-plate text-accent">AF·C</span>
            </div>
          </div>
        </Reveal>

        <div>
          <SectionHeading id="about" index={index} total={total} code="ABOUT" kicker="نبذة" title={about.heading} />
          <Reveal delay={0.1}>
            <div className="copy -mt-4 space-y-5 sm:text-[1.1875rem]">
              {paragraphs.map((p, i) => (
                <p key={i}>{p}</p>
              ))}
            </div>
          </Reveal>
          <Reveal delay={0.18}>
            <ul className="mt-8 flex flex-wrap gap-3 font-ui text-[0.9375rem] font-semibold">
              {about.location && (
                <li className="flex items-center gap-2 rounded-full border border-line-strong px-4 py-2 text-text">
                  <MapPinIcon size={16} className="text-accent" /> {about.location}
                </li>
              )}
              {about.since && (
                <li className="flex items-center gap-2 rounded-full border border-line-strong px-4 py-2 text-text">
                  <CalendarIcon size={16} className="text-accent" /> أصوّر من {formatYear(about.since)}
                  {years ? ` · ${yearsLabel(years)} خبرة` : ''}
                </li>
              )}
            </ul>
          </Reveal>
          {stats.length > 0 && (
            <Reveal delay={0.24}>
              <dl className="mt-12 grid grid-cols-2 gap-x-6 gap-y-8 border-t border-line pt-10 sm:grid-cols-3">
                {stats.map((s, i) => (
                  <div key={`${s.label}-${i}`} className="flex min-w-0 flex-col-reverse justify-end">
                    <dt className="mt-3 font-ui text-base leading-snug text-soft">{s.label}</dt>
                    <dd
                      dir={numeralsFor(s.suffix) === 'latn' ? 'ltr' : undefined}
                      className={`flex items-baseline gap-1 font-display text-[clamp(2.4rem,5vw,3.6rem)] leading-none ${numeralsFor(s.suffix) === 'latn' ? 'justify-end' : ''}`}
                    >
                      <Counter value={s.value} numerals={numeralsFor(s.suffix)} />
                      {s.suffix && <span className="text-accent">{s.suffix}</span>}
                    </dd>
                  </div>
                ))}
              </dl>
            </Reveal>
          )}
        </div>
      </div>
    </section>
  );
}
