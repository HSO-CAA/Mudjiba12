import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { SettingsResponse, SiteSettings } from '@s5y/shared';
import { api } from '../../lib/endpoints';
import { qk } from '../../lib/query';

export function useSettings() {
  return useQuery({ queryKey: qk.settings, queryFn: () => api.settings.get(), staleTime: 60_000 });
}

/** PUT the full settings document. `optimistic` applies the change to the cache before the server answers. */
export function useSaveSettings(options: { optimistic?: boolean; silent?: boolean } = {}) {
  const queryClient = useQueryClient();
  return useMutation({
    meta: { silent: options.silent },
    mutationFn: (settings: SiteSettings) => api.settings.put(settings),
    onMutate: async (settings) => {
      if (!options.optimistic) return { previous: undefined };
      await queryClient.cancelQueries({ queryKey: qk.settings });
      const previous = queryClient.getQueryData<SettingsResponse>(qk.settings);
      if (previous) queryClient.setQueryData<SettingsResponse>(qk.settings, { ...previous, settings });
      return { previous };
    },
    onError: (_error, _vars, context) => {
      if (context?.previous) queryClient.setQueryData(qk.settings, context.previous);
    },
    onSuccess: (response) => {
      queryClient.setQueryData(qk.settings, response);
    },
  });
}
