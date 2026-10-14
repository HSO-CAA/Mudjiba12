import { useState } from 'react';
import { Link, useLocation } from 'react-router';
import { useQueries } from '@tanstack/react-query';
import type { AdminVideo, VideoStatus } from '@s5y/shared';
import { api } from '../../lib/endpoints';
import { ChevronDown, CloudUpload, CircleCheck, CircleAlert } from 'lucide-react';
import { cn } from '../../lib/cn';
import { formatEta, formatSpeed, formatVideoCount } from '../../lib/format';
import { uploads, type UploadItem } from '../../lib/uploads';
import { useUploads } from '../../hooks/useUploads';
import { summarize, UploadRow } from '../../features/videos/UploadQueue';

/** Server status of uploads that finished but are still being processed (the place page isn't there to poll). */
function useLiveStatuses(items: UploadItem[]): Map<string, VideoStatus> {
  const pending = items.filter((i) => i.phase === 'done' && i.videoId && i.result?.status === 'PROCESSING');
  const results = useQueries({
    queries: pending.map((item) => ({
      queryKey: ['upload-status', item.videoId],
      queryFn: () => api.videos.get(item.videoId as string),
      refetchInterval: (query: { state: { data?: AdminVideo } }) =>
        query.state.data?.status === 'READY' || query.state.data?.status === 'FAILED' ? false : 4000,
    })),
  });
  const map = new Map<string, VideoStatus>();
  results.forEach((r, i) => {
    if (r.data) map.set(pending[i].id, r.data.status);
  });
  return map;
}

/** Floating queue for uploads that keep running while the owner browses other pages. */
export function UploadTray() {
  const items = useUploads();
  const location = useLocation();
  const [open, setOpen] = useState(true);
  const live = useLiveStatuses(items);

  const placeMatch = /^\/places\/([^/]+)/.exec(location.pathname);
  const onPlacePage = placeMatch ? items.every((item) => item.placeId === placeMatch[1]) : false;
  if (items.length === 0 || onPlacePage) return null;

  const s = summarize(items);
  const placeId = items.find((i) => i.phase !== 'done')?.placeId ?? items[0].placeId;

  return (
    <section
      aria-label="الرفع الجاري"
      className="fixed bottom-[calc(var(--mobile-nav-h)+0.75rem)] end-3 z-30 w-[min(24rem,calc(100vw-1.5rem))] animate-pop-in overflow-hidden rounded-2xl border border-line-strong bg-surface-3/95 shadow-(--shadow-pop) backdrop-blur-md lg:bottom-5 lg:end-5"
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-3 px-4 py-3 text-start"
      >
        <span
          className={cn(
            'grid size-8 shrink-0 place-items-center rounded-lg',
            s.errors ? 'bg-danger/15 text-danger' : s.pending ? 'bg-accent/15 text-accent' : 'bg-success/15 text-success',
          )}
        >
          {s.errors ? <CircleAlert className="size-4" /> : s.pending ? <CloudUpload className="size-4" /> : <CircleCheck className="size-4" />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[0.8125rem] font-semibold">
            {s.pending ? `جاري رفع ${formatVideoCount(s.pending)}` : 'اكتمل الرفع'}
          </span>
          <span className="block text-[0.6875rem] text-muted">
            {s.pending ? (
              <>
                <span className="num" dir="ltr">
                  {Math.floor(s.progress * 100)}%
                </span>
                {s.speed > 0 && (
                  <>
                    {' · '}
                    <span className="num" dir="ltr">
                      {formatSpeed(s.speed)}
                    </span>
                  </>
                )}
                {' · '}باقي {formatEta(s.eta)}
              </>
            ) : (
              <>
                {`تم رفع ${formatVideoCount(s.done)}`}
              </>
            )}
          </span>
        </span>
        <ChevronDown className={cn('size-4 shrink-0 text-muted transition-transform', !open && 'rotate-180')} aria-hidden />
      </button>
      {s.pending > 0 && (
        <div className="h-0.5 bg-white/10">
          <div className="h-full bg-accent transition-[width] duration-700" style={{ width: `${s.progress * 100}%` }} />
        </div>
      )}
      {open && (
        <div className="border-t border-line">
          <ul className="max-h-72 divide-y divide-line overflow-y-auto px-4">
            {items.map((item) => (
              <UploadRow key={item.id} item={item} compact liveStatus={live.get(item.id)} />
            ))}
          </ul>
          <div className="flex items-center justify-between gap-2 border-t border-line px-4 py-2.5">
            <Link to={`/places/${placeId}`} className="text-xs font-medium text-accent hover:underline">
              افتح صفحة المكان
            </Link>
            {s.done > 0 && (
              <button type="button" onClick={() => uploads.clearFinished()} className="text-xs text-muted hover:text-fg">
                إخفاء المكتملة
              </button>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
