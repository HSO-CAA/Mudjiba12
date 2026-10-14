import type { VideoStatus } from '@s5y/shared';
import { CircleAlert, CircleCheck, CloudOff, FileVideo, LoaderCircle, Pause, Play, RotateCcw, X } from 'lucide-react';
import { cn } from '../../lib/cn';
import { formatBytes, formatEta, formatSpeed, ltr } from '../../lib/format';
import { isActivePhase, uploads, type UploadItem } from '../../lib/uploads';
import { IconButton } from '../../components/ui/button';
import { ProgressBar } from '../../components/ui/misc';

function phaseText(item: UploadItem, live?: VideoStatus): string {
  switch (item.phase) {
    case 'queued':
      return 'بالانتظار';
    case 'starting':
      return 'جاري التحضير…';
    case 'uploading':
      return item.speed > 0 ? `${ltr(formatSpeed(item.speed))} · باقي ${formatEta(item.eta)}` : 'جاري الرفع…';
    case 'retrying':
      return `انقطع الاتصال — إعادة المحاولة بعد ${item.retryInSec ?? 0} ث (محاولة ${item.attempt})`;
    case 'offline':
      return 'ماكو إنترنت — راح يكمل تلقائياً لمن يرجع الاتصال';
    case 'paused':
      return 'متوقف مؤقتاً';
    case 'finalizing':
      return 'جاري الإنهاء وحفظ الغلاف…';
    case 'done': {
      const status = live ?? item.result?.status;
      if (status === 'READY') return 'تم الرفع — جاهز للعرض';
      if (status === 'FAILED') return 'تم الرفع — فشلت المعالجة';
      return 'تم الرفع — الخادم يجهّزه للويب…';
    }
    case 'error':
      return item.error ?? 'تعذّر الرفع';
  }
}

export function UploadRow({ item, compact = false, liveStatus }: { item: UploadItem; compact?: boolean; liveStatus?: VideoStatus }) {
  const progress = item.size > 0 ? item.uploaded / item.size : 0;
  const active = isActivePhase(item.phase);
  const canPause = item.phase === 'uploading' || item.phase === 'retrying' || item.phase === 'offline' || item.phase === 'starting' || item.phase === 'queued';
  const tone = item.phase === 'error' ? 'danger' : item.phase === 'done' ? 'success' : item.phase === 'paused' ? 'muted' : 'accent';

  return (
    <li className={cn('flex items-center gap-3', compact ? 'py-2.5' : 'py-3')}>
      <div
        className={cn(
          'relative grid shrink-0 place-items-center overflow-hidden rounded-lg border border-line bg-surface-3 text-muted',
          compact ? 'h-12 w-9' : 'h-14 w-10',
        )}
      >
        {item.posterPreview ? (
          <img src={item.posterPreview} alt="" className="absolute inset-0 size-full object-cover" />
        ) : (
          <FileVideo className="size-4" aria-hidden />
        )}
        {item.phase === 'done' && (
          <span className="absolute inset-0 grid place-items-center bg-black/45 text-success">
            <CircleCheck className="size-4" aria-hidden />
          </span>
        )}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <p className="truncate text-[0.8125rem] font-medium text-fg" title={item.fileName}>
            {item.title || item.fileName}
          </p>
          <span className="num tabular shrink-0 text-[0.6875rem] text-muted" dir="ltr">
            {item.phase === 'done' ? formatBytes(item.size) : `${Math.floor(progress * 100)}%`}
          </span>
        </div>
        <ProgressBar
          value={item.phase === 'done' ? 1 : progress}
          tone={tone}
          indeterminate={item.phase === 'finalizing' || item.phase === 'starting'}
          className="mt-1.5"
          label={`تقدم رفع ${item.fileName}`}
        />
        <div className="mt-1.5 flex items-center justify-between gap-2 text-[0.6875rem]">
          <span
            className={cn(
              'flex min-w-0 items-center gap-1 truncate',
              item.phase === 'error' ? 'text-danger' : item.phase === 'retrying' || item.phase === 'offline' ? 'text-warning' : 'text-muted',
            )}
          >
            {item.phase === 'error' && <CircleAlert className="size-3 shrink-0" aria-hidden />}
            {item.phase === 'offline' && <CloudOff className="size-3 shrink-0" aria-hidden />}
            {(item.phase === 'retrying' || item.phase === 'finalizing') && <LoaderCircle className="size-3 shrink-0 animate-spin" aria-hidden />}
            <span className="truncate">{phaseText(item, liveStatus)}</span>
          </span>
          {!compact && item.phase !== 'done' && (
            <span className="num tabular hidden shrink-0 text-subtle sm:inline" dir="ltr">
              {formatBytes(item.uploaded)} / {formatBytes(item.size)}
            </span>
          )}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-0.5">
        {canPause && (
          <IconButton label="إيقاف مؤقت" size="sm" onClick={() => uploads.pause(item.id)}>
            <Pause />
          </IconButton>
        )}
        {item.phase === 'paused' && (
          <IconButton label="استئناف" size="sm" onClick={() => uploads.resume(item.id)} className="text-accent">
            <Play />
          </IconButton>
        )}
        {item.phase === 'error' && !item.fatal && (
          <IconButton label="إعادة المحاولة" size="sm" onClick={() => uploads.resume(item.id)} className="text-accent">
            <RotateCcw />
          </IconButton>
        )}
        {item.phase === 'done' || item.phase === 'error' ? (
          item.phase === 'done' ? (
            <IconButton label="إخفاء" size="sm" onClick={() => uploads.dismiss(item.id)}>
              <X />
            </IconButton>
          ) : (
            <IconButton label="إلغاء الرفع وحذف الفيديو" size="sm" onClick={() => void uploads.cancel(item.id)}>
              <X />
            </IconButton>
          )
        ) : (
          <IconButton
            label="إلغاء الرفع"
            size="sm"
            onClick={() => void uploads.cancel(item.id)}
            disabled={item.phase === 'finalizing' && active}
          >
            <X />
          </IconButton>
        )}
      </div>
    </li>
  );
}

/** Overall progress across a set of uploads (bytes-weighted). */
export function summarize(items: UploadItem[]) {
  const pending = items.filter((i) => i.phase !== 'done');
  const total = pending.reduce((sum, i) => sum + i.size, 0);
  const sent = pending.reduce((sum, i) => sum + i.uploaded, 0);
  const speed = pending.reduce((sum, i) => sum + (i.phase === 'uploading' ? i.speed : 0), 0);
  return {
    pending: pending.length,
    done: items.length - pending.length,
    errors: items.filter((i) => i.phase === 'error').length,
    progress: total > 0 ? sent / total : 1,
    speed,
    eta: speed > 0 ? (total - sent) / speed : null,
  };
}
