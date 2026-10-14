import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { BrowserRouter, MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { QueryClientProvider, useQuery } from '@tanstack/react-query';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import type { PublicSite } from '@s5y/shared';
import { api } from '../api/client';
import { createQueryClient, queryKeys, useSite } from '../api/queries';
import { CursorLight, Grain } from '../components/Atmosphere';
import { Footer } from '../components/Footer';
import { Header } from '../components/Header';
import { Loader } from '../components/Loader';
import { applyAccent } from '../lib/color';
import { trackPageview } from '../lib/analytics';
import { DEMO } from '../lib/demo';
import HomePage from '../pages/HomePage';
import { NotFoundPage } from '../pages/NotFoundPage';
import { PlayerProvider } from '../player/PlayerProvider';
import { ContactIntentProvider } from './ContactIntent';
import { SmoothScroll, useSmoothScroll } from './SmoothScroll';

const PlacePage = lazy(() => import('../pages/PlacePage'));

/** The static preview lives at an arbitrary URL with no server routing, so it keeps routes in memory. */
const Router = DEMO ? MemoryRouter : BrowserRouter;

export function App() {
  const [queryClient] = useState(createQueryClient);
  return (
    <QueryClientProvider client={queryClient}>
      <Router>
        <SmoothScroll>
          <ContactIntentProvider>
            <PlayerProvider>
              <Shell />
            </PlayerProvider>
          </ContactIntentProvider>
        </SmoothScroll>
      </Router>
    </QueryClientProvider>
  );
}

/** Site settings for the chrome: from the home payload on "/", otherwise /api/public/site (or the cache). */
function useShellSite(isHome: boolean): { site: PublicSite | undefined; hasPlans: boolean } {
  const home = useQuery({ queryKey: queryKeys.home, queryFn: ({ signal }) => api.home(signal), enabled: isHome });
  const site = useSite(!isHome || !!home.error);
  const data = home.data?.site ?? site.data;
  const hasPlans = !!data?.sections.plans && (home.data ? home.data.plans.length > 0 : true);
  return { site: data, hasPlans };
}

function Shell() {
  const location = useLocation();
  const reduced = useReducedMotion();
  const { scrollTo } = useSmoothScroll();
  const { site, hasPlans } = useShellSite(location.pathname === '/');

  useEffect(() => {
    if (site?.brand.accent) applyAccent(site.brand.accent);
  }, [site?.brand.accent]);

  useEffect(() => {
    trackPageview(location.pathname);
  }, [location.pathname]);

  const onExitComplete = useCallback(() => {
    const state = window.history.state as { usr?: { scrollTo?: string } } | null;
    if (!state?.usr?.scrollTo && !window.location.hash) scrollTo(0, { immediate: true });
  }, [scrollTo]);

  return (
    <>
      <a
        href="#main"
        className="sr-only z-[200] rounded-full bg-accent px-5 py-3 font-semibold text-[var(--accent-ink)] focus:not-sr-only focus:fixed focus:right-4 focus:top-4"
      >
        تخطَّ إلى المحتوى
      </a>
      <Header site={site} hasPlans={hasPlans} />
      <AnimatePresence mode="wait" initial={false} onExitComplete={onExitComplete}>
        <motion.div key={location.pathname} className="relative">
          <motion.div
            aria-hidden="true"
            className="pointer-events-none fixed inset-0 z-[60] origin-top bg-bg"
            initial={{ scaleY: 1 }}
            animate={{ scaleY: 0, transition: { duration: reduced ? 0.01 : 0.7, ease: [0.77, 0, 0.18, 1], delay: 0.05 } }}
            exit={{ scaleY: 1, originY: 1, transition: { duration: reduced ? 0.01 : 0.5, ease: [0.77, 0, 0.18, 1] } }}
          />
          <main id="main" tabIndex={-1} className="outline-none">
            <Suspense fallback={<div className="min-h-[100svh]" aria-busy="true" />}>
              <Routes location={location}>
                <Route path="/" element={<HomePage />} />
                <Route path="/work/:slug" element={<PlacePage />} />
                <Route path="*" element={<NotFoundPage />} />
              </Routes>
            </Suspense>
          </main>
        </motion.div>
      </AnimatePresence>
      <Footer site={site} />
      <Grain />
      <CursorLight />
      <Loader />
    </>
  );
}
