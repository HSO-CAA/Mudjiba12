import type { UploadedImage } from '@s5y/shared';
import { ADMIN_API, ApiError, notifyUnauthorized } from './api';

export const IMAGE_MAX_BYTES = 15 * 1024 * 1024;
export const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/gif'] as const;
export const IMAGE_ACCEPT = IMAGE_TYPES.join(',');
const IMAGE_EXT = /\.(jpe?g|png|webp|avif|gif)$/i;

/** Client-side guard with the same limits as the API; returns an Arabic error or null. */
export function validateImageFile(file: File): string | null {
  const typeOk = (IMAGE_TYPES as readonly string[]).includes(file.type) || (!file.type && IMAGE_EXT.test(file.name));
  if (!typeOk) return 'الصيغة غير مدعومة — استخدم JPG أو PNG أو WebP أو AVIF أو GIF';
  if (file.size > IMAGE_MAX_BYTES) return 'حجم الصورة أكبر من 15 ميغابايت';
  if (file.size === 0) return 'الملف فارغ';
  return null;
}

export interface ImageUploadOptions {
  /** Called with bytes sent so far and the total request size. */
  onProgress?: (loaded: number, total: number) => void;
  signal?: AbortSignal;
  /** File name to send for Blobs (e.g. a captured poster frame). */
  fileName?: string;
}

/**
 * POST /api/admin/uploads/image (multipart, field `file`).
 * Uses XHR rather than fetch because fetch can't report upload progress.
 */
export function uploadImage(file: Blob, options: ImageUploadOptions = {}): Promise<UploadedImage> {
  return new Promise<UploadedImage>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const form = new FormData();
    const name = options.fileName ?? (file instanceof File ? file.name : 'image.jpg');
    form.append('file', file, name);

    const onAbort = () => xhr.abort();
    options.signal?.addEventListener('abort', onAbort, { once: true });
    const cleanup = () => options.signal?.removeEventListener('abort', onAbort);

    xhr.open('POST', `${ADMIN_API}/uploads/image`);
    xhr.withCredentials = false; // same-origin: cookies are sent anyway
    xhr.setRequestHeader('Accept', 'application/json');
    xhr.setRequestHeader('X-S5Y-Admin', '1');
    xhr.responseType = 'text';

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) options.onProgress?.(event.loaded, event.total);
    };
    xhr.onload = () => {
      cleanup();
      let data: unknown;
      try {
        data = xhr.responseText ? (JSON.parse(xhr.responseText) as unknown) : undefined;
      } catch {
        data = undefined;
      }
      if (xhr.status >= 200 && xhr.status < 300 && data) {
        resolve(data as UploadedImage);
        return;
      }
      if (xhr.status === 401) notifyUnauthorized();
      reject(ApiError.fromResponse(xhr.status, data));
    };
    xhr.onerror = () => {
      cleanup();
      reject(ApiError.network());
    };
    xhr.onabort = () => {
      cleanup();
      reject(new DOMException('Upload aborted', 'AbortError'));
    };
    if (options.signal?.aborted) {
      cleanup();
      reject(new DOMException('Upload aborted', 'AbortError'));
      return;
    }
    xhr.send(form);
  });
}
