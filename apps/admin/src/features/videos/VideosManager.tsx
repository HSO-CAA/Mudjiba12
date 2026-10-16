import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { CloudUpload, Film, Info, Upload } from 'lucide-react';
import type { AdminPlaceDetail, AdminVideo } from '@s5y/shared';
import { cn } from '../../lib/cn';
import { formatVideoCount } from '../../lib/format';
import { VIDEO_ACCEPT } from '../../lib/media';
import { uploads } from '../../lib/uploads';
import { Button } from '../../components/ui/button';
import { useConfirm } from '../../components/ui/confirm';
import { Card, EmptyState } from '../../components/ui/misc';
import { DragHandle, Sortable } from '../../components/ui/sortable';
import { useUploads } from '../../hooks/useUploads';
import { useDeleteVideo, useReorderVideos, useReprocessVideo } from './hooks';
import { PosterPicker } from './PosterPicker';
import { summarize, UploadRow } from './UploadQueue';
import { VideoCard, type VideoCardActions } from './VideoCard';
import { VideoDetailsDialog } from './VideoDetailsDialog';
import { VideoPlayerDialog } from './VideoPlayerDialog';

/** Hook: shared dialogs + actions for video cards (used by the place page and the all-videos page). */
export function useVideoActions() {
  const confirm = useConfirm();
  const remove = useDeleteVideo();
  const reprocess = useReprocessVideo();
  const queue = useUploads();
  const [playing, setPlaying] = useState<AdminVideo | null>(null);
  const [details, setDetails] = useState<AdminVideo | null>(null);
  const [poster, setPoster] = useState<AdminVideo | null>(null);
  const resumeTarget = useRef<AdminVideo | null>(null);
  const resumeInput = useRef<HTMLInputElement>(null);

  const actions: VideoCardActions = {
    onPlay: setPlaying,
    onDetails: setDetails,
    onPoster: setPoster,
    onReprocess: (video) =>
      reprocess.mutate(video.id, { onSuccess: () => toast.success('بدأت إعادة معالجة الفيديو', { description: 'راح يتحدث تلقائياً لمن يجهز.' }) }),
    onDelete: async (video) => {
      const ok = await confirm({
        title: 'حذف الفيديو؟',
        description: `راح ينحذف «${video.title || video.originalName || 'الفيديو'}» وكل ملفاته نهائياً.`,
        confirmLabel: 'احذف الفيديو',
      });
      if (!ok) return;
      const local = queue.find((item) => item.videoId === video.id && item.phase !== 'done');
      if (local) {
        await uploads.cancel(local.id);
        toast.success('تم إلغاء الرفع وحذف الفيديو');
        return;
      }
      remove.mutate(video, { onSuccess: () => toast.success('تم حذف الفيديو') });
    },
    onResume: (video) => {
      resumeTarget.current = video;
      resumeInput.current?.click();
    },
  };

  const dialogs = (
    <>
      <input
        ref={resumeInput}
        type="file"
        accept={VIDEO_ACCEPT}
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          const video = resumeTarget.current;
          if (!file || !video) return;
          const problem = uploads.resumeExisting(video, file);
          if (problem) toast.error(problem);
          else toast.success('يكمل الرفع من آخر نقطة وصلها');
        }}
      />
      <VideoPlayerDialog video={playing} onClose={() => setPlaying(null)} />
      <VideoDetailsDialog video={details} onClose={() => setDetails(null)} />
      <PosterPicker video={poster} onClose={() => setPoster(null)} />
    </>
  );

  return { actions, dialogs, queue };
}

/** Full-window drop target while files are dragged over the page. */
function useWindowFileDrag(onFiles: (files: File[]) => void) {
  const [active, setActive] = useState(false);
  const depth = useRef(0);
  const onFilesRef = useRef(onFiles);
  onFilesRef.current = onFiles;

  useEffect(() => {
    const hasFiles = (event: DragEvent) => Array.from(event.dataTransfer?.types ?? []).includes('Files');
    const onEnter = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      depth.current += 1;
      setActive(true);
    };
    const onLeave = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      depth.current = Math.max(0, depth.current - 1);
      if (depth.current === 0) setActive(false);
    };
    const onOver = (event: DragEvent) => {
      if (hasFiles(event)) event.preventDefault();
    };
    const onDrop = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      depth.current = 0;
      setActive(false);
      // A nested drop zone (e.g. an image uploader) already handled it.
      if (event.defaultPrevented) return;
      event.preventDefault();
      const files = Array.from(event.dataTransfer?.files ?? []);
      if (files.length) onFilesRef.current(files);
    };
    window.addEventListener('dragenter', onEnter);
    window.addEventListener('dragleave', onLeave);
    window.addEventListener('dragover', onOver);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragenter', onEnter);
      window.removeEventListener('dragleave', onLeave);
      window.removeEventListener('dragover', onOver);
      window.removeEventListener('drop', onDrop);
    };
  }, []);

  return active;
}

export function VideosManager({ place }: { place: AdminPlaceDetail }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const reorder = useReorderVideos(place.id);
  const { actions, dialogs, queue: allUploads } = useVideoActions();
  const queue = useMemo(() => allUploads.filter((item) => item.placeId === place.id), [allUploads, place.id]);
  const byVideo = useMemo(() => new Map(queue.filter((i) => i.videoId).map((i) => [i.videoId as string, i])), [queue]);
  const summary = summarize(queue);

  const addFiles = (files: File[]) => {
    const added = uploads.add(place.id, files);
    if (added > 0) toast.message(`بدأ رفع ${formatVideoCount(added)}`, { description: 'تگدر تكمل شغلك، الرفع يستمر بالخلفية.' });
  };
  const draggingFiles = useWindowFileDrag(addFiles);

  // On a phone the queue sits below the banner: bring it into view when new files are added.
  const queueRef = useRef<HTMLDivElement>(null);
  const queued = useRef(queue.length);
  useEffect(() => {
    const grew = queue.length > queued.current;
    queued.current = queue.length;
    if (!grew) return;
    const el = queueRef.current;
    if (!el) return;
    const { top, bottom } = el.getBoundingClientRect();
    if (top < 0 || bottom > window.innerHeight) {
      const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'center' });
    }
  }, [queue.length]);
  const videos = place.videos;
  const featured = videos.filter((v) => v.featured).length;

  const picker = (
    <input
      ref={inputRef}
      type="file"
      multiple
      accept={VIDEO_ACCEPT}
      className="sr-only"
      aria-label="اختيار فيديوهات للرفع"
      data-testid="video-input"
      onChange={(event) => {
        const files = Array.from(event.target.files ?? []);
        event.target.value = '';
        if (files.length) addFiles(files);
      }}
    />
  );

  return (
    <section className="flex flex-col gap-5" aria-label="الفيديوهات">
      {picker}

      {videos.length === 0 && queue.length === 0 ? (
        <Card className="border-dashed border-line-strong bg-surface/60">
          <EmptyState
            icon={<CloudUpload />}
            title="ارفع فيديوهات هذا المكان"
            description="اسحب الفيديوهات هنا أو اختارها من جهازك. تگدر تختار أكثر من فيديو مرة وحدة، والرفع يكمل من نفس النقطة إذا انقطع النت."
            action={
              <Button variant="primary" size="lg" icon={<Upload />} onClick={() => inputRef.current?.click()}>
                اختار فيديوهات
              </Button>
            }
          />
          <p className="num -mt-8 pb-8 text-center text-[0.6875rem] text-subtle" dir="ltr">
            MP4 · MOV · WebM · MKV · M4V — up to 2 GB each
          </p>
        </Card>
      ) : (
        <div className="flex flex-col gap-3 rounded-2xl border border-dashed border-line-strong bg-surface/50 p-3 sm:flex-row sm:items-center sm:p-4">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-accent/12 text-accent">
              <CloudUpload className="size-5" aria-hidden />
            </span>
            <div className="min-w-0">
              <p className="text-sm font-medium">أضف فيديوهات</p>
              <p className="truncate text-xs text-muted">اسحبها لأي مكان بالصفحة أو اختارها — الرفع يكمل بالخلفية.</p>
            </div>
          </div>
          <Button variant="primary" icon={<Upload />} onClick={() => inputRef.current?.click()} className="w-full sm:w-auto">
            اختار فيديوهات
          </Button>
        </div>
      )}

      {queue.length > 0 && (
        <div ref={queueRef} className="scroll-mt-20">
          <Card>
            <div className="flex items-center justify-between gap-3 px-4 pt-3.5 sm:px-5">
              <h3 className="text-sm font-semibold">
                قائمة الرفع{' '}
                {summary.pending > 0 && (
                  <span className="text-xs font-normal text-muted">
                    ·{' '}
                    <span className="num" dir="ltr">
                      {Math.floor(summary.progress * 100)}%
                    </span>
                  </span>
                )}
              </h3>
              {summary.done > 0 && (
                <button type="button" onClick={() => uploads.clearFinished(place.id)} className="text-xs text-muted hover:text-fg">
                  إخفاء المكتملة
                </button>
              )}
            </div>
            <ul className="divide-y divide-line px-4 pb-1 sm:px-5" aria-live="polite">
              {queue.map((item) => (
                <UploadRow key={item.id} item={item} liveStatus={videos.find((v) => v.id === item.videoId)?.status} />
              ))}
            </ul>
          </Card>
        </div>
      )}

      {videos.length > 0 && (
        <div>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <p className="text-[0.8125rem] text-muted">
              <span className="num text-fg-2">{videos.length}</span> فيديو · <span className="num text-fg-2">{featured}</span> مميز
            </p>
            <p className="flex items-center gap-1.5 text-xs text-subtle">
              <Info className="size-3.5" aria-hidden /> اسحب المقبض حتى ترتّب ظهورها بالموقع
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 md:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
            <Sortable items={videos} onReorder={(next) => reorder.mutate(next.map((v) => v.id))}>
              {(video, props) => (
                <div ref={props.setNodeRef} style={props.style}>
                  <VideoCard
                    video={video}
                    upload={byVideo.get(video.id)}
                    dragging={props.isDragging}
                    actions={actions}
                    handle={<DragHandle handle={props.handle} className="bg-black/40 text-white/80 backdrop-blur hover:bg-black/60 hover:text-white" />}
                  />
                </div>
              )}
            </Sortable>
          </div>
        </div>
      )}

      {draggingFiles && (
        <div className="pointer-events-none fixed inset-0 z-50 grid animate-fade-in place-items-center bg-black/70 p-6 backdrop-blur-sm">
          <div className="viewfinder flex flex-col items-center gap-3 rounded-3xl border-2 border-dashed border-accent/70 bg-surface/80 px-12 py-10 text-center">
            <Film className="size-8 text-accent" aria-hidden />
            <p className="text-lg font-semibold">أفلت الفيديوهات هنا</p>
            <p className={cn('text-sm text-muted')}>راح تنرفع إلى «{place.name}»</p>
          </div>
        </div>
      )}

      {dialogs}
    </section>
  );
}
