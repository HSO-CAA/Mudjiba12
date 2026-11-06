import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Camera, ChevronLeft, ChevronRight, ImageUp, Pause, Play } from 'lucide-react';
import type { AdminVideo } from '@s5y/shared';
import { errorMessage } from '../../lib/api';
import { captureFrame } from '../../lib/media';
import { isCrossOrigin } from '../../lib/site';
import { IMAGE_ACCEPT, uploadImage, validateImageFile } from '../../lib/upload-image';
import { Button, IconButton } from '../../components/ui/button';
import { Dialog } from '../../components/ui/dialog';
import { Spinner } from '../../components/ui/misc';
import { useUpdateVideo } from './hooks';

const FPS = 24;

function timecode(seconds: number): string {
  const total = Math.max(0, seconds);
  const frames = Math.floor((total % 1) * FPS);
  const s = Math.floor(total) % 60;
  const m = Math.floor(total / 60);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(m)}:${p(s)}:${p(frames)}`;
}

/** Scrub the video and use the current frame as its poster (captured on a canvas, uploaded as an image). */
export function PosterPicker({ video, onClose }: { video: AdminVideo | null; onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const update = useUpdateVideo();
  const [duration, setDuration] = useState(0);
  const [time, setTime] = useState(0);
  const [ready, setReady] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [saving, setSaving] = useState<'frame' | 'file' | null>(null);

  useEffect(() => {
    setReady(false);
    setTime(0);
    setDuration(0);
    setPlaying(false);
  }, [video?.id]);

  const seek = (t: number) => {
    const el = videoRef.current;
    if (!el) return;
    const next = Math.max(0, Math.min(duration || el.duration || 0, t));
    el.currentTime = next;
    setTime(next);
  };

  const save = async (blob: Blob, kind: 'frame' | 'file') => {
    if (!video) return;
    setSaving(kind);
    try {
      const image = await uploadImage(blob, { fileName: kind === 'frame' ? 'poster.jpg' : undefined });
      await update.mutateAsync({ id: video.id, input: { posterKey: image.key }, placeId: video.placeId });
      toast.success('تم تحديث صورة الغلاف');
      onClose();
    } catch (error) {
      toast.error(errorMessage(error, 'تعذّر حفظ الغلاف'));
    } finally {
      setSaving(null);
    }
  };

  const applyFrame = async () => {
    const el = videoRef.current;
    if (!el) return;
    el.pause();
    try {
      const blob = await captureFrame(el);
      await save(blob, 'frame');
    } catch {
      toast.error('ما گدرنا ناخذ لقطة من الفيديو', { description: 'إذا الفيديوهات على تخزين خارجي، فعّل CORS عليه. أو ارفع صورة بدلها.' });
    }
  };

  const url = video?.url ?? null;

  return (
    <Dialog
      open={video !== null}
      onClose={() => !saving && onClose()}
      dismissible={!saving}
      title="صورة الغلاف"
      description="حرّك المؤشر لحد ما تلگه اللقطة اللي تعجبك، وبعدين اضغط «استخدم هذا الإطار»."
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={() => fileRef.current?.click()} icon={<ImageUp />} loading={saving === 'file'} disabled={saving !== null}>
            رفع صورة بدلها
          </Button>
          <Button variant="primary" onClick={() => void applyFrame()} icon={<Camera />} loading={saving === 'frame'} disabled={!ready || saving !== null}>
            استخدم هذا الإطار
          </Button>
        </>
      }
    >
      <input
        ref={fileRef}
        type="file"
        accept={IMAGE_ACCEPT}
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (!file) return;
          const problem = validateImageFile(file);
          if (problem) toast.error(problem);
          else void save(file, 'file');
        }}
      />
      {url ? (
        <div className="flex flex-col gap-4">
          <div className="relative mx-auto grid w-full max-w-[19rem] place-items-center overflow-hidden rounded-2xl bg-black" style={{ aspectRatio: video?.width && video.height ? `${video.width} / ${video.height}` : '9 / 16' }}>
            <video
              ref={videoRef}
              src={url}
              muted
              playsInline
              preload="auto"
              crossOrigin={isCrossOrigin(url) ? 'anonymous' : undefined}
              className="size-full object-contain"
              onLoadedMetadata={(event) => {
                const el = event.currentTarget;
                setDuration(Number.isFinite(el.duration) ? el.duration : 0);
                const start = Math.min(1, (el.duration || 0) / 2);
                el.currentTime = start;
                setTime(start);
              }}
              onLoadedData={() => setReady(true)}
              onTimeUpdate={(event) => setTime(event.currentTarget.currentTime)}
              onPlay={() => setPlaying(true)}
              onPause={() => setPlaying(false)}
            />
            {!ready && (
              <div className="absolute inset-0 grid place-items-center">
                <Spinner />
              </div>
            )}
            <span className="hud pointer-events-none absolute end-2.5 top-2.5 rounded bg-black/55 px-1.5 py-0.5 text-white/85" dir="ltr">
              {timecode(time)}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <IconButton label="الإطار السابق" size="sm" variant="secondary" onClick={() => seek(time - 1 / FPS)} disabled={!ready}>
              <ChevronRight />
            </IconButton>
            <input
              type="range"
              min={0}
              max={duration || 0}
              step={1 / FPS}
              value={time}
              disabled={!ready}
              onChange={(event) => seek(Number(event.target.value))}
              className="h-8 min-w-0 flex-1 cursor-pointer"
              aria-label="موضع اللقطة"
            />
            <IconButton label="الإطار التالي" size="sm" variant="secondary" onClick={() => seek(time + 1 / FPS)} disabled={!ready}>
              <ChevronLeft />
            </IconButton>
            <IconButton
              label={playing ? 'إيقاف' : 'تشغيل'}
              size="sm"
              variant="secondary"
              disabled={!ready}
              onClick={() => {
                const el = videoRef.current;
                if (!el) return;
                if (el.paused) void el.play();
                else el.pause();
              }}
            >
              {playing ? <Pause /> : <Play />}
            </IconButton>
          </div>
        </div>
      ) : (
        <p className="py-8 text-center text-sm text-muted">الفيديو بعده ما خلص رفع، فما نگدر ناخذ منه لقطة. تگدر ترفع صورة بدلها.</p>
      )}
    </Dialog>
  );
}
