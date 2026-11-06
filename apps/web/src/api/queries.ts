import { QueryClient, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { HomeData, InquiryInput, PlaceDetail, PlaceSummary, PublicSite } from '@s5y/shared';
import { ApiError, api } from './client';

export const queryKeys = {
  home: ['home'] as const,
  site: ['site'] as const,
  place: (slug: string) => ['place', slug] as const,
};

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        gcTime: 10 * 60_000,
        refetchOnWindowFocus: false,
        retry: (failureCount, error) => {
          if (error instanceof ApiError && error.status >= 400 && error.status < 500) return false;
          return failureCount < 2;
        },
      },
    },
  });
}

export function useHome() {
  return useQuery({
    queryKey: queryKeys.home,
    queryFn: ({ signal }) => api.home(signal),
  });
}

/** Site settings — served from the home payload when it is already cached. */
export function useSite(enabled = true) {
  const qc = useQueryClient();
  return useQuery<PublicSite>({
    enabled,
    queryKey: queryKeys.site,
    queryFn: async ({ signal }) => {
      const home = qc.getQueryData<HomeData>(queryKeys.home);
      if (home) return home.site;
      return api.site(signal);
    },
    initialData: () => qc.getQueryData<HomeData>(queryKeys.home)?.site,
    initialDataUpdatedAt: () => qc.getQueryState(queryKeys.home)?.dataUpdatedAt,
  });
}

export function usePlace(slug: string | undefined) {
  return useQuery<PlaceDetail>({
    queryKey: queryKeys.place(slug ?? ''),
    queryFn: ({ signal }) => api.place(slug ?? '', signal),
    enabled: !!slug,
  });
}

/** A cached summary (from the home payload) to paint the place hero instantly while details load. */
export function usePlaceSummary(slug: string | undefined): PlaceSummary | undefined {
  const qc = useQueryClient();
  if (!slug) return undefined;
  return qc.getQueryData<HomeData>(queryKeys.home)?.places.find((p) => p.slug === slug);
}

export function useCreateInquiry() {
  return useMutation({
    mutationFn: (input: InquiryInput) => api.createInquiry(input),
  });
}
