import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query';
import type { InquiryQuery, VideoFilters } from './endpoints';
import { ApiError } from './api';

/** Centralised query keys so invalidations never drift from the queries they target. */
export const qk = {
  me: ['me'] as const,
  overview: (days: number) => ['overview', days] as const,
  overviewAll: ['overview'] as const,
  places: ['places'] as const,
  place: (id: string) => ['place', id] as const,
  placeAll: ['place'] as const,
  videos: (filters: VideoFilters = {}) => ['videos', filters.placeId ?? '', filters.status ?? ''] as const,
  videosAll: ['videos'] as const,
  plans: ['plans'] as const,
  inquiries: (query: InquiryQuery) => ['inquiries', query.status ?? '', query.q ?? '', query.page ?? 1, query.pageSize ?? 20] as const,
  inquiriesAll: ['inquiries'] as const,
  inquiryBadge: ['inquiries', 'badge'] as const,
  settings: ['settings'] as const,
};

declare module '@tanstack/react-query' {
  interface Register {
    defaultError: ApiError | Error;
    mutationMeta: {
      /** Skip the global error toast (the caller shows its own feedback). */
      silent?: boolean;
    };
  }
}

/** Mutation errors surface as toasts by default; the toast module is injected to keep this file UI-free. */
let reportError: (error: unknown) => void = () => {};
export function setErrorReporter(fn: (error: unknown) => void): void {
  reportError = fn;
}

export const queryClient = new QueryClient({
  queryCache: new QueryCache(),
  mutationCache: new MutationCache({
    onError: (error, _vars, _ctx, mutation) => {
      if (mutation.meta?.silent) return;
      if (error instanceof ApiError && error.status === 401) return; // handled by the login redirect
      reportError(error);
    },
  }),
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      gcTime: 10 * 60_000,
      refetchOnWindowFocus: true,
      retry: (failureCount, error) => {
        if (error instanceof ApiError && !error.isNetwork && error.status < 500) return false;
        return failureCount < 2;
      },
    },
    mutations: {
      retry: false,
    },
  },
});
