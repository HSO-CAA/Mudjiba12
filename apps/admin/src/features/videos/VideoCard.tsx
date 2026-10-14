import { useState, type ReactNode } from 'react';
import {
  CircleAlert,
  CloudUpload,
  Ellipsis,
  ExternalLink,
  Eye,
  Film,
  ImageIcon,
  LoaderCircle,
  Pencil,
  Play,
  RefreshCw,
  Star,
  Trash2,
} from 'lucide-react';
import type { AdminVideo } from '@s5y/shared';
import { cn } from '../../lib/cn';
import { formatBytes, formatCompact, formatDuration } from '../../lib/format';
import { isActivePhase, type UploadItem } from '../../lib/uploads';
import { IconButton } from '../../components/ui/button';
import { Switch } from '../../components/ui/form';
import { InlineEdit } from '../../components/ui/inline-edit';
import { Menu } from '../../components/ui/menu';
import { useUpdateVideo } from './hooks';

export interface VideoCardActions {
  onPlay: (video: AdminVideo) => void;
  onDetails: (video: AdminVideo) => void;
  onPoster: (video: AdminVideo) => void;
  onReprocess: (video: AdminVideo) => void;
  onDelete: (video: AdminVideo) => void;
  onResume: (video: AdminVideo) => void;
}

export function VideoCard({
  video,
  upload,
  handle,
  dragging = false,
  actions,
  footer,
}: {
  video: AdminVideo;
  /** Local upload driving this server video, if any. */
  upload?: UploadItem;
  handle?: ReactNode;
  dragging?: boolean;
  actions: VideoCardActions;
  /** Extra line under the title (e.g. the place name on the all-videos page). */
  footer?: ReactNode;
}) {
  const update = useUpdateVideo();
  const [broken, setBroken] = useState(false);
  const horizontal = !!video.width && !!video.height && video.width > video.height;
  const localActive = upload && upload.phase !== 'done';
  const progress = upload ? upload.uploaded / Math.max(1, upload.size) : video.uploadedBytes / Math.max(1, video.sizeBytes);
  const poster = upload?.posterPreview ?? (broken ? null : video.posterUrl);
  const playable = !!video.url && (video.status === 'READY' || video.status === 'PROCESSING');

  const toggle = (input: { featured?: boolean; published?: boolean }) =>
    update.mutate({ id: video.id, input, placeId: video.placeId });

  return (
    <article
      className={cn(
        'group relative flex flex-col rounded-2xl border bg-surface transition-[border-color,box-shadow,transform] duration-200',
        dragging ? 'z-10 scale-[1.03] border-accent/50 shadow-(--shadow-pop)' : 'border-line hover:border-line-strong',
        !video.published && video.status === 'READY' && 'opacity-80',
      )}
    >
      <div className="relative aspect-[9/16] overflow-hidden rounded-t-[calc(1rem+1px)] bg-surface-2">
        {poster ? (
          <>
            {horizontal && <img src={poster} alt="" aria-hidden className="absolute inset-0 size-full scale-110 object-cover opacity-50 blur-xl" />}
            <img
              src={poster}
              alt=""
              loading="lazy"
              decoding="async"
              onError={() => setBroken(true)}
              className={cn('absolute inset-0 size-full', horizontal ? 'object-contain' : 'object-cover')}
            />
          </>
        ) : (
          <div className="absolute inset-0 grid place-items-center bg-[linear-gradient(160deg,#1c1c21,#0c0c0e)] text-subtle">
            <Film className="size-7" aria-hidden />
          </div>
        )}
        <div className="pointer-events-none absolute inset-x-0 top-0 h-16 bg-linear-to-b from-black/55 to-transparent" />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-20 bg-linear-to-t from-black/70 to-transparent" />

        {playable && !localActive && (
          <button
            type="button"
            onClick={() => actions.onPlay(video)}
            className="absolute inset-0 grid place-items-center opacity-100 transition-opacity focus-visible:opacity-100 sm:opacity-0 sm:group-hover:opacity-100"
            aria-label={`تشغيل ${video.title ?? 'الفيديو'}`}
          >
            <span className="grid size-12 place-items-center rounded-full bg-black/45 text-white ring-1 ring-white/25 backdrop-blur-md transition-transform hover:scale-105">
              <Play className="size-5 translate-x-[-1px] fill-current" aria-hidden />
            </span>
          </button>
        )}

        {/* Top controls */}
        <div className="absolute inset-x-2 top-2 flex items-center justify-between gap-1">
          {handle ?? <span />}
          <IconButton
            label={video.featured ? 'إلغاء التمييز' : 'تمييز الفيديو'}
            size="sm"
            aria-pressed={video.featured}
            onClick={() => toggle({ featured: !video.featured })}
            className={cn('bg-black/40 backdrop-blur hover:bg-black/60', video.featured ? 'text-accent hover:text-accent' : 'text-white/80 hover:text-white')}
          >
            <Star className={cn(video.featured && 'fill-current')} />
          </IconButton>
        </div>

        {/* Bottom info */}
        <div className="pointer-events-none absolute inset-x-2.5 bottom-2.5 flex items-end justify-between gap-2">
          <StatusPill video={video} upload={upload} />
          {video.durationSec ? (
            <span className="num rounded-md bg-black/55 px-1.5 py-0.5 text-[0.6875rem] text-white/90 backdrop-blur" dir="ltr">
              {formatDuration(video.durationSec)}
            </span>
          ) : null}
        </div>

        {/* Overlays */}
        {localActive && upload && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/55 backdrop-blur-[2px]">
            <ProgressRing value={progress} phase={upload.phase} />
            <span className="text-[0.6875rem] text-white/80">
              {upload.phase === 'paused' ? 'متوقف' : upload.phase === 'error' ? 'تعذّر الرفع' : upload.phase === 'finalizing' ? 'جاري الإنهاء' : 'جاري الرفع'}
            </span>
          </div>
        )}
        {!localActive && video.status === 'UPLOADING' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2.5 bg-black/65 p-3 text-center backdrop-blur-[2px]">
            <CloudUpload className="size-6 text-warning" aria-hidden />
            <p className="text-xs leading-relaxed text-white/85">
              الرفع ما كمل
              <span className="num block text-white/60" dir="ltr">
                {Math.floor(progress * 100)}%
              </span>
            </p>
            <button
              type="button"
              onClick={() => actions.onResume(video)}
              className="rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-accent-ink hover:bg-accent-hover"
            >
              كمّل الرفع
            </button>
          </div>
        )}
        {video.status === 'FAILED' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2.5 bg-black/70 p-3 text-center">
            <CircleAlert className="size-6 text-danger" aria-hidden />
            <p className="line-clamp-4 text-xs leading-relaxed text-white/80">{video.processingError || 'فشلت معالجة الفيديو'}</p>
            <button
              type="button"
              onClick={() => actions.onReprocess(video)}
              className="inline-flex items-center gap-1 rounded-lg bg-white/15 px-3 py-1.5 text-xs font-medium text-white hover:bg-white/25"
            >
              <RefreshCw className="size-3.5" aria-hidden /> أعد المعالجة
            </button>
          </div>
        )}
      </div>

      <div className="flex flex-col gap-1 p-2">
        <InlineEdit
          value={video.title ?? ''}
          maxLength={150}
          placeholder={video.originalName ?? 'بدون عنوان'}
          onSave={(title) => update.mutate({ id: video.id, input: { title: title || null }, placeId: video.placeId })}
        />
        {footer}
        <div className="flex items-center gap-1 ps-1">
          <span className="flex min-w-0 flex-1 items-center gap-2 text-[0.6875rem] text-muted">
            <span className="inline-flex items-center gap-0.5" title="مرات التشغيل">
              <Eye className="size-3" aria-hidden />
              <span className="num">{formatCompact(video.plays)}</span>
            </span>
            <span className="num hidden truncate sm:inline" dir="ltr">
              {formatBytes(video.sizeBytes)}
            </span>
          </span>
          <Switch
            size="sm"
            checked={video.published}
            label={video.published ? 'إخفاء الفيديو من الموقع' : 'إظهار الفيديو بالموقع'}
            onChange={(published) => toggle({ published })}
          />
          <Menu
            trigger={(props) => (
              <IconButton label="خيارات الفيديو" size="sm" {...props}>
                <Ellipsis />
              </IconButton>
            )}
            items={[
              { label: 'تفاصيل ونقل', icon: <Pencil />, onSelect: () => actions.onDetails(video) },
              { label: 'اختيار صورة الغلاف', icon: <ImageIcon />, onSelect: () => actions.onPoster(video) },
              ...(video.url
                ? [{ label: 'فتح الملف', icon: <ExternalLink />, onSelect: () => window.open(video.url ?? '', '_blank', 'noopener') }]
                : []),
              {
                label: 'إعادة المعالجة',
                icon: <RefreshCw />,
                onSelect: () => actions.onReprocess(video),
                disabled: video.status === 'UPLOADING' || video.status === 'PROCESSING',
              },
              { label: 'حذف', icon: <Trash2 />, tone: 'danger' as const, separated: true, onSelect: () => actions.onDelete(video) },
            ]}
          />
        </div>
      </div>
    </article>
  );
}

function StatusPill({ video, upload }: { video: AdminVideo; upload?: UploadItem }) {
  if (upload && isActivePhase(upload.phase)) return <span />;
  if (video.status === 'PROCESSING') {
    return (
      <span className="inline-flex h-6 items-center gap-1 rounded-full bg-info/25 px-2 text-[0.6875rem] font-medium text-white backdrop-blur">
        <LoaderCircle className="size-3 animate-spin" aria-hidden /> قيد المعالجة
      </span>
    );
  }
  if (video.status === 'READY' && !video.published) {
    return <span className="inline-flex h-6 items-center rounded-full bg-black/55 px-2 text-[0.6875rem] font-medium text-white/80 backdrop-blur">مخفي</span>;
  }
  return <span />;
}

function ProgressRing({ value, phase }: { value: number; phase: UploadItem['phase'] }) {
  const r = 22;
  const c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(1, value));
  const color = phase === 'error' ? 'var(--color-danger)' : phase === 'paused' ? 'var(--color-muted)' : 'var(--color-accent)';
  return (
    <div className="relative grid size-14 place-items-center">
      <svg viewBox="0 0 52 52" className="absolute inset-0 -rotate-90" aria-hidden>
        <circle cx="26" cy="26" r={r} fill="none" stroke="rgb(255 255 255 / 0.15)" strokeWidth="3" />
        <circle
          cx="26"
          cy="26"
          r={r}
          fill="none"
          stroke={color}
          strokeWidth="3"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - pct)}
          style={{ transition: 'stroke-dashoffset 0.6s ease-out' }}
        />
      </svg>
      <span className="num text-[0.75rem] font-semibold text-white" dir="ltr">
        {Math.floor(pct * 100)}%
      </span>
    </div>
  );
}
