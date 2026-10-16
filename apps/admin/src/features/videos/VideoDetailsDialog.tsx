import { useEffect, useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { Eye, Star } from 'lucide-react';
import type { AdminVideo, VideoUpdateInput } from '@s5y/shared';
import { ApiError } from '../../lib/api';
import { formatBytes, formatDate, formatDuration, formatNumber } from '../../lib/format';
import { Button } from '../../components/ui/button';
import { Dialog } from '../../components/ui/dialog';
import { Counter, Field, Input, Select, SwitchRow, Textarea } from '../../components/ui/form';
import { usePlaces } from '../places/hooks';
import { useUpdateVideo } from './hooks';
import { VideoStatusBadge, VideoThumb } from './VideoThumb';

export function VideoDetailsDialog({ video, onClose }: { video: AdminVideo | null; onClose: () => void }) {
  const update = useUpdateVideo();
  const places = usePlaces();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [placeId, setPlaceId] = useState('');
  const [featured, setFeatured] = useState(false);
  const [published, setPublished] = useState(true);

  useEffect(() => {
    if (!video) return;
    setTitle(video.title ?? '');
    setDescription(video.description ?? '');
    setPlaceId(video.placeId);
    setFeatured(video.featured);
    setPublished(video.published);
    update.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset only when another video opens
  }, [video?.id]);

  const fields = update.error instanceof ApiError ? update.error.fieldErrors : {};

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!video) return;
    const input: VideoUpdateInput = {};
    if (title.trim() !== (video.title ?? '')) input.title = title.trim() || null;
    if (description.trim() !== (video.description ?? '')) input.description = description.trim() || null;
    if (placeId !== video.placeId) input.placeId = placeId;
    if (featured !== video.featured) input.featured = featured;
    if (published !== video.published) input.published = published;
    if (Object.keys(input).length === 0) {
      onClose();
      return;
    }
    update.mutate(
      { id: video.id, input, placeId: video.placeId },
      {
        onSuccess: () => {
          const moved = input.placeId ? places.data?.find((p) => p.id === input.placeId)?.name : null;
          toast.success(moved ? `انتقل الفيديو إلى «${moved}»` : 'تم حفظ الفيديو');
          onClose();
        },
      },
    );
  };

  return (
    <Dialog
      open={video !== null}
      onClose={onClose}
      title="تفاصيل الفيديو"
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            إلغاء
          </Button>
          <Button variant="primary" type="submit" form="video-details" loading={update.isPending}>
            حفظ
          </Button>
        </>
      }
    >
      {video && (
        <form id="video-details" onSubmit={onSubmit} className="flex flex-col gap-4">
          <div className="flex items-center gap-3 rounded-xl border border-line bg-surface-2/60 p-3">
            <VideoThumb video={video} className="h-16 w-9 rounded-md" />
            <div className="min-w-0 flex-1 text-xs text-muted">
              <p className="truncate text-[0.8125rem] font-medium text-fg-2" dir="auto">
                {video.originalName ?? 'ملف بدون اسم'}
              </p>
              <p className="num mt-1" dir="ltr">
                {[video.width && video.height ? `${video.width}×${video.height}` : null, formatDuration(video.durationSec), formatBytes(video.sizeBytes)]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
              <p className="mt-1">
                أُضيف {formatDate(video.createdAt)} · <span className="num">{formatNumber(video.plays)}</span> تشغيل
              </p>
            </div>
            <VideoStatusBadge status={video.status} />
          </div>

          <Field label="العنوان" error={fields.title} aside={<Counter value={title} max={150} />}>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={150} placeholder="مثلاً: افتتاح الفرع الجديد" />
          </Field>
          <Field label="الوصف" hint="اختياري — يظهر تحت الفيديو بالمشغّل." error={fields.description} aside={<Counter value={description} max={2000} />}>
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} maxLength={2000} />
          </Field>
          <Field label="المكان" hint="انقل الفيديو لمكان ثاني إذا رفعته بالغلط." error={fields.placeId}>
            <Select value={placeId} onChange={(e) => setPlaceId(e.target.value)}>
              {(places.data ?? []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
              {!places.data?.some((p) => p.id === placeId) && <option value={placeId}>المكان الحالي</option>}
            </Select>
          </Field>
          <div className="divide-y divide-line rounded-xl border border-line px-4">
            <SwitchRow icon={<Eye />} title="ظاهر بالموقع" description="لمن تطفيه، يبقى الفيديو باللوحة بس ما ينعرض للزوار." checked={published} onChange={setPublished} />
            <SwitchRow icon={<Star />} title="فيديو مميز" description="المميزة تطلع بشريط «الشوريل» وبشاشات الواجهة." checked={featured} onChange={setFeatured} />
          </div>
        </form>
      )}
    </Dialog>
  );
}
