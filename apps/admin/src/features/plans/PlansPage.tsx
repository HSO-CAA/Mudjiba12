import { useEffect, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowDown, ArrowUp, CircleAlert, Copy, Crown, Ellipsis, Eye, Inbox, Pencil, Plus, Sparkles, Trash2, X } from 'lucide-react';
import type { AdminPlan, PlanInput, PlanPeriod } from '@s5y/shared';
import { ApiError } from '../../lib/api';
import { cn } from '../../lib/cn';
import { api } from '../../lib/endpoints';
import { CURRENCIES, formatPrice, normalizeDigits, PERIOD_LABELS } from '../../lib/format';
import { qk } from '../../lib/query';
import { Button, IconButton } from '../../components/ui/button';
import { useConfirm } from '../../components/ui/confirm';
import { Dialog } from '../../components/ui/dialog';
import { Counter, Field, Input, Select, Switch, SwitchRow } from '../../components/ui/form';
import { Menu } from '../../components/ui/menu';
import { Badge, Callout, Card, EmptyState, Skeleton } from '../../components/ui/misc';
import { PageHeader } from '../../components/ui/page';
import { DragHandle, Sortable } from '../../components/ui/sortable';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';
import { useSaveSettings, useSettings } from '../settings/hooks';
import { PlanCard } from './PlanCard';

const PERIODS: PlanPeriod[] = ['MONTHLY', 'QUARTERLY', 'YEARLY', 'ONE_TIME'];

function usePlans() {
  return useQuery({ queryKey: qk.plans, queryFn: () => api.plans.list() });
}

function usePlanMutations() {
  const queryClient = useQueryClient();
  const invalidate = () => void queryClient.invalidateQueries({ queryKey: qk.plans });
  const create = useMutation({
    meta: { silent: true },
    mutationFn: (input: PlanInput) => api.plans.create(input),
    onSuccess: (plan) => {
      queryClient.setQueryData<AdminPlan[]>(qk.plans, (list) => (list ? [...list, plan] : [plan]));
      invalidate();
    },
  });
  const update = useMutation({
    meta: { silent: true },
    mutationFn: ({ id, input }: { id: string; input: Partial<PlanInput> }) => api.plans.update(id, input),
    onMutate: async ({ id, input }) => {
      await queryClient.cancelQueries({ queryKey: qk.plans });
      const previous = queryClient.getQueryData<AdminPlan[]>(qk.plans);
      if (input.active !== undefined || input.highlighted !== undefined) {
        queryClient.setQueryData<AdminPlan[]>(qk.plans, (list) =>
          list?.map((p) => (p.id === id ? { ...p, ...(input.active !== undefined && { active: input.active }), ...(input.highlighted !== undefined && { highlighted: input.highlighted }) } : p)),
        );
      }
      return { previous };
    },
    onError: (error, _vars, context) => {
      if (context?.previous) queryClient.setQueryData(qk.plans, context.previous);
      if (!(error instanceof ApiError && error.code === 'VALIDATION_ERROR')) toast.error(error.message);
    },
    onSuccess: (plan) => {
      queryClient.setQueryData<AdminPlan[]>(qk.plans, (list) => list?.map((p) => (p.id === plan.id ? plan : p)));
    },
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.plans.remove(id),
    onSuccess: (_v, id) => {
      queryClient.setQueryData<AdminPlan[]>(qk.plans, (list) => list?.filter((p) => p.id !== id));
      void queryClient.invalidateQueries({ queryKey: qk.inquiriesAll });
    },
  });
  const reorder = useMutation({
    mutationFn: (ids: string[]) => api.plans.reorder(ids),
    onMutate: async (ids) => {
      await queryClient.cancelQueries({ queryKey: qk.plans });
      const previous = queryClient.getQueryData<AdminPlan[]>(qk.plans);
      if (previous) {
        const byId = new Map(previous.map((p) => [p.id, p]));
        queryClient.setQueryData<AdminPlan[]>(
          qk.plans,
          ids.flatMap((id, i) => {
            const p = byId.get(id);
            return p ? [{ ...p, sortOrder: i }] : [];
          }),
        );
      }
      return { previous };
    },
    onError: (_e, _v, context) => {
      if (context?.previous) queryClient.setQueryData(qk.plans, context.previous);
    },
    onSettled: invalidate,
  });
  return { create, update, remove, reorder };
}

export default function PlansPage() {
  useDocumentTitle('الباقات');
  const plans = usePlans();
  const { update, remove, reorder } = usePlanMutations();
  const confirm = useConfirm();
  const [editing, setEditing] = useState<AdminPlan | 'new' | null>(null);
  const [duplicateOf, setDuplicateOf] = useState<AdminPlan | null>(null);
  const list = plans.data ?? [];
  const activeCount = list.filter((p) => p.active).length;

  const onDelete = async (plan: AdminPlan) => {
    const ok = await confirm({
      title: `حذف باقة «${plan.name}»؟`,
      description: plan.inquiryCount
        ? `هذه الباقة مرتبطة بـ ${plan.inquiryCount} رسالة. الرسائل تبقى، بس راح تنشال الباقة منها.`
        : 'راح تنحذف الباقة نهائياً.',
      confirmLabel: 'احذف الباقة',
    });
    if (ok) remove.mutate(plan.id, { onSuccess: () => toast.success('تم حذف الباقة') });
  };

  return (
    <div>
      <PageHeader
        title="الباقات"
        description="باقات الاشتراك اللي تقدمها للأماكن. جهّزها هنا، وأظهرها بالموقع وقت ما تريد."
        actions={
          <Button variant="primary" icon={<Plus />} onClick={() => setEditing('new')}>
            باقة جديدة
          </Button>
        }
      />

      <PlansVisibility activeCount={activeCount} loadingPlans={plans.isPending} />

      {plans.isPending ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-96 rounded-2xl" />
          ))}
        </div>
      ) : plans.isError ? (
        <Card>
          <EmptyState icon={<CircleAlert />} title="تعذّر تحميل الباقات" description={plans.error.message} action={<Button onClick={() => void plans.refetch()}>إعادة المحاولة</Button>} />
        </Card>
      ) : list.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Crown />}
            title="ماكو باقات بعد"
            description="مثلاً: باقة أساسية (4 ريلز بالشهر)، وباقة احترافية (8 ريلز + تصوير منتجات)."
            action={
              <Button variant="primary" icon={<Plus />} onClick={() => setEditing('new')}>
                أنشئ أول باقة
              </Button>
            }
          />
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <Sortable items={list} onReorder={(next) => reorder.mutate(next.map((p) => p.id))}>
            {(plan, props) => (
              <div ref={props.setNodeRef} style={props.style} className="flex flex-col">
                <div
                  className={cn(
                    'flex flex-1 flex-col rounded-[1.25rem] border bg-surface p-2 transition-[border-color,box-shadow]',
                    props.isDragging ? 'border-accent/50 shadow-(--shadow-pop)' : 'border-line',
                    !plan.active && 'opacity-70',
                  )}
                >
                  <div className="flex items-center gap-1 px-1 pb-2">
                    <DragHandle handle={props.handle} />
                    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
                      {plan.active ? (
                        <Badge tone="success" dot>
                          فعّالة
                        </Badge>
                      ) : (
                        <Badge tone="neutral">موقوفة</Badge>
                      )}
                      {plan.inquiryCount > 0 && (
                        <Badge tone="neutral" icon={<Inbox />}>
                          <span className="num">{plan.inquiryCount}</span> طلب
                        </Badge>
                      )}
                    </div>
                    <Switch
                      size="sm"
                      checked={plan.active}
                      label={plan.active ? 'إيقاف الباقة' : 'تفعيل الباقة'}
                      onChange={(active) => update.mutate({ id: plan.id, input: { active } })}
                    />
                    <Menu
                      trigger={(p) => (
                        <IconButton label="خيارات الباقة" size="sm" {...p}>
                          <Ellipsis />
                        </IconButton>
                      )}
                      items={[
                        { label: 'تعديل', icon: <Pencil />, onSelect: () => setEditing(plan) },
                        {
                          label: plan.highlighted ? 'إلغاء التمييز' : 'تمييز كـ«الأكثر طلباً»',
                          icon: <Sparkles />,
                          onSelect: () => update.mutate({ id: plan.id, input: { highlighted: !plan.highlighted } }),
                        },
                        {
                          label: 'نسخة مكررة',
                          icon: <Copy />,
                          onSelect: () => {
                            setDuplicateOf(plan);
                            setEditing('new');
                          },
                        },
                        { label: 'حذف', icon: <Trash2 />, tone: 'danger', separated: true, onSelect: () => void onDelete(plan) },
                      ]}
                    />
                  </div>
                  <button type="button" onClick={() => setEditing(plan)} className="flex flex-1 flex-col text-start" aria-label={`تعديل ${plan.name}`}>
                    <PlanCard plan={plan} className="flex-1" />
                  </button>
                </div>
              </div>
            )}
          </Sortable>
        </div>
      )}

      <PlanEditor
        plan={editing === 'new' ? null : editing}
        template={editing === 'new' ? duplicateOf : null}
        open={editing !== null}
        onClose={() => {
          setEditing(null);
          setDuplicateOf(null);
        }}
      />
    </div>
  );
}

function PlansVisibility({ activeCount, loadingPlans }: { activeCount: number; loadingPlans: boolean }) {
  const settings = useSettings();
  const save = useSaveSettings({ optimistic: true });
  const enabled = settings.data?.settings.sections.plans ?? false;

  const toggle = (next: boolean) => {
    const current = settings.data?.settings;
    if (!current) return;
    save.mutate(
      { ...current, sections: { ...current.sections, plans: next } },
      { onSuccess: () => toast.success(next ? 'الباقات صارت ظاهرة بالموقع' : 'تم إخفاء الباقات من الموقع') },
    );
  };

  return (
    <Card className="mb-6 overflow-hidden">
      <div className="flex items-center gap-4 p-5 sm:p-6">
        <span className={cn('grid size-11 shrink-0 place-items-center rounded-xl', enabled ? 'bg-accent/15 text-accent' : 'bg-white/[0.05] text-muted')}>
          <Eye className="size-5" aria-hidden />
        </span>
        <label htmlFor="plans-visibility" className="min-w-0 flex-1 cursor-pointer">
          <span className="block font-semibold">اعرض الباقات بالموقع</span>
          <span className="mt-0.5 block text-[0.8125rem] leading-relaxed text-muted">
            لمن تشغّله، يطلع قسم «الباقات» بالصفحة الرئيسية، والزبون يگدر يختار باقة من فورم التواصل. الباقات الموقوفة ما تنعرض أبداً.
          </span>
        </label>
        {settings.isPending ? (
          <Skeleton className="h-6 w-10.5 rounded-full" />
        ) : (
          <Switch id="plans-visibility" checked={enabled} onChange={toggle} disabled={!settings.data || save.isPending} label="اعرض الباقات بالموقع" />
        )}
      </div>
      {enabled && !loadingPlans && activeCount === 0 && (
        <div className="border-t border-line px-5 py-3 sm:px-6">
          <Callout tone="warning" icon={<CircleAlert />} className="border-0 bg-transparent p-0">
            القسم مفعّل، بس ماكو ولا باقة فعّالة — فما راح يطلع شي بالموقع لحد ما تفعّل باقة.
          </Callout>
        </div>
      )}
    </Card>
  );
}

/* ─────────────────────────── Editor ─────────────────────────── */

interface PlanForm {
  name: string;
  tagline: string;
  onRequest: boolean;
  price: string;
  currency: string;
  period: PlanPeriod;
  features: string[];
  highlighted: boolean;
  ctaLabel: string;
  active: boolean;
}

const emptyForm: PlanForm = {
  name: '',
  tagline: '',
  onRequest: false,
  price: '',
  currency: 'IQD',
  period: 'MONTHLY',
  features: [],
  highlighted: false,
  ctaLabel: '',
  active: true,
};

function toForm(plan: AdminPlan, copy = false): PlanForm {
  return {
    name: copy ? `${plan.name} (نسخة)`.slice(0, 80) : plan.name,
    tagline: plan.tagline ?? '',
    onRequest: plan.price === null,
    price: plan.price === null ? '' : String(plan.price),
    currency: plan.currency,
    period: plan.period,
    features: plan.features,
    highlighted: copy ? false : plan.highlighted,
    ctaLabel: plan.ctaLabel ?? '',
    active: plan.active,
  };
}

function toInput(form: PlanForm): PlanInput {
  return {
    name: form.name.trim(),
    tagline: form.tagline.trim() || null,
    price: form.onRequest || form.price === '' ? null : Number(form.price),
    currency: form.currency,
    period: form.period,
    features: form.features.map((f) => f.trim()).filter(Boolean),
    highlighted: form.highlighted,
    ctaLabel: form.ctaLabel.trim() || null,
    active: form.active,
  };
}


function PlanEditor({ plan, template, open, onClose }: { plan: AdminPlan | null; template: AdminPlan | null; open: boolean; onClose: () => void }) {
  const { create, update } = usePlanMutations();
  const settings = useSettings();
  const [form, setForm] = useState<PlanForm>(emptyForm);
  const [draftFeature, setDraftFeature] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!open) return;
    setForm(plan ? toForm(plan) : template ? toForm(template, true) : emptyForm);
    setDraftFeature('');
    setErrors({});
  }, [open, plan, template]);

  const set = <K extends keyof PlanForm>(key: K, value: PlanForm[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
    // Fixing a field clears its error (choosing «حسب الطلب» also answers the price error).
    const field = key === 'onRequest' ? 'price' : key;
    setErrors((prev) => {
      if (!(field in prev)) return prev;
      const next = { ...prev };
      delete next[field];
      return next;
    });
  };
  const saving = create.isPending || update.isPending;

  const addFeature = () => {
    const value = draftFeature.trim();
    if (!value || form.features.length >= 30) return;
    set('features', [...form.features, value.slice(0, 120)]);
    setDraftFeature('');
  };
  const moveFeature = (index: number, delta: number) => {
    const next = [...form.features];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    set('features', next);
  };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    const local: Record<string, string> = {};
    if (!form.name.trim()) local.name = 'اكتب اسم الباقة';
    if (!form.onRequest && form.price === '') local.price = 'اكتب السعر أو اختار «حسب الطلب»';
    if (Object.keys(local).length) {
      setErrors(local);
      return;
    }
    const features = draftFeature.trim() ? [...form.features, draftFeature.trim()] : form.features;
    const input = toInput({ ...form, features });
    const onError = (error: Error) => {
      if (error instanceof ApiError && error.code === 'VALIDATION_ERROR') {
        setErrors(error.fieldErrors);
        toast.error(error.message);
      } else if (!plan) {
        toast.error(error.message);
      }
    };
    if (plan) {
      update.mutate(
        { id: plan.id, input },
        {
          onSuccess: () => {
            toast.success('تم حفظ الباقة');
            onClose();
          },
          onError,
        },
      );
    } else {
      create.mutate(input, {
        onSuccess: () => {
          toast.success('تمت إضافة الباقة');
          onClose();
        },
        onError,
      });
    }
  };

  const preview = toInput(form);

  return (
    <Dialog
      open={open}
      onClose={() => !saving && onClose()}
      dismissible={!saving}
      title={plan ? `تعديل «${plan.name}»` : 'باقة جديدة'}
      size="xl"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            إلغاء
          </Button>
          <Button variant="primary" type="submit" form="plan-form" loading={saving}>
            {plan ? 'حفظ الباقة' : 'إضافة الباقة'}
          </Button>
        </>
      }
    >
      <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_18rem]">
        <form id="plan-form" onSubmit={onSubmit} className="flex flex-col gap-4">
          <Field label="اسم الباقة" required error={errors.name} aside={<Counter value={form.name} max={80} />}>
            <Input value={form.name} onChange={(e) => set('name', e.target.value)} maxLength={80} placeholder="مثلاً: الباقة الاحترافية" data-autofocus />
          </Field>
          <Field label="وصف قصير" error={errors.tagline} aside={<Counter value={form.tagline} max={160} />}>
            <Input value={form.tagline} onChange={(e) => set('tagline', e.target.value)} maxLength={160} placeholder="للأماكن اللي تريد حضور قوي كل أسبوع" />
          </Field>

          <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_9rem]">
            <Field label="السعر" error={errors.price} hint={form.onRequest ? 'راح يطلع «حسب الطلب» بدل السعر.' : form.price ? formatPrice(Number(form.price), form.currency).text : undefined}>
              <Input
                value={form.onRequest ? '' : form.price}
                onChange={(e) => set('price', normalizeDigits(e.target.value).replace(/\D/g, '').slice(0, 10))}
                inputMode="numeric"
                ltr
                disabled={form.onRequest}
                placeholder={form.onRequest ? 'حسب الطلب' : '250000'}
                className="num"
              />
            </Field>
            <Field label="العملة" error={errors.currency}>
              <Select value={form.currency} onChange={(e) => set('currency', e.target.value)}>
                {CURRENCIES.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.label}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <label className="-mt-1 flex cursor-pointer items-center gap-2.5 text-[0.8125rem] text-fg-2">
            <Switch size="sm" checked={form.onRequest} onChange={(v) => set('onRequest', v)} label="السعر حسب الطلب" />
            السعر حسب الطلب
          </label>

          <Field label="المدة" error={errors.period}>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {PERIODS.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => set('period', p)}
                  aria-pressed={form.period === p}
                  className={cn(
                    'h-10 rounded-xl border text-[0.8125rem] font-medium transition-colors',
                    form.period === p ? 'border-accent/60 bg-accent/10 text-accent' : 'border-line bg-surface-2 text-fg-2 hover:border-line-strong',
                  )}
                >
                  {PERIOD_LABELS[p]}
                </button>
              ))}
            </div>
          </Field>

          <Field label="المميزات" hint="كل سطر ميزة، مثل «4 ريلز بالشهر» أو «تصوير بكاميرا سينمائية»." error={errors.features}>
            <div className="flex flex-col gap-2">
              {form.features.length > 0 && (
                <ul className="flex flex-col gap-1.5">
                  {form.features.map((feature, index) => (
                    <li key={index} className="flex items-center gap-1 rounded-xl border border-line bg-surface-2 py-1 pe-1 ps-3">
                      <input
                        value={feature}
                        onChange={(e) => set('features', form.features.map((f, i) => (i === index ? e.target.value.slice(0, 120) : f)))}
                        className="h-8 min-w-0 flex-1 bg-transparent text-[0.8125rem] focus:outline-none"
                        aria-label={`الميزة ${index + 1}`}
                      />
                      <IconButton label="تحريك للأعلى" size="xs" disabled={index === 0} onClick={() => moveFeature(index, -1)}>
                        <ArrowUp />
                      </IconButton>
                      <IconButton label="تحريك للأسفل" size="xs" disabled={index === form.features.length - 1} onClick={() => moveFeature(index, 1)}>
                        <ArrowDown />
                      </IconButton>
                      <IconButton label="حذف الميزة" size="xs" onClick={() => set('features', form.features.filter((_, i) => i !== index))}>
                        <X />
                      </IconButton>
                    </li>
                  ))}
                </ul>
              )}
              <div className="flex gap-2">
                <Input
                  value={draftFeature}
                  onChange={(e) => setDraftFeature(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      addFeature();
                    }
                  }}
                  placeholder="أضف ميزة…"
                  maxLength={120}
                  enterKeyHint="enter"
                  className="flex-1"
                  aria-label="ميزة جديدة"
                />
                <Button onClick={addFeature} disabled={!draftFeature.trim() || form.features.length >= 30} icon={<Plus />}>
                  إضافة
                </Button>
              </div>
            </div>
          </Field>

          <Field label="نص الزر" hint="اختياري. الافتراضي «اطلب الباقة»." error={errors.ctaLabel} aside={<Counter value={form.ctaLabel} max={40} />}>
            <Input value={form.ctaLabel} onChange={(e) => set('ctaLabel', e.target.value)} maxLength={40} placeholder="اطلب الباقة" />
          </Field>

          <div className="divide-y divide-line rounded-xl border border-line px-4">
            <SwitchRow icon={<Sparkles />} title="الأكثر طلباً" description="تتميز بإضاءة وشارة، وتنصح بيها الزبون." checked={form.highlighted} onChange={(v) => set('highlighted', v)} />
            <SwitchRow icon={<Eye />} title="فعّالة" description="الباقات الموقوفة تبقى هنا بس ما تنعرض." checked={form.active} onChange={(v) => set('active', v)} />
          </div>
        </form>

        <aside>
          <p className="hud mb-2 text-subtle" dir="ltr">
            LIVE PREVIEW
          </p>
          <div className="md:sticky md:top-0">
            <PlanCard plan={{ ...preview, price: preview.price ?? null, tagline: preview.tagline ?? null, ctaLabel: preview.ctaLabel ?? null, currency: preview.currency ?? 'IQD', period: preview.period ?? 'MONTHLY', features: preview.features ?? [], highlighted: preview.highlighted ?? false }} accent={settings.data?.settings.brand.accent} />
          </div>
        </aside>
      </div>
    </Dialog>
  );
}
