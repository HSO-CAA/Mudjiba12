import { useParams, Link } from 'react-router';
import { motion, useTransform, useReducedMotion } from 'motion/react';
import { useRef } from 'react';
import type { HomeData, PlaceDetail, PlaceSummary, PublicVideo } from '@s5y/shared';
import { useQueryClient } from '@tanstack/react-query';
import { ApiError } from '../api/client';
import { queryKeys, usePlace, usePlaceSummary, useSite } from '../api/queries';
import { useBoot, useBootTask } from '../app/loading';
import { EmptyFrame } from '../components/EmptyFrame';
import { ArrowBackIcon, ArrowForwardIcon, CalendarIcon, GlobeIcon, InstagramIcon, MapPinIcon } from '../components/Icons';
import { FadeImage } from '../components/Media';
import { Reveal, RevealLines } from '../components/Reveal';
import { PlaceSkeleton, ErrorView } from '../components/StateViews';
import { VideoCard } from '../components/VideoCard';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { useScrollProgress } from '../hooks/useScrollProgress';
import { displayHost, instagramUrl, websiteUrl } from '../lib/links';
import { formatYear, videosLabel } from '../lib/format';
import { placeAccentVars, safeColor } from '../lib/color';
import { usePlayer } from '../player/PlayerProvider';
import { Contact } from '../sections/Contact';
import { PlaceReel } from '../sections/PlaceReel';
import { NotFoundPage } from './NotFoundPage';

export default function PlacePage() {
  const { slug } = useParams();
  const summary = usePlaceSummary(slug);
  const { data: place, error, refetch } = usePlace(slug);
  const { data: site } = useSite();
  const qc = useQueryClient();
  const notFound = error instanceof ApiError && error.isNotFound;
  useBootTask('data', !!place || !!error, 0.2);

  const view: PlaceSummary | undefined = place ?? summary;
  const brandName = site?.brand.name ?? 'S5Y';
  useDocumentTitle(
    notFound ? null : view ? `${view.name} — ${brandName}` : null,
    place?.summary ?? place?.description?.slice(0, 160) ?? null,
  );

  if (notFound) return <NotFoundPage body="هذا المكان مو موجود أو انشال من البورتفوليو. شوف باقي الشغل من الرئيسية." />;
  if (error && !view) return <ErrorView error={error} onRetry={() => void refetch()} />;
  if (!view) return <PlaceSkeleton />;

  const plans = qc.getQueryData<HomeData>(queryKeys.home)?.plans ?? [];
  const accent = safeColor(view.accentColor, site?.brand.accent);

  return (
    <article style={placeAccentVars(accent)} aria-labelledby="place-title">
      <PlaceHero place={view} detail={place} />
      {place ? <PlaceBody place={place} accent={accent} /> : <PlaceSkeletonBody />}
      {site?.sections.contact && (
        <Contact site={site} plans={plans} source={`place:${view.slug}`} heading={`تريد محتوى مثل ${view.name}؟`} />
      )}
    </article>
  );
}

function PlaceHero({ place, detail }: { place: PlaceSummary; detail?: PlaceDetail }) {
  const ref = useRef<HTMLElement>(null);
  const reduced = useReducedMotion();
  const { dismissed } = useBoot();
  const scrollYProgress = useScrollProgress(ref, 'exit');
  const imgY = useTransform(scrollYProgress, [0, 1], ['0%', reduced ? '0%' : '18%']);
  const imgScale = useTransform(scrollYProgress, [0, 1], [1.08, reduced ? 1.08 : 1.22]);
  const fade = useTransform(scrollYProgress, [0, 0.7], [1, 0]);
  const cover = place.coverUrl ?? place.previews[0]?.posterUrl ?? null;
  const ig = instagramUrl(detail?.instagram);
  const web = websiteUrl(detail?.website);

  return (
    <section ref={ref} className="relative flex min-h-[100svh] items-end overflow-hidden pb-14 pt-[calc(var(--header-h)+3rem)] sm:pb-20">
      <motion.div className="absolute inset-0" style={{ y: imgY, scale: imgScale }}>
        {cover ? (
          <FadeImage src={cover} alt="" loading="eager" fetchPriority="high" className="h-full w-full object-cover" />
        ) : (
          <div className="h-full w-full bg-[linear-gradient(150deg,color-mix(in_oklab,var(--place-accent)_45%,#000),#060607_70%)]" />
        )}
      </motion.div>
      <div aria-hidden="true" className="absolute inset-0 bg-[color-mix(in_oklab,var(--place-accent)_30%,transparent)] mix-blend-color" />
      <div aria-hidden="true" className="absolute inset-0 bg-[radial-gradient(70%_55%_at_85%_85%,color-mix(in_oklab,var(--place-accent)_26%,transparent),transparent_70%)]" />
      <div aria-hidden="true" className="absolute inset-0 bg-[linear-gradient(to_top,#060607_4%,rgba(6,6,7,0.9)_38%,rgba(6,6,7,0.5)_66%,rgba(6,6,7,0.72))]" />
      <div aria-hidden="true" className="viewfinder absolute inset-x-4 bottom-4 top-[calc(var(--header-h)+0.5rem)] opacity-50 sm:inset-x-6 sm:bottom-6" />

      <motion.div style={{ opacity: fade }} className="container-cine relative w-full">
        <Reveal play={dismissed}>
          <Link to="/" state={{ scrollTo: 'work' }} className="hud-plate mb-10 inline-flex items-center gap-2 font-ui text-[0.9375rem] leading-none text-text transition hover:text-accent">
            <ArrowBackIcon size={16} /> كل الشغل
          </Link>
        </Reveal>
        <div className="flex flex-col gap-10 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-4xl">
            <Reveal play={dismissed} delay={0.05} className="mb-6 flex flex-wrap items-center gap-3">
              {place.logoUrl && <img src={place.logoUrl} alt={`شعار ${place.name}`} className="size-16 rounded-full bg-black/40 object-cover ring-1 ring-white/20" />}
              {place.category && (
                <span className="rounded-full border border-white/15 bg-bg/70 px-4 py-2 font-ui text-[0.9375rem] leading-none text-text backdrop-blur">
                  <span className="me-2 inline-block size-2 rounded-full bg-[var(--place-accent)]" aria-hidden="true" />
                  {place.category}
                </span>
              )}
            </Reveal>
            <RevealLines as="h1" id="place-title" play={dismissed} lines={[place.name]} delay={0.1} className="display-xl text-on-media text-[clamp(2.8rem,9vw,7.5rem)]" />
            {place.summary && (
              <Reveal play={dismissed} delay={0.25}>
                <p className="copy text-on-media mt-6 max-w-2xl text-text sm:text-[1.25rem]">{place.summary}</p>
              </Reveal>
            )}
          </div>
          <Reveal play={dismissed} delay={0.3}>
            <dl className="text-on-media grid grid-cols-2 gap-x-10 gap-y-5 sm:flex sm:gap-10">
              {place.location && (
                <div>
                  <dt className="hud mb-2 text-soft">LOCATION</dt>
                  <dd className="flex items-center gap-2 text-[1.0625rem] text-text">
                    <MapPinIcon size={16} className="text-place" />
                    {place.location}
                  </dd>
                </div>
              )}
              {place.year && (
                <div>
                  <dt className="hud mb-2 text-soft">YEAR</dt>
                  <dd className="flex items-center gap-2 text-[1.0625rem] text-text">
                    <CalendarIcon size={16} className="text-place" />
                    {formatYear(place.year)}
                  </dd>
                </div>
              )}
              <div>
                <dt className="hud mb-2 text-soft">REELS</dt>
                <dd className="text-[1.0625rem] text-text">{videosLabel(detail?.videos.length ?? place.videoCount)}</dd>
              </div>
              {(ig || web) && (
                <div className="col-span-2 flex gap-2 sm:col-span-1">
                  {ig && (
                    <a href={ig} target="_blank" rel="noopener noreferrer" aria-label={`إنستغرام ${place.name}`} className="grid size-11 place-items-center rounded-full border border-white/20 bg-bg/70 text-text backdrop-blur transition hover:border-[var(--place-accent)]">
                      <InstagramIcon size={19} />
                    </a>
                  )}
                  {web && (
                    <a href={web} target="_blank" rel="noopener noreferrer" className="inline-flex h-11 items-center gap-2 rounded-full border border-white/20 bg-bg/70 px-4 text-text backdrop-blur transition hover:border-[var(--place-accent)]">
                      <GlobeIcon size={17} /> <span dir="ltr">{displayHost(web)}</span>
                    </a>
                  )}
                </div>
              )}
            </dl>
          </Reveal>
        </div>
      </motion.div>
    </section>
  );
}

function PlaceBody({ place, accent }: { place: PlaceDetail; accent: string }) {
  const { open } = usePlayer();
  const placesRef = { [place.id]: { name: place.name, slug: place.slug } };
  const openAt = (i: number) => open({ videos: place.videos, index: i, places: placesRef });
  const paragraphs = (place.description ?? '').split(/\n+/).map((p) => p.trim()).filter(Boolean);

  return (
    <>
      {(paragraphs.length > 0 || place.services.length > 0) && (
        <section className="container-cine grid gap-10 border-b border-line py-16 sm:py-20 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] lg:gap-20">
          {paragraphs.length > 0 && (
            <Reveal className="copy space-y-5 sm:text-[1.1875rem]">
              {paragraphs.map((p, i) => (
                <p key={i}>{p}</p>
              ))}
            </Reveal>
          )}
          {place.services.length > 0 && (
            <Reveal delay={0.1}>
              <h2 className="mb-5 flex items-center gap-2 text-muted">
                <span className="hud" aria-hidden="true">SERVICES</span>
                <span aria-hidden="true">·</span>
                <span className="font-ui text-base leading-none text-soft">الخدمات</span>
              </h2>
              <ul className="flex flex-wrap gap-2.5">
                {place.services.map((s) => (
                  <li key={s} className="rounded-full border border-line-strong bg-white/[0.03] px-4 py-2.5 font-ui text-[0.9375rem] font-semibold text-text">
                    {s}
                  </li>
                ))}
              </ul>
            </Reveal>
          )}
        </section>
      )}

      <section aria-labelledby="reels-title" className="py-20 sm:py-28">
        <div className="container-cine">
          <div className="mb-10 flex items-end justify-between gap-6">
            <div>
              <p className="hud mb-4 text-place">REELS · {String(place.videos.length).padStart(2, '0')}</p>
              <h2 id="reels-title" className="display-xl text-[clamp(2rem,5vw,3.8rem)]">
                الريلز
              </h2>
            </div>
          </div>
          {place.videos.length ? (
            <PlaceReel videos={place.videos} accent={accent} placeName={place.name} onOpen={openAt} />
          ) : (
            <EmptyFrame title="الفيديوهات بالطريق" body="لسه ماكو فيديوهات منشورة لهذا المكان. ارجع بعد شوية!" />
          )}
        </div>
      </section>

      {place.videos.length > 0 && (
        <section aria-labelledby="all-videos-title" className="border-t border-line py-20 sm:py-24">
          <div className="container-cine">
            <h2 id="all-videos-title" className="mb-8 flex items-baseline gap-4 font-display text-[1.75rem] leading-tight sm:text-4xl">
              كل الفيديوهات <span className="hud text-muted">{String(place.videos.length).padStart(2, '0')}</span>
            </h2>
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-5 lg:grid-cols-4">
              {place.videos.map((v: PublicVideo, i) => (
                <Reveal as="li" key={v.id} delay={(i % 4) * 0.05}>
                  <VideoCard video={v} index={i} onOpen={() => openAt(i)} />
                </Reveal>
              ))}
            </ul>
          </div>
        </section>
      )}

      <PlaceNav place={place} />
    </>
  );
}

function PlaceSkeletonBody() {
  return (
    <div className="container-cine grid gap-5 py-20 sm:grid-cols-3" aria-busy="true">
      {Array.from({ length: 3 }, (_, i) => (
        <div key={i} className="skeleton aspect-[9/16] rounded-[1.25rem]" />
      ))}
    </div>
  );
}

function PlaceNav({ place }: { place: PlaceDetail }) {
  if (!place.prev && !place.next) return null;
  return (
    <nav aria-label="التنقل بين الأماكن" className="grid border-y border-line sm:grid-cols-2">
      {place.prev ? (
        <Link to={`/work/${place.prev.slug}`} className="group relative flex flex-col gap-3 overflow-hidden border-b border-line p-8 transition sm:border-b-0 sm:border-e sm:p-12">
          <span className="flex items-center gap-2 text-muted">
            <ArrowBackIcon size={14} /> <span className="hud">PREV</span> · <span className="font-ui text-[0.9375rem] leading-none text-soft">المكان السابق</span>
          </span>
          <span className="font-display text-[2rem] leading-tight transition-colors group-hover:text-accent sm:text-[2.6rem]">{place.prev.name}</span>
          <span aria-hidden="true" className="absolute inset-0 -z-10 bg-white/[0.02] opacity-0 transition-opacity group-hover:opacity-100" />
        </Link>
      ) : (
        <span className="hidden sm:block" />
      )}
      {place.next ? (
        <Link to={`/work/${place.next.slug}`} className="group relative flex flex-col items-end gap-3 overflow-hidden p-8 text-end sm:p-12">
          <span className="flex items-center gap-2 text-muted">
            <span className="font-ui text-[0.9375rem] leading-none text-soft">المكان التالي</span> · <span className="hud">NEXT</span> <ArrowForwardIcon size={14} />
          </span>
          <span className="font-display text-[2rem] leading-tight transition-colors group-hover:text-accent sm:text-[2.6rem]">{place.next.name}</span>
        </Link>
      ) : (
        <span className="hidden sm:block" />
      )}
    </nav>
  );
}
