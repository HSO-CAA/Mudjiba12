import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { ChevronRight, CircleAlert, Clapperboard, Ellipsis, ExternalLink, EyeOff, ImagePlus, MapPin, SlidersHorizontal, Star, Store, Trash2 } from 'lucide-react';
import type { AdminPlaceDetail } from '@s5y/shared';
import { ApiError } from '../../lib/api';
import { formatVideoCount } from '../../lib/format';
import { placeSiteUrl } from '../../lib/site';
import { Button, ButtonLink, buttonStyles, IconButton } from '../../components/ui/button';
import { useConfirm } from '../../components/ui/confirm';
import { Menu } from '../../components/ui/menu';
import { Badge, Callout, Card, EmptyState, Skeleton } from '../../components/ui/misc';
import { Tabs } from '../../components/ui/tabs';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';
import { VideosManager } from '../videos/VideosManager';
import { useDeletePlace, usePlace } from './hooks';
import { PlaceDetailsForm } from './PlaceDetailsForm';

type Tab = 'videos' | 'details';

export default function PlacePage() {
  const { placeId = '' } = useParams();
  const place = usePlace(placeId);
  useDocumentTitle(place.data?.name ?? 'المكان');

  if (place.isPending) return <PlaceSkeleton />;
  if (place.isError) {
    const missing = place.error instanceof ApiError && place.error.status === 404;
    return (
      <Card>
        <EmptyState
          icon={missing ? <Store /> : <CircleAlert />}
          title={missing ? 'المكان مو موجود' : 'تعذّر تحميل المكان'}
          description={missing ? 'يمكن انحذف. ارجع لقائمة الأماكن.' : place.error.message}
          action={
            <ButtonLink to="/places" variant="primary">
              كل الأماكن
            </ButtonLink>
          }
        />
      </Card>
    );
  }
  return <PlaceView place={place.data} />;
}

function PlaceView({ place }: { place: AdminPlaceDetail }) {
  const [params, setParams] = useSearchParams();
  const tab: Tab = params.get('tab') === 'details' ? 'details' : 'videos';
  const setTab = (next: Tab) => setParams(next === 'videos' ? {} : { tab: next }, { replace: true });
  const navigate = useNavigate();
  const confirm = useConfirm();
  const remove = useDeletePlace();
  const [coverBroken, setCoverBroken] = useState(false);
  const cover = coverBroken ? null : (place.coverUrl ?? place.thumbUrl);

  const onDelete = async () => {
    const ok = await confirm({
      title: `حذف «${place.name}»؟`,
      description: place.videoCount
        ? `راح تنحذف صفحة المكان ومعها ${formatVideoCount(place.videoCount)} وملفاتها نهائياً. ما تگدر ترجعها.`
        : 'راح تنحذف صفحة المكان نهائياً. ما تگدر ترجعها.',
      confirmLabel: 'احذف المكان',
    });
    if (!ok) return;
    remove.mutate(place.id, {
      onSuccess: () => {
        toast.success(`تم حذف «${place.name}»`);
        navigate('/places', { replace: true });
      },
    });
  };

  return (
    <div>
      <nav aria-label="مسار التنقل" className="mb-4">
        <Link to="/places" className="inline-flex items-center gap-1 rounded-md text-[0.8125rem] text-muted transition-colors hover:text-fg">
          <ChevronRight className="size-4" aria-hidden />
          الأماكن
        </Link>
      </nav>

      {/* Banner */}
      <div className="relative mb-6 overflow-hidden rounded-3xl border border-line bg-surface">
        <div className="relative h-36 sm:h-48">
          {cover ? (
            <img src={cover} alt="" className="absolute inset-0 size-full object-cover" onError={() => setCoverBroken(true)} />
          ) : (
            <div
              className="absolute inset-0"
              style={{ background: `radial-gradient(90% 120% at 85% 0%, ${place.accentColor}55, transparent 60%), linear-gradient(160deg, #1a1a1f, #0b0b0d)` }}
            />
          )}
          <div className="absolute inset-0 bg-linear-to-t from-surface via-surface/40 to-transparent" />
          <div className="hud absolute end-4 top-4 hidden items-center gap-2 normal-case text-white/70 sm:flex" dir="ltr">
            <span className="size-1.5 rounded-full" style={{ background: place.accentColor }} />
            /work/{place.slug}
          </div>
          {!place.coverUrl && (
            <button
              type="button"
              onClick={() => setTab('details')}
              className="absolute start-4 top-4 inline-flex items-center gap-1.5 rounded-lg bg-black/45 px-2.5 py-1.5 text-xs text-white/85 backdrop-blur hover:bg-black/60"
            >
              <ImagePlus className="size-3.5" aria-hidden /> أضف صورة غلاف
            </button>
          )}
        </div>
        <div className="relative -mt-12 flex flex-col gap-4 px-5 pb-5 sm:-mt-14 sm:flex-row sm:items-end sm:px-7 sm:pb-6">
          <span
            className="grid size-20 shrink-0 place-items-center overflow-hidden rounded-2xl border-4 border-surface text-2xl font-bold text-white shadow-xl sm:size-24"
            style={{ background: place.logoUrl ? '#111114' : place.accentColor }}
          >
            {place.logoUrl ? <img src={place.logoUrl} alt="" className="size-full object-contain p-2" /> : place.name.trim().charAt(0)}
          </span>
          <div className="min-w-0 flex-1">
            <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
              {place.published ? (
                <Badge tone="success" dot>
                  منشور
                </Badge>
              ) : (
                <Badge tone="neutral" icon={<EyeOff />}>
                  مخفي
                </Badge>
              )}
              {place.featured && (
                <Badge tone="accent" icon={<Star className="fill-current" />}>
                  مميز
                </Badge>
              )}
            </div>
            <h1 className="truncate text-2xl font-bold leading-tight sm:text-[1.75rem]">{place.name}</h1>
            <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.8125rem] text-muted">
              {place.category && <span>{place.category}</span>}
              {place.location && (
                <span className="inline-flex items-center gap-1">
                  <MapPin className="size-3.5" aria-hidden />
                  {place.location}
                </span>
              )}
              <span className="inline-flex items-center gap-1">
                <Clapperboard className="size-3.5" aria-hidden />
                <span className="num">{place.readyCount}</span> جاهز من <span className="num">{place.videoCount}</span>
              </span>
            </p>
          </div>
          <div className="flex items-center gap-2">
            <a
              href={placeSiteUrl(place.slug)}
              target="_blank"
              rel="noopener"
              className={buttonStyles({ variant: 'secondary', className: 'flex-1 sm:flex-none' })}
              title={place.published ? undefined : 'المكان مخفي حالياً، الصفحة ما تنفتح للزوار'}
            >
              <ExternalLink />
              عرض بالموقع
            </a>
            <Menu
              trigger={(props) => (
                <IconButton label="خيارات المكان" variant="secondary" {...props}>
                  <Ellipsis />
                </IconButton>
              )}
              items={[
                { label: 'تعديل التفاصيل', icon: <SlidersHorizontal />, onSelect: () => setTab('details') },
                { label: 'حذف المكان', icon: <Trash2 />, tone: 'danger', separated: true, onSelect: () => void onDelete() },
              ]}
            />
          </div>
        </div>
      </div>

      {!place.published && (
        <Callout tone="neutral" icon={<EyeOff />} className="mb-5" action={<Button size="sm" variant="secondary" onClick={() => setTab('details')}>الإعدادات</Button>}>
          هذا المكان مخفي عن الزوار. فعّل «منشور بالموقع» من التفاصيل لمن تكون جاهز.
        </Callout>
      )}

      <Tabs
        label="أقسام المكان"
        value={tab}
        onChange={setTab}
        className="mb-5"
        items={[
          { value: 'videos', label: 'الفيديوهات', icon: <Clapperboard />, count: place.videoCount },
          { value: 'details', label: 'التفاصيل والصور', icon: <SlidersHorizontal /> },
        ]}
      />

      {tab === 'videos' && (
        <div role="tabpanel">
          <VideosManager place={place} />
        </div>
      )}
      {/* Kept mounted so unsaved edits (and the save bar) survive switching tabs. */}
      <div role="tabpanel" hidden={tab !== 'details'}>
        <PlaceDetailsForm place={place} />
      </div>
    </div>
  );
}

function PlaceSkeleton() {
  return (
    <div>
      <Skeleton className="mb-4 h-4 w-20" />
      <div className="mb-6 overflow-hidden rounded-3xl border border-line bg-surface">
        <Skeleton className="h-36 rounded-none sm:h-48" />
        <div className="flex items-end gap-4 px-7 pb-6">
          <Skeleton className="-mt-10 size-24 rounded-2xl" />
          <div className="flex-1">
            <Skeleton className="h-7 w-48" />
            <Skeleton className="mt-2 h-4 w-64" />
          </div>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5">
        {Array.from({ length: 5 }, (_, i) => (
          <Skeleton key={i} className="aspect-[9/16] rounded-2xl" />
        ))}
      </div>
    </div>
  );
}
