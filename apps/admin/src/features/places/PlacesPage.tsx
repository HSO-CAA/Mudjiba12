import { useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router';
import { toast } from 'sonner';
import { CalendarDays, CircleAlert, Clapperboard, EyeOff, Plus, Search, Star, Store } from 'lucide-react';
import type { AdminPlace } from '@s5y/shared';
import { ApiError } from '../../lib/api';
import { cn } from '../../lib/cn';
import { formatNumber } from '../../lib/format';
import { Button, IconButton } from '../../components/ui/button';
import { Dialog } from '../../components/ui/dialog';
import { Field, Input, Switch, SwitchRow } from '../../components/ui/form';
import { Card, EmptyState, Skeleton } from '../../components/ui/misc';
import { PageHeader } from '../../components/ui/page';
import { DragHandle, Sortable } from '../../components/ui/sortable';
import { Segmented } from '../../components/ui/tabs';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';
import { useCreatePlace, usePlaces, useReorderPlaces, useUpdatePlace } from './hooks';

type Filter = 'all' | 'published' | 'hidden';

export default function PlacesPage() {
  useDocumentTitle('الأماكن');
  const places = usePlaces();
  const reorder = useReorderPlaces();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [creating, setCreating] = useState(false);

  const list = places.data ?? [];
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return list.filter((p) => {
      if (filter === 'published' && !p.published) return false;
      if (filter === 'hidden' && p.published) return false;
      if (!q) return true;
      return [p.name, p.category, p.location, p.slug].some((v) => v?.toLowerCase().includes(q));
    });
  }, [list, query, filter]);
  const sortingDisabled = filtered.length !== list.length;
  const counts = { all: list.length, published: list.filter((p) => p.published).length, hidden: list.filter((p) => !p.published).length };

  return (
    <div>
      <PageHeader
        title="الأماكن"
        description="كل مكان اشتغلت وياه إله صفحة خاصة بالموقع بيها فيديوهاته. اسحب البطاقات حتى ترتّب ظهورها."
        actions={
          <Button variant="primary" icon={<Plus />} onClick={() => setCreating(true)}>
            مكان جديد
          </Button>
        }
      />

      {places.isPending ? (
        <PlacesSkeleton />
      ) : places.isError ? (
        <Card>
          <EmptyState icon={<CircleAlert />} title="تعذّر تحميل الأماكن" description={places.error.message} action={<Button onClick={() => void places.refetch()}>إعادة المحاولة</Button>} />
        </Card>
      ) : list.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Store />}
            title="ابدأ بأول مكان"
            description="أضف المطعم أو الكافيه أو البراند اللي صوّرت له، وبعدها ارفع فيديوهاته من صفحته."
            action={
              <Button variant="primary" icon={<Plus />} onClick={() => setCreating(true)}>
                أضف مكان
              </Button>
            }
          />
        </Card>
      ) : (
        <>
          <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center">
            <Input
              type="search"
              placeholder="ابحث بالاسم أو النوع أو المدينة…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              start={<Search />}
              className="sm:max-w-sm sm:flex-1"
              aria-label="بحث بالأماكن"
            />
            <Segmented
              label="فلترة"
              value={filter}
              onChange={setFilter}
              items={[
                { value: 'all', label: 'الكل', count: counts.all },
                { value: 'published', label: 'منشور', count: counts.published },
                { value: 'hidden', label: 'مخفي', count: counts.hidden },
              ]}
            />
            {sortingDisabled && <p className="text-xs text-subtle sm:ms-auto">الترتيب بالسحب متاح لمن تشيل البحث والفلترة.</p>}
          </div>

          {filtered.length === 0 ? (
            <Card>
              <EmptyState compact icon={<Search />} title="ماكو نتائج" description="جرّب كلمة ثانية." />
            </Card>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
              <Sortable items={filtered} onReorder={(next) => reorder.mutate(next.map((p) => p.id))} disabled={sortingDisabled}>
                {(place, props) => (
                  <div ref={props.setNodeRef} style={props.style} className={cn(props.isDragging && 'opacity-90')}>
                    <PlaceCard place={place} handle={<DragHandle handle={props.handle} disabled={sortingDisabled} className="bg-black/45 text-white/80 backdrop-blur hover:bg-black/60 hover:text-white" />} dragging={props.isDragging} />
                  </div>
                )}
              </Sortable>
            </div>
          )}
        </>
      )}

      <CreatePlaceDialog open={creating} onClose={() => setCreating(false)} />
    </div>
  );
}

function PlaceCard({ place, handle, dragging }: { place: AdminPlace; handle: ReactNode; dragging: boolean }) {
  const update = useUpdatePlace();
  const image = place.coverUrl ?? place.thumbUrl;
  const [broken, setBroken] = useState(false);

  return (
    <article
      className={cn(
        'group relative flex h-full flex-col overflow-hidden rounded-2xl border border-line bg-surface transition-[border-color,box-shadow,transform] duration-200',
        dragging ? 'scale-[1.02] border-accent/50 shadow-(--shadow-pop)' : 'hover:border-line-strong',
      )}
    >
      <Link to={`/places/${place.id}`} className="relative block aspect-[16/10] overflow-hidden bg-surface-2" aria-label={`فتح ${place.name}`}>
        {image && !broken ? (
          <img
            src={image}
            alt=""
            loading="lazy"
            onError={() => setBroken(true)}
            className="absolute inset-0 size-full object-cover transition-transform duration-700 ease-(--ease-cine) group-hover:scale-[1.04]"
          />
        ) : (
          <div
            className="absolute inset-0"
            style={{ background: `radial-gradient(120% 90% at 80% 10%, ${place.accentColor}40, transparent 60%), linear-gradient(160deg, #1b1b20, #0c0c0e)` }}
          />
        )}
        <div className="absolute inset-0 bg-linear-to-t from-black/85 via-black/20 to-black/10" />
        <div className="absolute inset-x-0 bottom-0 flex items-end gap-3 p-4">
          <span
            className="grid size-11 shrink-0 place-items-center overflow-hidden rounded-xl border border-white/15 text-sm font-bold text-white shadow-lg"
            style={{ background: place.logoUrl ? '#0e0e11' : place.accentColor }}
          >
            {place.logoUrl ? <img src={place.logoUrl} alt="" className="size-full object-contain p-1" /> : place.name.trim().charAt(0)}
          </span>
          <div className="min-w-0">
            <h3 className="truncate text-base font-bold text-white">{place.name}</h3>
            <p className="truncate text-xs text-white/70">{[place.category, place.location].filter(Boolean).join(' · ') || 'بدون تصنيف'}</p>
          </div>
        </div>
        {!place.published && (
          <span className="absolute end-3 top-3 inline-flex h-6 items-center gap-1 rounded-full bg-black/60 px-2 text-[0.6875rem] font-medium text-white/85 backdrop-blur">
            <EyeOff className="size-3" aria-hidden /> مخفي
          </span>
        )}
      </Link>

      <div className="absolute start-3 top-3 flex items-center gap-1.5">
        {handle}
        <IconButton
          label={place.featured ? 'إلغاء التمييز' : 'تمييز المكان'}
          size="sm"
          aria-pressed={place.featured}
          onClick={() => update.mutate({ id: place.id, input: { featured: !place.featured } })}
          className={cn('bg-black/45 backdrop-blur hover:bg-black/60', place.featured ? 'text-accent hover:text-accent' : 'text-white/80 hover:text-white')}
        >
          <Star className={cn(place.featured && 'fill-current')} />
        </IconButton>
      </div>

      <div className="flex items-center gap-3 px-4 py-3">
        <div className="flex min-w-0 flex-1 items-center gap-3 text-xs text-muted">
          <span className="inline-flex items-center gap-1" title="الفيديوهات الجاهزة / الكل">
            <Clapperboard className="size-3.5" aria-hidden />
            <span className="num tabular text-fg-2">{formatNumber(place.readyCount)}</span>
            {place.videoCount !== place.readyCount && <span className="num tabular">/ {formatNumber(place.videoCount)}</span>}
            <span>فيديو</span>
          </span>
          {place.year && (
            <span className="inline-flex items-center gap-1">
              <CalendarDays className="size-3.5" aria-hidden />
              <span className="num">{place.year}</span>
            </span>
          )}
        </div>
        <label className="flex items-center gap-2 text-xs text-muted">
          {place.published ? 'منشور' : 'مخفي'}
          <Switch
            size="sm"
            checked={place.published}
            label={place.published ? 'إخفاء المكان من الموقع' : 'نشر المكان بالموقع'}
            onChange={(published) =>
              update.mutate(
                { id: place.id, input: { published } },
                { onSuccess: () => toast.success(published ? `«${place.name}» صار ظاهر بالموقع` : `تم إخفاء «${place.name}»`) },
              )
            }
          />
        </label>
      </div>
    </article>
  );
}

function PlacesSkeleton() {
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i} className="overflow-hidden rounded-2xl border border-line bg-surface">
          <Skeleton className="aspect-[16/10] rounded-none" />
          <div className="flex items-center justify-between px-4 py-3.5">
            <Skeleton className="h-3.5 w-24" />
            <Skeleton className="h-5 w-9 rounded-full" />
          </div>
        </div>
      ))}
    </div>
  );
}

function CreatePlaceDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const create = useCreatePlace();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [category, setCategory] = useState('');
  const [location, setLocation] = useState('');
  const [published, setPublished] = useState(true);

  const close = () => {
    if (create.isPending) return;
    onClose();
    setName('');
    setCategory('');
    setLocation('');
    setPublished(true);
    create.reset();
  };

  const error = create.error instanceof ApiError ? create.error : null;
  const fields = error?.fieldErrors ?? {};

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim()) return;
    create.mutate(
      { name: name.trim(), category: category.trim() || null, location: location.trim() || null, published },
      {
        onSuccess: (place) => {
          toast.success(`تمت إضافة «${place.name}»`, { description: 'هسة ارفع فيديوهاته وأضف صورة الغلاف.' });
          close();
          navigate(`/places/${place.id}`);
        },
      },
    );
  };

  return (
    <Dialog
      open={open}
      onClose={close}
      title="مكان جديد"
      description="تگدر تكمل باقي التفاصيل والصور بعدين من صفحة المكان."
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={close} disabled={create.isPending}>
            إلغاء
          </Button>
          <Button variant="primary" type="submit" form="create-place" loading={create.isPending} disabled={!name.trim()}>
            إنشاء المكان
          </Button>
        </>
      }
    >
      <form id="create-place" onSubmit={onSubmit} className="flex flex-col gap-4">
        <Field label="اسم المكان" required error={fields.name}>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="مثلاً: كافيه ليالي بغداد" maxLength={120} data-autofocus />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="النوع" error={fields.category}>
            <Input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="مطعم، كافيه، جيم…" maxLength={60} />
          </Field>
          <Field label="المدينة" error={fields.location}>
            <Input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="بغداد" maxLength={80} />
          </Field>
        </div>
        <SwitchRow
          title="يظهر بالموقع"
          description="تگدر تخفيه لحد ما تخلص رفع الفيديوهات."
          checked={published}
          onChange={setPublished}
          className="border-t border-line pt-4"
        />
      </form>
    </Dialog>
  );
}
