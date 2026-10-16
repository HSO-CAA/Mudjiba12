import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { CircleAlert, Clapperboard, Search, Store } from 'lucide-react';
import type { AdminVideoWithPlace, VideoStatus } from '@s5y/shared';
import { api } from '../../lib/endpoints';
import { qk } from '../../lib/query';
import { Button, ButtonLink } from '../../components/ui/button';
import { Input, Select } from '../../components/ui/form';
import { Card, EmptyState, Skeleton } from '../../components/ui/misc';
import { PageHeader } from '../../components/ui/page';
import { Segmented } from '../../components/ui/tabs';
import { useDebounced } from '../../hooks/useDebounced';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';
import { usePlaces } from '../places/hooks';
import { VideoCard } from './VideoCard';
import { useVideoActions } from './VideosManager';

type StatusFilter = 'all' | VideoStatus | 'featured' | 'hidden';

export default function VideosPage() {
  useDocumentTitle('الفيديوهات');
  const places = usePlaces();
  const [placeId, setPlaceId] = useState('');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [search, setSearch] = useState('');
  const q = useDebounced(search.trim().toLowerCase(), 200);
  const { actions, dialogs, queue } = useVideoActions();

  const videos = useQuery({
    queryKey: qk.videos({ placeId: placeId || undefined }),
    queryFn: () => api.videos.list({ placeId: placeId || undefined }),
    refetchInterval: (query) => (query.state.data?.some((v) => v.status === 'PROCESSING') ? 4000 : false),
  });

  const all = videos.data ?? [];
  const counts = useMemo(() => {
    const c = { all: all.length, READY: 0, PROCESSING: 0, FAILED: 0, UPLOADING: 0, featured: 0, hidden: 0 };
    for (const v of all) {
      c[v.status] += 1;
      if (v.featured) c.featured += 1;
      if (!v.published) c.hidden += 1;
    }
    return c;
  }, [all]);

  const filtered = useMemo(
    () =>
      all.filter((v: AdminVideoWithPlace) => {
        if (status === 'featured' && !v.featured) return false;
        if (status === 'hidden' && v.published) return false;
        if (status !== 'all' && status !== 'featured' && status !== 'hidden' && v.status !== status) return false;
        if (!q) return true;
        return [v.title, v.originalName, v.placeName, v.description].some((s) => s?.toLowerCase().includes(q));
      }),
    [all, status, q],
  );
  const byVideo = useMemo(() => new Map(queue.filter((i) => i.videoId).map((i) => [i.videoId as string, i])), [queue]);

  const statusItems: { value: StatusFilter; label: string; count: number }[] = [
    { value: 'all', label: 'الكل', count: counts.all },
    { value: 'READY', label: 'جاهز', count: counts.READY },
    { value: 'PROCESSING', label: 'قيد المعالجة', count: counts.PROCESSING },
    { value: 'FAILED', label: 'فشل', count: counts.FAILED },
    { value: 'UPLOADING', label: 'غير مكتمل', count: counts.UPLOADING },
    { value: 'featured', label: 'مميز', count: counts.featured },
    { value: 'hidden', label: 'مخفي', count: counts.hidden },
  ];

  return (
    <div>
      <PageHeader title="الفيديوهات" description="كل الفيديوهات من كل الأماكن. للرفع، افتح صفحة المكان." />

      <div className="mb-5 flex flex-col gap-3">
        <div className="flex flex-col gap-3 sm:flex-row">
          <Input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="ابحث بالعنوان أو اسم الملف…"
            start={<Search />}
            className="sm:max-w-sm sm:flex-1"
            aria-label="بحث بالفيديوهات"
          />
          <Select value={placeId} onChange={(e) => setPlaceId(e.target.value)} className="sm:w-60" aria-label="فلترة حسب المكان">
            <option value="">كل الأماكن</option>
            {(places.data ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </div>
        <div className="-mx-4 overflow-x-auto px-4 [scrollbar-width:none] sm:mx-0 sm:px-0">
          <Segmented
            label="الحالة"
            value={status}
            onChange={setStatus}
            items={statusItems.filter((i) => i.value === 'all' || i.count > 0 || i.value === status)}
            className="min-w-max"
          />
        </div>
      </div>

      {videos.isPending ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 md:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
          {Array.from({ length: 10 }, (_, i) => (
            <Skeleton key={i} className="aspect-[9/16] rounded-2xl" />
          ))}
        </div>
      ) : videos.isError ? (
        <Card>
          <EmptyState icon={<CircleAlert />} title="تعذّر تحميل الفيديوهات" description={videos.error.message} action={<Button onClick={() => void videos.refetch()}>إعادة المحاولة</Button>} />
        </Card>
      ) : all.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Clapperboard />}
            title="ماكو فيديوهات بعد"
            description="الفيديوهات تنرفع من صفحة كل مكان، حتى كل فيديو يكون مرتبط بالمكان مالته."
            action={
              <ButtonLink to="/places" variant="primary" icon={<Store />}>
                روح للأماكن
              </ButtonLink>
            }
          />
        </Card>
      ) : filtered.length === 0 ? (
        <Card>
          <EmptyState compact icon={<Search />} title="ماكو نتائج" description="غيّر الفلتر أو كلمة البحث." />
        </Card>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 md:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
          {filtered.map((video) => (
            <VideoCard
              key={video.id}
              video={video}
              upload={byVideo.get(video.id)}
              actions={actions}
              footer={
                <Link to={`/places/${video.placeId}`} className="truncate px-1 text-[0.6875rem] text-accent/90 hover:underline">
                  {video.placeName}
                </Link>
              }
            />
          ))}
        </div>
      )}

      {dialogs}
    </div>
  );
}
