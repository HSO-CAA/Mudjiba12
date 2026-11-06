import { useEffect, useId, useRef, useState, type DragEvent, type ReactNode } from 'react';
import { ImagePlus, LoaderCircle, RefreshCw, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import type { UploadedImage } from '@s5y/shared';
import { errorMessage, isAbortError } from '../../lib/api';
import { cn } from '../../lib/cn';
import { IMAGE_ACCEPT, uploadImage, validateImageFile } from '../../lib/upload-image';

export interface ImageUploaderProps {
  /** Current image URL (saved or freshly uploaded). */
  value: string | null;
  onUploaded: (image: UploadedImage) => void;
  onRemove: () => void;
  /** CSS aspect-ratio, e.g. "16 / 9". */
  aspect?: string;
  fit?: 'cover' | 'contain';
  shape?: 'rect' | 'circle';
  label: string;
  hint?: ReactNode;
  className?: string;
  /** Background behind `contain` images (e.g. the place accent for logos). */
  backdrop?: string;
}

/** Drop / pick an image → uploads immediately (XHR progress) → hands back the storage key. */
export function ImageUploader({
  value,
  onUploaded,
  onRemove,
  aspect = '16 / 9',
  fit = 'cover',
  shape = 'rect',
  label,
  hint,
  className,
  backdrop,
}: ImageUploaderProps) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [localPreview, setLocalPreview] = useState<string | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [dragging, setDragging] = useState(false);
  const [broken, setBroken] = useState(false);

  useEffect(() => () => abortRef.current?.abort(), []);
  useEffect(() => () => {
    if (localPreview) URL.revokeObjectURL(localPreview);
  }, [localPreview]);
  useEffect(() => setBroken(false), [value]);

  const start = async (file: File) => {
    const problem = validateImageFile(file);
    if (problem) {
      toast.error(problem);
      return;
    }
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLocalPreview(URL.createObjectURL(file));
    setProgress(0);
    try {
      const image = await uploadImage(file, {
        signal: controller.signal,
        onProgress: (loaded, total) => setProgress(total > 0 ? loaded / total : 0),
      });
      onUploaded(image);
      setLocalPreview(null);
    } catch (error) {
      setLocalPreview(null);
      if (!isAbortError(error)) toast.error(errorMessage(error, 'تعذّر رفع الصورة'));
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setProgress(null);
    }
  };

  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer.files?.[0];
    if (file) void start(file);
  };

  const shown = localPreview ?? (broken ? null : value);
  const uploading = progress !== null;
  const radius = shape === 'circle' ? 'rounded-full' : 'rounded-2xl';

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <div
        className={cn(
          'group relative isolate overflow-hidden border transition-colors',
          radius,
          shown ? 'border-line' : 'border-dashed border-line-strong bg-surface-2/50',
          dragging && 'border-accent bg-accent/[0.06]',
        )}
        style={{ aspectRatio: aspect, background: shown && fit === 'contain' ? (backdrop ?? 'var(--color-surface-2)') : undefined }}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
      >
        {shown ? (
          <img
            src={shown}
            alt={label}
            onError={() => !localPreview && setBroken(true)}
            className={cn('absolute inset-0 size-full', fit === 'contain' ? 'object-contain p-[12%]' : 'object-cover')}
          />
        ) : (
          <label
            htmlFor={inputId}
            className="absolute inset-0 flex cursor-pointer flex-col items-center justify-center gap-2 p-4 text-center"
          >
            <span className="grid size-10 place-items-center rounded-xl border border-line bg-surface-3 text-accent transition-transform group-hover:scale-105">
              <ImagePlus className="size-5" aria-hidden />
            </span>
            <span className="text-[0.8125rem] font-medium text-fg-2">{shape === 'circle' ? 'اختار صورة' : 'اسحب صورة هنا أو اضغط للاختيار'}</span>
            {shape !== 'circle' && <span className="text-xs text-subtle">JPG · PNG · WebP · AVIF · GIF — لحد 15MB</span>}
          </label>
        )}

        {uploading && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/55 backdrop-blur-[2px]">
            <LoaderCircle className="size-6 animate-spin text-accent" aria-hidden />
            <span className="num text-sm text-fg" dir="ltr">
              {Math.round((progress ?? 0) * 100)}%
            </span>
            <button
              type="button"
              onClick={() => abortRef.current?.abort()}
              className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-fg-2 hover:bg-white/10"
            >
              <X className="size-3.5" aria-hidden /> إلغاء
            </button>
            <div className="absolute inset-x-0 bottom-0 h-1 bg-white/10">
              <div className="h-full bg-accent transition-[width] duration-200" style={{ width: `${(progress ?? 0) * 100}%` }} />
            </div>
          </div>
        )}

        {shown && !uploading && (
          <div
            className={cn(
              'absolute inset-x-0 bottom-0 flex justify-center gap-1.5 bg-linear-to-t from-black/75 to-transparent p-2.5 pt-8 transition-opacity',
              'opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100',
              shape === 'circle' && 'pb-3',
            )}
          >
            <label
              htmlFor={inputId}
              className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-lg bg-white/15 px-2.5 text-xs font-medium text-white backdrop-blur hover:bg-white/25"
            >
              <RefreshCw className="size-3.5" aria-hidden />
              {shape === 'circle' ? 'تغيير' : 'استبدال'}
            </label>
            <button
              type="button"
              onClick={onRemove}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-white/15 px-2.5 text-xs font-medium text-white backdrop-blur hover:bg-danger/80"
              aria-label={`حذف ${label}`}
            >
              <Trash2 className="size-3.5" aria-hidden />
              {shape !== 'circle' && 'حذف'}
            </button>
          </div>
        )}
      </div>
      <input
        ref={inputRef}
        id={inputId}
        type="file"
        accept={IMAGE_ACCEPT}
        className="sr-only"
        aria-label={label}
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file) void start(file);
        }}
      />
      {hint && <p className="text-xs leading-relaxed text-muted">{hint}</p>}
    </div>
  );
}
