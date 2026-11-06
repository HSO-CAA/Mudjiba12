import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';
import type { AdminPlaceDetail, AdminVideo, AdminVideoWithPlace, VideoUpdateInput } from '@s5y/shared';
import { api } from '../../lib/endpoints';
import { qk } from '../../lib/query';

type VideoLike = AdminVideo | AdminVideoWithPlace;

/** Applies `fn` to a video wherever it is cached (place detail pages and the all-videos lists). */
function patchVideoCaches(queryClient: QueryClient, videoId: string, fn: (video: AdminVideo) => AdminVideo | null) {
  queryClient.setQueriesData<AdminPlaceDetail>({ queryKey: qk.placeAll }, (detail) => {
    if (!detail?.videos?.some((v) => v.id === videoId)) return detail;
    return {
      ...detail,
      videos: detail.videos.flatMap((v) => {
        if (v.id !== videoId) return [v];
        const next = fn(v);
        return next ? [next] : [];
      }),
    };
  });
  queryClient.setQueriesData<AdminVideoWithPlace[]>({ queryKey: qk.videosAll }, (list) => {
    if (!Array.isArray(list) || !list.some((v) => v.id === videoId)) return list;
    return list.flatMap((v) => {
      if (v.id !== videoId) return [v];
      const next = fn(v);
      return next ? [{ ...v, ...next }] : [];
    });
  });
}

function snapshot(queryClient: QueryClient) {
  return [
    ...queryClient.getQueriesData({ queryKey: qk.placeAll }),
    ...queryClient.getQueriesData({ queryKey: qk.videosAll }),
  ];
}

export function useUpdateVideo() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: VideoUpdateInput; placeId?: string }) => api.videos.update(id, input),
    onMutate: async ({ id, input }) => {
      await queryClient.cancelQueries({ queryKey: qk.placeAll });
      await queryClient.cancelQueries({ queryKey: qk.videosAll });
      const previous = snapshot(queryClient);
      const optimistic: Partial<AdminVideo> = {};
      if (input.featured !== undefined) optimistic.featured = input.featured;
      if (input.published !== undefined) optimistic.published = input.published;
      if (input.title !== undefined) optimistic.title = input.title;
      if (input.description !== undefined) optimistic.description = input.description;
      patchVideoCaches(queryClient, id, (v) => ({ ...v, ...optimistic }));
      return { previous };
    },
    onError: (_error, _vars, context) => {
      for (const [key, data] of context?.previous ?? []) queryClient.setQueryData(key, data);
    },
    onSuccess: (video: AdminVideo, { placeId }) => {
      if (placeId && video.placeId !== placeId) {
        // Moved to another place.
        patchVideoCaches(queryClient, video.id, () => null);
        void queryClient.invalidateQueries({ queryKey: qk.place(placeId) });
        void queryClient.invalidateQueries({ queryKey: qk.place(video.placeId) });
        void queryClient.invalidateQueries({ queryKey: qk.places });
      } else {
        patchVideoCaches(queryClient, video.id, (v) => ({ ...v, ...video }));
      }
      void queryClient.invalidateQueries({ queryKey: qk.videosAll });
    },
  });
}

export function useDeleteVideo() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (video: VideoLike) => api.videos.remove(video.id),
    onSuccess: (_void, video) => {
      patchVideoCaches(queryClient, video.id, () => null);
      void queryClient.invalidateQueries({ queryKey: qk.places });
      void queryClient.invalidateQueries({ queryKey: qk.overviewAll });
    },
  });
}

export function useReprocessVideo() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (videoId: string) => api.videos.reprocess(videoId),
    onSuccess: (video) => {
      patchVideoCaches(queryClient, video.id, (v) => ({ ...v, ...video }));
      void queryClient.invalidateQueries({ queryKey: qk.place(video.placeId) });
      void queryClient.invalidateQueries({ queryKey: qk.videosAll });
    },
  });
}

export function useReorderVideos(placeId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (ids: string[]) => api.places.reorderVideos(placeId, ids),
    onMutate: async (ids) => {
      await queryClient.cancelQueries({ queryKey: qk.place(placeId) });
      const previous = queryClient.getQueryData<AdminPlaceDetail>(qk.place(placeId));
      if (previous) {
        const byId = new Map(previous.videos.map((v) => [v.id, v]));
        queryClient.setQueryData<AdminPlaceDetail>(qk.place(placeId), {
          ...previous,
          videos: ids.flatMap((id, index) => {
            const v = byId.get(id);
            return v ? [{ ...v, sortOrder: index }] : [];
          }),
        });
      }
      return { previous };
    },
    onError: (_error, _ids, context) => {
      if (context?.previous) queryClient.setQueryData(qk.place(placeId), context.previous);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: qk.place(placeId) });
      void queryClient.invalidateQueries({ queryKey: qk.videosAll });
    },
  });
}
