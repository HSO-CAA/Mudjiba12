import type {
  AdminInquiry,
  AdminPlace,
  AdminPlaceDetail,
  AdminPlan,
  AdminUser,
  AdminVideo,
  AdminVideoWithPlace,
  ChangePasswordInput,
  InquiryList,
  InquiryStatus,
  InquiryUpdateInput,
  LoginInput,
  Overview,
  PlaceInput,
  PlanInput,
  SettingsResponse,
  SiteSettings,
  VideoStatus,
  VideoUpdateInput,
  VideoUploadComplete,
  VideoUploadInit,
  VideoUploadSession,
} from '@s5y/shared';
import { request } from './api';

export interface VideoFilters {
  placeId?: string;
  status?: VideoStatus;
}

export interface InquiryQuery {
  status?: InquiryStatus;
  q?: string;
  page?: number;
  pageSize?: number;
}

const id = (value: string) => encodeURIComponent(value);

/** Typed wrappers for every admin endpoint in docs/CONTRACT.md. */
export const api = {
  auth: {
    login: (input: LoginInput) =>
      request<{ user: AdminUser }>('/auth/login', { method: 'POST', body: input, skipAuthRedirect: true }),
    logout: () => request<void>('/auth/logout', { method: 'POST', skipAuthRedirect: true }),
    me: () => request<{ user: AdminUser }>('/auth/me', { skipAuthRedirect: true }),
    changePassword: (input: ChangePasswordInput) => request<void>('/auth/password', { method: 'POST', body: input }),
  },

  overview: (days: number) => request<Overview>('/overview', { query: { days } }),

  places: {
    list: () => request<AdminPlace[]>('/places'),
    create: (input: PlaceInput) => request<AdminPlace>('/places', { method: 'POST', body: input }),
    get: (placeId: string) => request<AdminPlaceDetail>(`/places/${id(placeId)}`),
    update: (placeId: string, input: Partial<PlaceInput>) =>
      request<AdminPlace>(`/places/${id(placeId)}`, { method: 'PATCH', body: input }),
    remove: (placeId: string) => request<void>(`/places/${id(placeId)}`, { method: 'DELETE' }),
    reorder: (ids: string[]) => request<void>('/places/order', { method: 'PUT', body: { ids } }),
    reorderVideos: (placeId: string, ids: string[]) =>
      request<void>(`/places/${id(placeId)}/videos/order`, { method: 'PUT', body: { ids } }),
  },

  videos: {
    list: (filters: VideoFilters = {}) =>
      request<AdminVideoWithPlace[]>('/videos', { query: { placeId: filters.placeId, status: filters.status } }),
    get: (videoId: string) => request<AdminVideo>(`/videos/${id(videoId)}`),
    update: (videoId: string, input: VideoUpdateInput) =>
      request<AdminVideo>(`/videos/${id(videoId)}`, { method: 'PATCH', body: input }),
    remove: (videoId: string) => request<void>(`/videos/${id(videoId)}`, { method: 'DELETE' }),
    reprocess: (videoId: string) => request<AdminVideo>(`/videos/${id(videoId)}/reprocess`, { method: 'POST' }),
    initUpload: (input: VideoUploadInit, signal?: AbortSignal) =>
      request<VideoUploadSession>('/videos/uploads', { method: 'POST', body: input, signal }),
    uploadStatus: (videoId: string, signal?: AbortSignal) =>
      request<VideoUploadSession>(`/videos/${id(videoId)}/upload`, { signal }),
    uploadChunk: (videoId: string, offset: number, chunk: Blob, signal?: AbortSignal) =>
      request<{ offset: number }>(`/videos/${id(videoId)}/upload`, {
        method: 'PATCH',
        body: chunk,
        headers: { 'Content-Type': 'application/octet-stream', 'Upload-Offset': String(offset) },
        signal,
      }),
    completeUpload: (videoId: string, input: VideoUploadComplete, signal?: AbortSignal) =>
      request<AdminVideo>(`/videos/${id(videoId)}/upload/complete`, { method: 'POST', body: input, signal }),
  },

  plans: {
    list: () => request<AdminPlan[]>('/plans'),
    create: (input: PlanInput) => request<AdminPlan>('/plans', { method: 'POST', body: input }),
    update: (planId: string, input: Partial<PlanInput>) =>
      request<AdminPlan>(`/plans/${id(planId)}`, { method: 'PATCH', body: input }),
    remove: (planId: string) => request<void>(`/plans/${id(planId)}`, { method: 'DELETE' }),
    reorder: (ids: string[]) => request<void>('/plans/order', { method: 'PUT', body: { ids } }),
  },

  inquiries: {
    list: (query: InquiryQuery = {}) =>
      request<InquiryList>('/inquiries', {
        query: { status: query.status, q: query.q, page: query.page, pageSize: query.pageSize },
      }),
    update: (inquiryId: string, input: InquiryUpdateInput) =>
      request<AdminInquiry>(`/inquiries/${id(inquiryId)}`, { method: 'PATCH', body: input }),
    remove: (inquiryId: string) => request<void>(`/inquiries/${id(inquiryId)}`, { method: 'DELETE' }),
  },

  settings: {
    get: () => request<SettingsResponse>('/settings'),
    put: (settings: SiteSettings) => request<SettingsResponse>('/settings', { method: 'PUT', body: settings }),
  },
};
