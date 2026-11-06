import { useMemo, useSyncExternalStore } from 'react';
import { uploads, type UploadItem } from '../lib/uploads';

/** Live view of the upload queue, optionally narrowed to one place. */
export function useUploads(placeId?: string): UploadItem[] {
  const all = useSyncExternalStore(uploads.subscribe, uploads.getSnapshot, uploads.getSnapshot);
  return useMemo(() => (placeId ? all.filter((item) => item.placeId === placeId) : all), [all, placeId]);
}
