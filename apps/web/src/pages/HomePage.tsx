import { useEffect } from 'react';
import { useLocation } from 'react-router';
import { useHome } from '../api/queries';
import { useBootTask } from '../app/loading';
import { useSmoothScroll } from '../app/SmoothScroll';
import { ErrorView } from '../components/StateViews';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { About } from '../sections/About';
import { Contact } from '../sections/Contact';
import { Hero } from '../sections/Hero';
import { Marquee } from '../sections/Marquee';
import { Plans } from '../sections/Plans';
import { Showreel } from '../sections/Showreel';
import { Work } from '../sections/Work';

export default function HomePage() {
  const { data, error, refetch } = useHome();
  const location = useLocation();
  const { scrollTo } = useSmoothScroll();
  useBootTask('data', !!data || !!error, 0.2);
  useDocumentTitle(data?.site.seo.title || (data ? `${data.site.brand.name} — ${data.site.brand.title}` : null), data?.site.seo.description);

  // deep links like "/#contact" or navigation state from other pages
  useEffect(() => {
    if (!data) return;
    const state = location.state as { scrollTo?: string } | null;
    const target = state?.scrollTo ?? (location.hash ? location.hash.slice(1) : '');
    if (!target || target === 'top') return;
    const t = window.setTimeout(() => scrollTo(`#${CSS.escape(target)}`), 160);
    return () => window.clearTimeout(t);
  }, [data, location.key, location.state, location.hash, scrollTo]);

  if (error && !data) return <ErrorView error={error} onRetry={() => void refetch()} />;
  if (!data) return <div className="min-h-[100svh]" aria-busy="true" />;

  const { site, places, showreel, plans } = data;
  const sections = site.sections;
  const showShowreel = sections.showreel && showreel.length > 0;
  const showAbout = sections.about;
  const showPlans = sections.plans && plans.length > 0;
  const showContact = sections.contact;
  const order = ['work', showShowreel && 'showreel', showAbout && 'about', showPlans && 'plans', showContact && 'contact'].filter(Boolean) as string[];
  const n = (id: string) => order.indexOf(id) + 1;
  const total = order.length;
  const totalVideos = places.reduce((sum, p) => sum + p.videoCount, 0);

  return (
    <>
      <Hero data={data} hasWork={places.length > 0} />
      <Marquee places={places} />
      <Work places={places} index={n('work')} total={total} totalVideos={totalVideos} />
      {showShowreel && <Showreel videos={showreel} places={places} index={n('showreel')} total={total} />}
      {showAbout && <About site={site} index={n('about')} total={total} />}
      {showPlans && <Plans plans={plans} index={n('plans')} total={total} />}
      {showContact && <Contact site={site} plans={plans} index={n('contact')} total={total} source="home" />}
    </>
  );
}
