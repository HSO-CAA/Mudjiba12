import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, Check, Contact, Crown, Film, Info, Mail, MapPin, MonitorPlay, Phone, Plus, Trash2, UserRound, X } from 'lucide-react';
import type { SiteSettings, SiteStat } from '@s5y/shared';
import { cn } from '../../lib/cn';
import { api } from '../../lib/endpoints';
import { normalizeDigits } from '../../lib/format';
import { qk } from '../../lib/query';
import { InstagramIcon, SnapchatIcon, TikTokIcon, WhatsAppIcon, YouTubeIcon } from '../../components/ui/brand-icons';
import { Button, IconButton } from '../../components/ui/button';
import { ChipsInput } from '../../components/ui/chips-input';
import { ColorField } from '../../components/ui/color-field';
import { Counter, Field, Input, SwitchRow, Textarea } from '../../components/ui/form';
import { ImageUploader } from '../../components/ui/image-uploader';
import { Callout, Card, EmptyState, Skeleton } from '../../components/ui/misc';
import { FormSection } from '../../components/ui/page';
import { DragHandle, Sortable } from '../../components/ui/sortable';
import { VideoThumb } from '../videos/VideoThumb';
import type { Urls } from './SettingsPage';

export interface SettingsTabProps {
  doc: SiteSettings;
  update: <K extends keyof SiteSettings>(section: K, value: SiteSettings[K]) => void;
  errors: Record<string, string>;
  urls: Urls;
  setUrls: Dispatch<SetStateAction<Urls>>;
}

const THIS_YEAR = new Date().getFullYear();

/* ─────────────────────────── Brand ─────────────────────────── */

export function BrandTab({ doc, update, errors }: SettingsTabProps) {
  const b = doc.brand;
  const set = <K extends keyof SiteSettings['brand']>(key: K, value: SiteSettings['brand'][K]) => update('brand', { ...b, [key]: value });
  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
      <Card className="divide-y divide-line px-5 py-6 sm:px-7">
        <FormSection title="الاسم والمعرّف" description="الاسم الكبير بالواجهة، ومعرّف انستغرام اللي يطلع جنبه.">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="الاسم" required error={errors['brand.name']} aside={<Counter value={b.name} max={60} />}>
              <Input value={b.name} onChange={(e) => set('name', e.target.value)} maxLength={60} />
            </Field>
            <Field label="المعرّف" hint="بدون @ — أحرف إنجليزية وأرقام فقط" error={errors['brand.handle']}>
              <Input value={b.handle} onChange={(e) => set('handle', e.target.value.replace(/^@+/, '').replace(/\s/g, ''))} ltr start={<span className="num text-sm">@</span>} maxLength={30} autoCapitalize="off" />
            </Field>
            <Field label="المسمّى المهني" error={errors['brand.title']} className="sm:col-span-2" aside={<Counter value={b.title} max={120} />}>
              <Input value={b.title} onChange={(e) => set('title', e.target.value)} maxLength={120} />
            </Field>
            <Field label="الجملة التعريفية" hint="سطر واحد يطلع تحت الاسم بالواجهة." error={errors['brand.tagline']} className="sm:col-span-2" aside={<Counter value={b.tagline} max={200} />}>
              <Textarea value={b.tagline} onChange={(e) => set('tagline', e.target.value)} rows={2} maxLength={200} />
            </Field>
          </div>
        </FormSection>
        <FormSection title="العلامة واللون" description="العلامة اللاتينية القصيرة تنحفر على العدسة ثلاثية الأبعاد، واللون يمشي على كل الموقع.">
          <div className="flex flex-col gap-5">
            <Field label="العلامة (Hero mark)" hint="لحد 12 حرف لاتيني، مثل S5Y." error={errors['brand.heroMark']}>
              <Input value={b.heroMark} onChange={(e) => set('heroMark', e.target.value.toUpperCase())} ltr maxLength={12} className="num max-w-48 uppercase" />
            </Field>
            <Field label="لون الموقع" error={errors['brand.accent']}>
              <ColorField value={b.accent} onChange={(v) => set('accent', v)} />
            </Field>
          </div>
        </FormSection>
      </Card>

      <aside>
        <p className="hud mb-2 text-subtle" dir="ltr">
          PREVIEW
        </p>
        <div className="viewfinder relative overflow-hidden rounded-2xl border border-line bg-[radial-gradient(80%_80%_at_50%_0%,#1b1b20,#060607)] p-6 xl:sticky xl:top-6">
          <div className="hud flex items-center justify-between text-white/50" dir="ltr">
            <span className="flex items-center gap-1.5">
              <span className="size-1.5 animate-rec rounded-full bg-rec" /> REC
            </span>
            <span>{b.heroMark || 'S5Y'} · 35MM</span>
          </div>
          <div className="mt-10 grid place-items-center">
            <div className="grid size-24 place-items-center rounded-full border border-white/10 bg-[radial-gradient(circle_at_35%_30%,#2a2a31,#0b0b0d_65%)] shadow-[inset_0_0_0_6px_#121216]">
              <div className="size-12 rounded-full" style={{ background: `radial-gradient(circle at 40% 35%, ${b.accent}66, #050506 70%)` }} />
            </div>
          </div>
          <h3 className="mt-8 text-center text-3xl font-bold leading-tight text-fg">{b.name || 'الاسم'}</h3>
          <p className="mt-1 text-center text-sm font-medium" style={{ color: b.accent }}>
            {b.title}
          </p>
          <p className="mt-2 text-center text-[0.8125rem] leading-relaxed text-muted">{b.tagline}</p>
          <div className="mt-5 flex justify-center gap-2">
            <span className="rounded-xl px-4 py-2 text-xs font-semibold text-[#1b1306]" style={{ background: b.accent }}>
              شوف الشغل
            </span>
            <span className="rounded-xl border border-white/15 px-4 py-2 text-xs text-fg-2">تواصل</span>
          </div>
          <p className="num mt-4 text-center text-[0.6875rem] text-subtle" dir="ltr">
            @{b.handle || 'handle'}
          </p>
        </div>
      </aside>
    </div>
  );
}

/* ─────────────────────────── About ─────────────────────────── */

export function AboutTab({ doc, update, errors, urls, setUrls }: SettingsTabProps) {
  const a = doc.about;
  const set = <K extends keyof SiteSettings['about']>(key: K, value: SiteSettings['about'][K]) => update('about', { ...a, [key]: value });
  return (
    <Card className="divide-y divide-line px-5 py-6 sm:px-7">
      <FormSection title="الصورة الشخصية" description="تطلع داخل إطار الكاميرا بقسم «نبذة». مربعة وواضحة أحسن شي.">
        <div className="flex items-center gap-5">
          <ImageUploader
            label="الصورة الشخصية"
            shape="circle"
            aspect="1 / 1"
            className="w-32 shrink-0 sm:w-36"
            value={urls.avatarUrl}
            onUploaded={(image) => {
              set('avatarKey', image.key);
              setUrls((u) => ({ ...u, avatarUrl: image.url }));
            }}
            onRemove={() => {
              set('avatarKey', null);
              setUrls((u) => ({ ...u, avatarUrl: null }));
            }}
          />
          <p className="text-xs leading-relaxed text-muted">JPG أو PNG أو WebP، لحد 15MB. الصورة تنضغط تلقائياً للويب.</p>
        </div>
        {errors['about.avatarKey'] && <p className="mt-2 text-xs text-danger">{errors['about.avatarKey']}</p>}
      </FormSection>
      <FormSection title="النص" description="عنوان ونبذة عنك وعن طريقة شغلك.">
        <div className="flex flex-col gap-4">
          <Field label="العنوان" error={errors['about.heading']} aside={<Counter value={a.heading} max={120} />}>
            <Input value={a.heading} onChange={(e) => set('heading', e.target.value)} maxLength={120} />
          </Field>
          <Field label="النبذة" error={errors['about.body']} aside={<Counter value={a.body} max={3000} />}>
            <Textarea value={a.body} onChange={(e) => set('body', e.target.value)} rows={7} maxLength={3000} />
          </Field>
        </div>
      </FormSection>
      <FormSection title="التفاصيل" description="الموقع وسنة البداية (تنحسب منها سنين الخبرة).">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="المدينة / البلد" error={errors['about.location']}>
            <Input value={a.location} onChange={(e) => set('location', e.target.value)} start={<MapPin />} maxLength={80} />
          </Field>
          <Field
            label="سنة البداية"
            error={errors['about.since']}
            hint={a.since && a.since <= THIS_YEAR ? `يعني ${Math.max(1, THIS_YEAR - a.since)} سنة خبرة` : undefined}
          >
            <Input
              value={a.since ? String(a.since) : ''}
              onChange={(e) => {
                const digits = normalizeDigits(e.target.value).replace(/\D/g, '').slice(0, 4);
                set('since', digits ? Number(digits) : null);
              }}
              inputMode="numeric"
              ltr
              placeholder="2019"
              className="num"
            />
          </Field>
        </div>
      </FormSection>
    </Card>
  );
}

/* ─────────────────────────── Stats ─────────────────────────── */

export function StatsTab({ doc, update, errors }: SettingsTabProps) {
  const stats = doc.stats;
  const setStats = (next: SiteStat[]) => update('stats', next);
  const patch = (index: number, value: Partial<SiteStat>) => setStats(stats.map((s, i) => (i === index ? { ...s, ...value } : s)));
  const move = (index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= stats.length) return;
    const next = [...stats];
    [next[index], next[target]] = [next[target], next[index]];
    setStats(next);
  };

  return (
    <div className="flex flex-col gap-5">
      <Callout tone="info" icon={<Info />}>
        إذا تركت القائمة فارغة، الموقع يعرض أرقام تلقائية (عدد الأماكن والفيديوهات والمشاهدات). الحد الأقصى 8 أرقام.
      </Callout>
      <Card className="p-5 sm:p-6">
        {stats.length === 0 ? (
          <EmptyState
            compact
            icon={<Plus />}
            title="ماكو أرقام مخصصة"
            description="مثلاً: «+120 مكان»، «2M مشاهدة»، «6 سنين خبرة»."
            action={
              <Button variant="primary" icon={<Plus />} onClick={() => setStats([{ label: '', value: 0 }])}>
                أضف رقم
              </Button>
            }
          />
        ) : (
          <div className="flex flex-col gap-3">
            <div className="hidden grid-cols-[2rem_8rem_6rem_minmax(0,1fr)_6.5rem] gap-3 px-1 text-xs text-muted sm:grid">
              <span />
              <span>الرقم</span>
              <span>اللاحقة</span>
              <span>الوصف</span>
              <span />
            </div>
            {stats.map((stat, index) => (
              <div key={index} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-2 rounded-xl border border-line bg-surface-2/40 p-3 sm:grid-cols-[2rem_8rem_6rem_minmax(0,1fr)_6.5rem] sm:items-center sm:gap-3 sm:border-0 sm:bg-transparent sm:p-0">
                <span className="num hidden text-center text-xs text-subtle sm:block">{index + 1}</span>
                <Field error={errors[`stats.${index}.value`]}>
                  <StatValueInput value={stat.value} onChange={(value) => patch(index, { value })} label={`الرقم ${index + 1}`} />
                </Field>
                <Field error={errors[`stats.${index}.suffix`]}>
                  <Input
                    value={stat.suffix ?? ''}
                    onChange={(e) => patch(index, { suffix: e.target.value.slice(0, 8) || undefined })}
                    placeholder="+ أو K أو M"
                    maxLength={8}
                    className="num"
                    aria-label={`لاحقة الرقم ${index + 1}`}
                  />
                </Field>
                <Field error={errors[`stats.${index}.label`]} className="col-span-2 sm:col-span-1">
                  <Input value={stat.label} onChange={(e) => patch(index, { label: e.target.value })} placeholder="مكان اشتغلت وياه" maxLength={40} aria-label={`وصف الرقم ${index + 1}`} />
                </Field>
                <div className="col-span-2 flex justify-end gap-0.5 sm:col-span-1">
                  <IconButton label="تحريك للأعلى" size="sm" disabled={index === 0} onClick={() => move(index, -1)}>
                    <ArrowUp />
                  </IconButton>
                  <IconButton label="تحريك للأسفل" size="sm" disabled={index === stats.length - 1} onClick={() => move(index, 1)}>
                    <ArrowDown />
                  </IconButton>
                  <IconButton label="حذف الرقم" size="sm" variant="danger-ghost" onClick={() => setStats(stats.filter((_, i) => i !== index))}>
                    <Trash2 />
                  </IconButton>
                </div>
              </div>
            ))}
            {errors.stats && <p className="text-xs text-danger">{errors.stats}</p>}
            <div>
              <Button icon={<Plus />} onClick={() => setStats([...stats, { label: '', value: 0 }])} disabled={stats.length >= 8}>
                أضف رقم
              </Button>
            </div>
          </div>
        )}
      </Card>
      {stats.length > 0 && (
        <div>
          <p className="hud mb-2 text-subtle" dir="ltr">
            PREVIEW
          </p>
          <div className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-line bg-line sm:grid-cols-[repeat(auto-fit,minmax(10rem,1fr))]">
            {stats.map((s, i) => (
              <div key={i} className="bg-surface p-5 text-center">
                <p className="num text-3xl font-bold text-fg" dir="ltr">
                  {s.value.toLocaleString('en-US')}
                  <span className="text-accent">{s.suffix}</span>
                </p>
                <p className="mt-1 text-xs text-muted">{s.label || '—'}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/** Number field that allows typing decimals ("2.5") before committing. */
function StatValueInput({ value, onChange, label, ...rest }: { value: number; onChange: (value: number) => void; label: string; id?: string }) {
  const [text, setText] = useState(String(value));
  useEffect(() => {
    if (Number(text) !== value) setText(String(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only follow external changes
  }, [value]);
  return (
    <Input
      {...rest}
      value={text}
      onChange={(e) => {
        const raw = normalizeDigits(e.target.value).replace(/[٫,]/g, '.').replace(/[^\d.]/g, '').replace(/(\..*)\./g, '$1');
        setText(raw);
        const parsed = Number(raw);
        if (raw !== '' && Number.isFinite(parsed)) onChange(parsed);
        else if (raw === '') onChange(0);
      }}
      onBlur={() => setText(String(value))}
      inputMode="decimal"
      ltr
      className="num"
      aria-label={label}
    />
  );
}

/* ─────────────────────────── Contact ─────────────────────────── */

export function ContactTab({ doc, update, errors }: SettingsTabProps) {
  const c = doc.contact;
  const set = <K extends keyof SiteSettings['contact']>(key: K, value: SiteSettings['contact'][K]) => update('contact', { ...c, [key]: value });
  const handle = (value: string) => value.trim().replace(/^@+/, '');
  return (
    <Card className="divide-y divide-line px-5 py-6 sm:px-7">
      <FormSection title="التواصل المباشر" description="زر الواتساب هو أهم زر بالموقع — تأكد من الرقم.">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="واتساب"
            hint={
              c.whatsapp ? (
                <>
                  زر الواتساب يفتح{' '}
                  <span className="num" dir="ltr">
                    wa.me/{c.whatsapp}
                  </span>
                </>
              ) : (
                'بالصيغة الدولية بدون + أو 00، مثل 9647701234567'
              )
            }
            error={errors['contact.whatsapp']}
          >
            <Input
              value={c.whatsapp}
              onChange={(e) => {
                let digits = normalizeDigits(e.target.value).replace(/\D/g, '');
                if (digits.startsWith('00')) digits = digits.slice(2);
                set('whatsapp', digits.slice(0, 15));
              }}
              // A local Iraqi number (07xx xxx xxxx) doesn't work in wa.me links: turn it into 9647xx…
              onBlur={() => {
                if (/^07\d{9}$/.test(c.whatsapp)) set('whatsapp', `964${c.whatsapp.slice(1)}`);
              }}
              inputMode="tel"
              ltr
              start={<WhatsAppIcon />}
              className="num"
              placeholder="9647701234567"
            />
          </Field>
          <Field label="رقم الهاتف" error={errors['contact.phone']}>
            <Input value={c.phone} onChange={(e) => set('phone', normalizeDigits(e.target.value))} inputMode="tel" ltr start={<Phone />} className="num" maxLength={30} placeholder="+964 770 123 4567" />
          </Field>
          <Field label="البريد الإلكتروني" error={errors['contact.email']}>
            <Input value={c.email} onChange={(e) => set('email', e.target.value.trim())} type="email" inputMode="email" ltr start={<Mail />} maxLength={200} />
          </Field>
          <Field label="العنوان" error={errors['contact.address']}>
            <Input value={c.address} onChange={(e) => set('address', e.target.value)} start={<MapPin />} maxLength={200} placeholder="بغداد، المنصور" />
          </Field>
        </div>
      </FormSection>
      <FormSection title="السوشيال ميديا" description="اكتب المعرّف بس (بدون @) أو الرابط الكامل.">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="انستغرام" error={errors['contact.instagram']}>
            <Input value={c.instagram} onChange={(e) => set('instagram', handle(e.target.value))} ltr start={<InstagramIcon />} maxLength={100} autoCapitalize="off" />
          </Field>
          <Field label="تيك توك" error={errors['contact.tiktok']}>
            <Input value={c.tiktok} onChange={(e) => set('tiktok', handle(e.target.value))} ltr start={<TikTokIcon />} maxLength={100} autoCapitalize="off" />
          </Field>
          <Field label="يوتيوب" error={errors['contact.youtube']}>
            <Input value={c.youtube} onChange={(e) => set('youtube', handle(e.target.value))} ltr start={<YouTubeIcon />} maxLength={150} autoCapitalize="off" />
          </Field>
          <Field label="سناب شات" error={errors['contact.snapchat']}>
            <Input value={c.snapchat} onChange={(e) => set('snapchat', handle(e.target.value))} ltr start={<SnapchatIcon />} maxLength={100} autoCapitalize="off" />
          </Field>
        </div>
      </FormSection>
    </Card>
  );
}

/* ─────────────────────────── Home (hero + sections) ─────────────────────────── */

const MAX_HERO = 7;

export function HomeTab({ doc, update, errors }: SettingsTabProps) {
  const ready = useQuery({ queryKey: qk.videos({ status: 'READY' }), queryFn: () => api.videos.list({ status: 'READY' }) });
  const ids = doc.hero.videoIds;
  const byId = useMemo(() => new Map((ready.data ?? []).map((v) => [v.id, v])), [ready.data]);
  const selected = ids.map((id) => ({ id, video: byId.get(id) ?? null }));
  const setIds = (next: string[]) => update('hero', { ...doc.hero, videoIds: next.slice(0, MAX_HERO) });
  const toggle = (id: string) => (ids.includes(id) ? setIds(ids.filter((x) => x !== id)) : ids.length < MAX_HERO && setIds([...ids, id]));
  const s = doc.sections;
  const setSection = (key: keyof SiteSettings['sections'], value: boolean) => update('sections', { ...s, [key]: value });

  return (
    <div className="flex flex-col gap-6">
      <Card className="p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="font-semibold">فيديوهات شاشات الواجهة</h2>
            <p className="mt-1 max-w-2xl text-[0.8125rem] leading-relaxed text-muted">
              اختار لحد {MAX_HERO} فيديوهات جاهزة تشتغل على الشاشات ثلاثية الأبعاد بأول الموقع. إذا ما اخترت شي، تنعرض الفيديوهات المميزة تلقائياً.
            </p>
          </div>
          <span className="num rounded-full bg-white/[0.05] px-2.5 py-1 text-xs text-fg-2" dir="ltr">
            {ids.length} / {MAX_HERO}
          </span>
        </div>
        {errors['hero.videoIds'] && <p className="mt-2 text-xs text-danger">{errors['hero.videoIds']}</p>}

        <div className="mt-4 rounded-2xl border border-dashed border-line-strong bg-surface-2/40 p-3">
          {selected.length === 0 ? (
            <p className="flex items-center justify-center gap-2 py-6 text-[0.8125rem] text-muted">
              <MonitorPlay className="size-4" aria-hidden /> بالوضع التلقائي (الفيديوهات المميزة)
            </p>
          ) : (
            <div className="flex gap-2.5 overflow-x-auto pb-1">
              <Sortable items={selected} layout="list" onReorder={(next) => setIds(next.map((x) => x.id))}>
                {(item, props, index) => (
                  <div ref={props.setNodeRef} style={props.style} className="relative w-20 shrink-0 sm:w-24">
                    <div className={cn('relative aspect-[9/16] overflow-hidden rounded-xl border bg-surface-3', props.isDragging ? 'border-accent' : 'border-line')}>
                      {item.video ? <VideoThumb video={item.video} className="size-full" /> : <span className="absolute inset-0 grid place-items-center text-[0.625rem] text-subtle">غير متاح</span>}
                      <span className="num absolute start-1.5 top-1.5 grid size-5 place-items-center rounded-md bg-black/60 text-[0.625rem] font-semibold text-white">{index + 1}</span>
                      <button
                        type="button"
                        onClick={() => setIds(ids.filter((x) => x !== item.id))}
                        className="absolute end-1 top-1 grid size-6 place-items-center rounded-md bg-black/60 text-white/85 hover:bg-danger"
                        aria-label="إزالة من الواجهة"
                      >
                        <X className="size-3.5" aria-hidden />
                      </button>
                      <DragHandle handle={props.handle} className="absolute bottom-1 start-1/2 size-7 -translate-x-1/2 bg-black/55 text-white/80 rtl:translate-x-1/2" />
                    </div>
                  </div>
                )}
              </Sortable>
            </div>
          )}
        </div>

        <h3 className="mb-3 mt-6 text-[0.8125rem] font-medium text-fg-2">الفيديوهات الجاهزة</h3>
        {ready.isPending ? (
          <div className="grid grid-cols-4 gap-2.5 sm:grid-cols-6 lg:grid-cols-8 2xl:grid-cols-10">
            {Array.from({ length: 8 }, (_, i) => (
              <Skeleton key={i} className="aspect-[9/16] rounded-xl" />
            ))}
          </div>
        ) : (ready.data ?? []).length === 0 ? (
          <EmptyState compact icon={<Film />} title="ماكو فيديوهات جاهزة" description="ارفع فيديوهات من صفحات الأماكن أولاً." />
        ) : (
          <div className="grid grid-cols-4 gap-2.5 sm:grid-cols-6 lg:grid-cols-8 2xl:grid-cols-10">
            {(ready.data ?? []).map((video) => {
              const position = ids.indexOf(video.id);
              const chosen = position >= 0;
              const full = !chosen && ids.length >= MAX_HERO;
              return (
                <button
                  key={video.id}
                  type="button"
                  onClick={() => toggle(video.id)}
                  disabled={full}
                  aria-pressed={chosen}
                  title={`${video.title ?? video.originalName ?? ''} — ${video.placeName}`}
                  aria-label={`${video.title ?? video.originalName ?? 'فيديو'} — ${video.placeName}`}
                  className={cn(
                    'group relative aspect-[9/16] overflow-hidden rounded-xl border-2 transition-[border-color,opacity,transform] disabled:cursor-not-allowed disabled:opacity-35',
                    chosen ? 'border-accent' : 'border-transparent hover:border-line-strong',
                  )}
                >
                  <VideoThumb video={video} className="size-full" />
                  <span className="absolute inset-x-0 bottom-0 bg-linear-to-t from-black/80 to-transparent p-1.5 pt-5 text-start text-[0.625rem] leading-tight text-white/85">
                    <span className="line-clamp-2">{video.placeName}</span>
                  </span>
                  <span
                    className={cn(
                      'absolute end-1.5 top-1.5 grid size-5 place-items-center rounded-full text-[0.625rem] font-bold transition-colors',
                      chosen ? 'bg-accent text-accent-ink' : 'bg-black/45 text-transparent ring-1 ring-white/50 group-hover:text-white/70',
                    )}
                  >
                    {chosen ? <span className="num">{position + 1}</span> : <Check className="size-3" aria-hidden />}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </Card>

      <Card className="px-5 py-2 sm:px-6">
        <div className="divide-y divide-line">
          <SwitchRow icon={<UserRound />} title="قسم «نبذة»" description="الصورة الشخصية والنبذة والأرقام." checked={s.about} onChange={(v) => setSection('about', v)} />
          <SwitchRow icon={<Film />} title="شريط الشوريل" description="صف أفقي للفيديوهات المميزة." checked={s.showreel} onChange={(v) => setSection('showreel', v)} />
          <SwitchRow icon={<Crown />} title="قسم الباقات" description="يحتاج باقات فعّالة من صفحة الباقات." checked={s.plans} onChange={(v) => setSection('plans', v)} />
          <SwitchRow icon={<Contact />} title="قسم التواصل" description="فورم الرسائل وزر الواتساب." checked={s.contact} onChange={(v) => setSection('contact', v)} />
        </div>
      </Card>
    </div>
  );
}

/* ─────────────────────────── SEO ─────────────────────────── */

export function SeoTab({ doc, update, errors, urls, setUrls }: SettingsTabProps) {
  const seo = doc.seo;
  const set = <K extends keyof SiteSettings['seo']>(key: K, value: SiteSettings['seo'][K]) => update('seo', { ...seo, [key]: value });
  const keywords = seo.keywords
    .split(/[,،]/)
    .map((k) => k.trim())
    .filter(Boolean);
  const host = typeof window !== 'undefined' ? window.location.host : 'example.com';

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_24rem]">
      <Card className="divide-y divide-line px-5 py-6 sm:px-7">
        <FormSection title="محركات البحث" description="العنوان والوصف اللي يطلعن بنتائج گوگل.">
          <div className="flex flex-col gap-4">
            <Field
              label="عنوان الموقع"
              hint="الأفضل أقل من 60 حرف."
              error={errors['seo.title']}
              aside={<span className={cn('num text-[0.6875rem]', seo.title.length > 60 ? 'text-warning' : 'text-subtle')}>{seo.title.length}/60</span>}
            >
              <Input value={seo.title} onChange={(e) => set('title', e.target.value)} maxLength={120} />
            </Field>
            <Field
              label="الوصف"
              hint="الأفضل بين 70 و160 حرف."
              error={errors['seo.description']}
              aside={<span className={cn('num text-[0.6875rem]', seo.description.length > 160 ? 'text-warning' : 'text-subtle')}>{seo.description.length}/160</span>}
            >
              <Textarea value={seo.description} onChange={(e) => set('description', e.target.value)} rows={3} maxLength={300} />
            </Field>
            <Field label="الكلمات المفتاحية" hint="اضغط Enter بعد كل كلمة." error={errors['seo.keywords']}>
              <ChipsInput value={keywords} onChange={(list) => set('keywords', list.join(', ').slice(0, 300))} max={25} maxLength={40} placeholder="تصوير، ريلز…" />
            </Field>
          </div>
        </FormSection>
        <FormSection
          title="صورة المشاركة"
          description={
            <>
              تطلع لمن أحد يشارك رابط موقعك بالواتساب أو انستغرام. المقاس المثالي{' '}
              <span className="num" dir="ltr">
                1200×630
              </span>
              .
            </>
          }
        >
          <ImageUploader
            label="صورة المشاركة"
            aspect="1200 / 630"
            value={urls.ogImageUrl}
            onUploaded={(image) => {
              set('ogImageKey', image.key);
              setUrls((u) => ({ ...u, ogImageUrl: image.url }));
            }}
            onRemove={() => {
              set('ogImageKey', null);
              setUrls((u) => ({ ...u, ogImageUrl: null }));
            }}
          />
          {errors['seo.ogImageKey'] && <p className="mt-2 text-xs text-danger">{errors['seo.ogImageKey']}</p>}
        </FormSection>
      </Card>

      <aside className="flex flex-col gap-5 xl:sticky xl:top-6 xl:self-start">
        <div>
          <p className="hud mb-2 text-subtle" dir="ltr">
            GOOGLE
          </p>
          <div className="rounded-2xl border border-line bg-white p-4 text-start" dir="rtl">
            <p className="num truncate text-xs text-[#4d5156]" dir="ltr">
              {host}
            </p>
            <p className="mt-1 line-clamp-1 text-lg leading-snug text-[#1a0dab]">{seo.title || 'عنوان الموقع'}</p>
            <p className="mt-1 line-clamp-2 text-[0.8125rem] leading-relaxed text-[#4d5156]">{seo.description || 'وصف الموقع…'}</p>
          </div>
        </div>
        <div>
          <p className="hud mb-2 text-subtle" dir="ltr">
            SHARE CARD
          </p>
          <div className="overflow-hidden rounded-2xl border border-line bg-surface-2">
            <div className="aspect-[1200/630] bg-surface-3">
              {urls.ogImageUrl ? (
                <img src={urls.ogImageUrl} alt="" className="size-full object-cover" />
              ) : (
                <div className="grid size-full place-items-center text-xs text-subtle">بدون صورة</div>
              )}
            </div>
            <div className="p-3">
              <p className="num text-[0.6875rem] uppercase text-subtle" dir="ltr">
                {host}
              </p>
              <p className="mt-0.5 line-clamp-1 text-sm font-semibold">{seo.title}</p>
              <p className="mt-0.5 line-clamp-2 text-xs text-muted">{seo.description}</p>
            </div>
          </div>
        </div>
      </aside>
    </div>
  );
}
