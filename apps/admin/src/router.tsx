import type { ComponentType } from 'react';
import { createBrowserRouter, type RouteObject } from 'react-router';
import { routerBasename } from './lib/site';
import { AppShell } from './components/layout/AppShell';
import { Splash } from './components/layout/Splash';
import { RouteError } from './components/layout/RouteError';
import { RequireAuth } from './features/auth/RequireAuth';

/** Route modules are split per page; each exports a default component. */
const page = (load: () => Promise<{ default: ComponentType }>): Pick<RouteObject, 'lazy'> => ({
  lazy: async () => ({ Component: (await load()).default }),
});

const routes: RouteObject[] = [
  {
    path: '/login',
    errorElement: <RouteError />,
    hydrateFallbackElement: <Splash />,
    ...page(() => import('./features/auth/LoginPage')),
  },
  {
    path: '/',
    errorElement: <RouteError />,
    hydrateFallbackElement: <Splash />,
    element: (
      <RequireAuth>
        <AppShell />
      </RequireAuth>
    ),
    children: [
      { index: true, ...page(() => import('./features/overview/OverviewPage')) },
      { path: 'places', ...page(() => import('./features/places/PlacesPage')) },
      { path: 'places/:placeId', ...page(() => import('./features/places/PlacePage')) },
      { path: 'videos', ...page(() => import('./features/videos/VideosPage')) },
      { path: 'inquiries', ...page(() => import('./features/inquiries/InquiriesPage')) },
      { path: 'plans', ...page(() => import('./features/plans/PlansPage')) },
      { path: 'settings', ...page(() => import('./features/settings/SettingsPage')) },
      { path: 'account', ...page(() => import('./features/account/AccountPage')) },
      { path: '*', ...page(() => import('./components/layout/NotFound')) },
    ],
  },
];

export const router = createBrowserRouter(routes, { basename: routerBasename() });
