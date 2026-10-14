import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Eye, Globe, Star } from 'lucide-react';
import type { AdminPlace, PlaceInput } from '@s5y/shared';
import { ApiError } from '../../lib/api';
import { InstagramIcon } from '../../components/ui/brand-icons';
import { ChipsInput } from '../../components/ui/chips-input';
import { ColorField, isHexColor } from '../../components/ui/color-field';
import { Counter, Field, Input, SwitchRow, Textarea } from '../../components/ui/form';
import { ImageUploader } from '../../components/ui/image-uploader';
import { Card } from '../../components/ui/misc';
import { FormSection } from '../../components/ui/page';
import { SaveBar } from '../../components/ui/save-bar';
import { useUnsavedGuard } from '../../hooks/useUnsavedGuard';
import { normalizeDigits } from '../../lib/format';
import { useUpdatePlace } from './hooks';

interface PlaceForm {
  name: string;
  slug: string;
  category: string;
  location: string;
  year: string;
  summary: string;
  description: string;
  services: string[];
  accentColor: string;
  instagram: string;
  website: string;
  featured: boolean;
  published: boolean;
  coverKey: string | null;
  coverUrl: string | null;
  logoKey: string | null;
  logoUrl: string | null;
}

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SERVICE_SUGGESTIONS = ['تصوير ريلز', 'مونتاج', 'إعلان', 'تصوير منتجات', 'تصوير جوي', 'إدارة حسابات', 'تصوير فعاليات', 'بودكاست'];

function fromPlace(place: AdminPlace): PlaceForm {
  return {
    name: place.name,
    slug: place.slug,
    category: place.category ?? '',
    location: place.location ?? '',
    year: place.year ? String(place.year) : '',
    summary: place.summary ?? '',
    description: place.description ?? '',
    services: place.services,
    accentColor: place.accentColor,
    instagram: place.instagram ?? '',
    website: place.website ?? '',
    featured: place.featured,
    published: place.published,
    coverKey: place.coverKey,
    coverUrl: place.coverUrl,
    logoKey: place.logoKey,
    logoUrl: place.logoUrl,
  };
}

const textOrNull = (value: string) => (value.trim() === '' ? null : value.trim());

/** Only the fields that changed, in API shape. */
function diff(form: PlaceForm, base: PlaceForm): Partial<PlaceInput> {
  const out: Partial<PlaceInput> = {};
  if (form.name.trim() !== base.name) out.name = form.name.trim();
  if (form.slug.trim() !== base.slug) out.slug = form.slug.trim().toLowerCase();
  if (form.category.trim() !== base.category) out.category = textOrNull(form.category);
  if (form.location.trim() !== base.location) out.location = textOrNull(form.location);
  if (form.year !== base.year) out.year = form.year ? Number(form.year) : null;
  if (form.summary.trim() !== base.summary) out.summary = textOrNull(form.summary);
  if (form.description.trim() !== base.description) out.description = textOrNull(form.description);
  if (JSON.stringify(form.services) !== JSON.stringify(base.services)) out.services = form.services;
  if (form.accentColor !== base.accentColor) out.accentColor = form.accentColor;
  if (form.instagram.trim() !== base.instagram) out.instagram = textOrNull(form.instagram.replace(/^@+/, ''));
  if (form.website.trim() !== base.website) out.website = textOrNull(form.website);
  if (form.featured !== base.featured) out.featured = form.featured;
  if (form.published !== base.published) out.published = form.published;
  if (form.coverKey !== base.coverKey) out.coverKey = form.coverKey;
  if (form.logoKey !== base.logoKey) out.logoKey = form.logoKey;
  return out;
}

function validate(form: PlaceForm): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!form.name.trim()) errors.name = 'اكتب اسم المكان';
  const slug = form.slug.trim();
  if (slug && (slug.length < 2 || slug.length > 80 || !SLUG_RE.test(slug))) {
    errors.slug = 'الرابط يتكون من أحرف إنجليزية صغيرة وأرقام و "-" فقط (2–80 حرف)';
  }
  if (form.year) {
    const year = Number(form.year);
    if (!Number.isInteger(year) || year < 1990 || year > 2100) errors.year = 'اكتب سنة صحيحة مثل 2024';
  }
  if (!isHexColor(form.accentColor)) errors.accentColor = 'اللون لازم يكون بصيغة #rrggbb';
  return errors;
}

/** "/work/" prefix + slug field; forwards Field's id/aria props to the real input. */
function SlugInput({
  value,
  onChange,
  id,
  'aria-invalid': invalid,
  'aria-describedby': describedBy,
}: {
  value: string;
  onChange: (value: string) => void;
  id?: string;
  'aria-invalid'?: boolean;
  'aria-describedby'?: string;
}) {
  return (
    <div
      className="flex h-11 items-center overflow-hidden rounded-xl border border-line bg-surface-2 focus-within:border-accent/60 focus-within:shadow-[0_0_0_3px_rgb(233_179_95/0.14)] aria-invalid:border-danger/60"
      dir="ltr"
      aria-invalid={invalid}
    >
      <span className="num flex h-full items-center border-e border-line bg-surface-3 px-3 text-xs text-muted">/work/</span>
      <input
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value.toLowerCase().replace(/\s+/g, '-'))}
        className="num h-full min-w-0 flex-1 bg-transparent px-3 text-sm focus:outline-none"
        spellCheck={false}
        autoCapitalize="off"
        maxLength={80}
        aria-invalid={invalid}
        aria-describedby={describedBy}
      />
    </div>
  );
}

export function PlaceDetailsForm({ place }: { place: AdminPlace }) {
  const update = useUpdatePlace({ silent: true });
  const [base, setBase] = useState(() => fromPlace(place));
  const [form, setForm] = useState(base);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const changes = useMemo(() => diff(form, base), [form, base]);
  const dirty = Object.keys(changes).length > 0;
  useUnsavedGuard(dirty);

  // Follow server updates (other tabs, quick toggles) only while there are no local edits.
  useEffect(() => {
    if (dirty) return;
    const next = fromPlace(place);
    setBase(next);
    setForm(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-sync when the server copy changes
  }, [place.updatedAt, place.id]);

  const set = <K extends keyof PlaceForm>(key: K, value: PlaceForm[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
    if (errors[key]) {
      setErrors((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
    }
  };

  const save = () => {
    const local = validate(form);
    if (Object.keys(local).length) {
      setErrors(local);
      toast.error('راجع الحقول المعلّمة');
      return;
    }
    update.mutate(
      { id: place.id, input: changes },
      {
        onSuccess: (saved) => {
          const next = fromPlace(saved);
          setBase(next);
          setForm(next);
          setErrors({});
          toast.success('تم حفظ تفاصيل المكان');
        },
        onError: (error) => {
          if (error instanceof ApiError && (error.code === 'VALIDATION_ERROR' || error.code === 'CONFLICT')) {
            const fields = error.fieldErrors;
            if (error.code === 'CONFLICT' && Object.keys(fields).length === 0) fields.slug = error.message;
            setErrors(fields);
          }
          toast.error(error instanceof ApiError ? error.message : 'تعذّر الحفظ');
        },
      },
    );
  };

  return (
    <div>
      <Card className="divide-y divide-line px-5 py-6 sm:px-7">
        <FormSection title="المعلومات الأساسية" description="الاسم والرابط والنوع مثل ما تنعرض بالموقع.">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="اسم المكان" required error={errors.name} className="sm:col-span-2" aside={<Counter value={form.name} max={120} />}>
              <Input value={form.name} onChange={(e) => set('name', e.target.value)} maxLength={120} />
            </Field>
            <Field
              label="رابط الصفحة"
              error={errors.slug}
              hint="أحرف إنجليزية صغيرة وأرقام وشرطة (-). اتركه فارغاً حتى يتولّد من الاسم."
              className="sm:col-span-2"
            >
              <SlugInput value={form.slug} onChange={(v) => set('slug', v)} />
            </Field>
            <Field label="النوع" hint="مطعم، كافيه، جيم، براند…" error={errors.category}>
              <Input value={form.category} onChange={(e) => set('category', e.target.value)} maxLength={60} />
            </Field>
            <Field label="المدينة / المنطقة" error={errors.location}>
              <Input value={form.location} onChange={(e) => set('location', e.target.value)} maxLength={80} />
            </Field>
            <Field label="سنة الشغل" error={errors.year}>
              <Input
                value={form.year}
                onChange={(e) => set('year', normalizeDigits(e.target.value).replace(/\D/g, '').slice(0, 4))}
                inputMode="numeric"
                placeholder={String(new Date().getFullYear())}
                ltr
                className="num"
              />
            </Field>
          </div>
        </FormSection>

        <FormSection title="الصور" description="الغلاف يطلع على بطاقة المكان وبأعلى صفحته. الشعار يفضّل يكون PNG بخلفية شفافة.">
          <div className="grid gap-5 sm:grid-cols-[minmax(0,1fr)_11rem]">
            <ImageUploader
              label="صورة الغلاف"
              aspect="16 / 10"
              value={form.coverUrl}
              onUploaded={(image) => setForm((f) => ({ ...f, coverKey: image.key, coverUrl: image.url }))}
              onRemove={() => setForm((f) => ({ ...f, coverKey: null, coverUrl: null }))}
              hint={
                <>
                  مقاس مقترح{' '}
                  <span className="num" dir="ltr">
                    1920×1200
                  </span>{' '}
                  أو أكبر.
                </>
              }
            />
            <ImageUploader
              label="الشعار"
              aspect="1 / 1"
              fit="contain"
              backdrop={`radial-gradient(circle at 50% 40%, ${form.accentColor}33, #111114 70%)`}
              value={form.logoUrl}
              onUploaded={(image) => setForm((f) => ({ ...f, logoKey: image.key, logoUrl: image.url }))}
              onRemove={() => setForm((f) => ({ ...f, logoKey: null, logoUrl: null }))}
            />
          </div>
        </FormSection>

        <FormSection title="الوصف" description="نبذة قصيرة للبطاقة، ووصف أطول لصفحة المكان.">
          <div className="flex flex-col gap-4">
            <Field label="نبذة قصيرة" error={errors.summary} aside={<Counter value={form.summary} max={300} />}>
              <Textarea value={form.summary} onChange={(e) => set('summary', e.target.value)} rows={2} maxLength={300} />
            </Field>
            <Field label="الوصف الكامل" error={errors.description} aside={<Counter value={form.description} max={5000} />}>
              <Textarea value={form.description} onChange={(e) => set('description', e.target.value)} rows={6} maxLength={5000} />
            </Field>
            <Field label="الخدمات اللي قدمتها" hint="تنعرض كشارات بصفحة المكان. اضغط Enter بعد كل خدمة." error={errors.services}>
              <ChipsInput value={form.services} onChange={(v) => set('services', v)} suggestions={SERVICE_SUGGESTIONS} max={20} maxLength={40} />
            </Field>
          </div>
        </FormSection>

        <FormSection title="الهوية والروابط" description="لون المكان يستخدم للإضاءة والتفاصيل بصفحته.">
          <div className="flex flex-col gap-5">
            <Field label="لون المكان" error={errors.accentColor}>
              <ColorField value={form.accentColor} onChange={(v) => set('accentColor', v)} />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="انستغرام المكان" error={errors.instagram}>
                <Input value={form.instagram} onChange={(e) => set('instagram', e.target.value)} ltr start={<InstagramIcon />} placeholder="placename" maxLength={100} autoCapitalize="off" />
              </Field>
              <Field label="الموقع الإلكتروني" error={errors.website}>
                <Input value={form.website} onChange={(e) => set('website', e.target.value)} ltr start={<Globe />} placeholder="https://" inputMode="url" maxLength={300} autoCapitalize="off" />
              </Field>
            </div>
          </div>
        </FormSection>

        <FormSection title="الظهور" description="تحكم إذا المكان يطلع للزوار وإذا يكون من المميزين.">
          <div className="divide-y divide-line rounded-xl border border-line px-4">
            <SwitchRow icon={<Eye />} title="منشور بالموقع" description="لمن تطفيه، الصفحة تختفي من الموقع بس تبقى هنا." checked={form.published} onChange={(v) => set('published', v)} />
            <SwitchRow icon={<Star />} title="مكان مميز" description="المميزة تنعرض أكبر وبالبداية." checked={form.featured} onChange={(v) => set('featured', v)} />
          </div>
        </FormSection>
      </Card>

      <SaveBar
        visible={dirty}
        saving={update.isPending}
        onSave={save}
        onDiscard={() => {
          setForm(base);
          setErrors({});
        }}
      />
    </div>
  );
}
