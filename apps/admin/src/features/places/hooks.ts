import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AdminPlace, AdminPlaceDetail, PlaceInput } from '@s5y/shared';
import { api } from '../../lib/endpoints';
import { qk } from '../../lib/query';
import { uploads } from '../../lib/uploads';

export function usePlaces() {
  return useQuery({ queryKey: qk.places, queryFn: () => api.places.list() });
}

/** Place detail; polls while any video is still processing or uploading on the server. */
export function usePlace(placeId: string) {
  return useQuery({
    queryKey: qk.place(placeId),
    queryFn: () => api.places.get(placeId),
    refetchInterval: (query) => {
      const videos = query.state.data?.videos ?? [];
      const localIds = new Set(uploads.getSnapshot().map((item) => item.videoId));
      const busy = videos.some((v) => v.status === 'PROCESSING' || (v.status === 'UPLOADING' && localIds.has(v.id)));
      return busy ? 3000 : false;
    },
  });
}

const mergePlace = (detail: AdminPlaceDetail | undefined, place: AdminPlace): AdminPlaceDetail | undefined =>
  detail ? { ...detail, ...place, videos: detail.videos } : detail;

export function useCreatePlace() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: PlaceInput) => api.places.create(input),
    onSuccess: (place) => {
      queryClient.setQueryData<AdminPlace[]>(qk.places, (list) => (list ? [...list, place] : list));
      void queryClient.invalidateQueries({ queryKey: qk.places });
      void queryClient.invalidateQueries({ queryKey: qk.overviewAll });
    },
  });
}

/** PATCH with optimistic list/detail updates (used for quick toggles and the details form). */
export function useUpdatePlace(options: { silent?: boolean } = {}) {
  const queryClient = useQueryClient();
  return useMutation({
    meta: { silent: options.silent },
    mutationFn: ({ id, input }: { id: string; input: Partial<PlaceInput> }) => api.places.update(id, input),
    onMutate: async ({ id, input }) => {
      await queryClient.cancelQueries({ queryKey: qk.places });
      const previousList = queryClient.getQueryData<AdminPlace[]>(qk.places);
      const previousDetail = queryClient.getQueryData<AdminPlaceDetail>(qk.place(id));
      // Only optimistic for simple flags; field edits wait for the server's normalised values.
      const flags: Partial<AdminPlace> = {};
      if (input.published !== undefined) flags.published = input.published;
      if (input.featured !== undefined) flags.featured = input.featured;
      if (Object.keys(flags).length > 0) {
        queryClient.setQueryData<AdminPlace[]>(qk.places, (list) => list?.map((p) => (p.id === id ? { ...p, ...flags } : p)));
        queryClient.setQueryData<AdminPlaceDetail>(qk.place(id), (d) => (d ? { ...d, ...flags } : d));
      }
      return { previousList, previousDetail };
    },
    onError: (_error, { id }, context) => {
      if (context?.previousList) queryClient.setQueryData(qk.places, context.previousList);
      if (context?.previousDetail) queryClient.setQueryData(qk.place(id), context.previousDetail);
    },
    onSuccess: (place) => {
      queryClient.setQueryData<AdminPlace[]>(qk.places, (list) => list?.map((p) => (p.id === place.id ? place : p)));
      queryClient.setQueryData<AdminPlaceDetail>(qk.place(place.id), (d) => mergePlace(d, place));
      void queryClient.invalidateQueries({ queryKey: qk.videosAll });
    },
  });
}

export function useDeletePlace() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.places.remove(id),
    onSuccess: (_void, id) => {
      queryClient.setQueryData<AdminPlace[]>(qk.places, (list) => list?.filter((p) => p.id !== id));
      queryClient.removeQueries({ queryKey: qk.place(id) });
      void queryClient.invalidateQueries({ queryKey: qk.videosAll });
      void queryClient.invalidateQueries({ queryKey: qk.overviewAll });
    },
  });
}

export function useReorderPlaces() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (ids: string[]) => api.places.reorder(ids),
    onMutate: async (ids) => {
      await queryClient.cancelQueries({ queryKey: qk.places });
      const previous = queryClient.getQueryData<AdminPlace[]>(qk.places);
      if (previous) {
        const byId = new Map(previous.map((p) => [p.id, p]));
        queryClient.setQueryData<AdminPlace[]>(
          qk.places,
          ids.flatMap((id, index) => {
            const place = byId.get(id);
            return place ? [{ ...place, sortOrder: index }] : [];
          }),
        );
      }
      return { previous };
    },
    onError: (_error, _ids, context) => {
      if (context?.previous) queryClient.setQueryData(qk.places, context.previous);
    },
    onSettled: () => void queryClient.invalidateQueries({ queryKey: qk.places }),
  });
}
