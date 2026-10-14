import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ChevronLeft, ChevronRight, CircleAlert, Copy, Crown, Inbox, Mail, MessageSquareText, Phone, Search, Trash2 } from 'lucide-react';
import type { AdminInquiry, InquiryList, InquiryStatus, InquiryUpdateInput } from '@s5y/shared';
import { cn } from '../../lib/cn';
import { api } from '../../lib/endpoints';
import { digitsOnly, formatDateTime, formatSource, formatRelative, INQUIRY_STATUS_LABELS, INQUIRY_STATUSES, normalizeDigits } from '../../lib/format';
import { qk } from '../../lib/query';
import { WhatsAppIcon } from '../../components/ui/brand-icons';
import { Button, buttonStyles, IconButton } from '../../components/ui/button';
import { useConfirm } from '../../components/ui/confirm';
import { Dialog } from '../../components/ui/dialog';
import { Input, Textarea } from '../../components/ui/form';
import { Badge, Card, EmptyState, Skeleton } from '../../components/ui/misc';
import { PageHeader } from '../../components/ui/page';
import { Tabs } from '../../components/ui/tabs';
import { useDebounced } from '../../hooks/useDebounced';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';
import { useIsDesktop } from '../../hooks/useMediaQuery';
import { useUser } from '../auth/session';
import { INQUIRY_ICONS, InquiryStatusBadge } from './InquiryStatusBadge';

const PAGE_SIZE = 20;
type TabValue = 'ALL' | InquiryStatus;

/** Iraqi local numbers (07xx…) → international for wa.me. */
function whatsappNumber(phone: string): string | null {
  let digits = digitsOnly(normalizeDigits(phone));
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.startsWith('0') && digits.length === 11) digits = `964${digits.slice(1)}`;
  return digits.length >= 8 ? digits : null;
}

function useUpdateInquiry() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: InquiryUpdateInput }) => api.inquiries.update(id, input),
    onMutate: async ({ id, input }) => {
      await queryClient.cancelQueries({ queryKey: qk.inquiriesAll });
      const previous = queryClient.getQueriesData<InquiryList>({ queryKey: qk.inquiriesAll });
      queryClient.setQueriesData<InquiryList>({ queryKey: qk.inquiriesAll }, (list) =>
        list?.items ? { ...list, items: list.items.map((i) => (i.id === id ? { ...i, ...input } : i)) } : list,
      );
      return { previous };
    },
    onError: (_e, _v, context) => {
      for (const [key, data] of context?.previous ?? []) queryClient.setQueryData(key, data);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: qk.inquiriesAll });
      void queryClient.invalidateQueries({ queryKey: qk.overviewAll });
    },
  });
}

export default function InquiriesPage() {
  useDocumentTitle('الرسائل');
  const [params, setParams] = useSearchParams();
  const [tab, setTab] = useState<TabValue>('ALL');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  // Phone keyboards type Arabic-Indic digits; stored numbers use Latin ones.
  const q = useDebounced(normalizeDigits(search.trim()), 300);
  const isDesktop = useIsDesktop();
  const openId = params.get('open');
  const [selected, setSelected] = useState<AdminInquiry | null>(null);

  useEffect(() => setPage(1), [tab, q]);

  const query = { status: tab === 'ALL' ? undefined : tab, q: q || undefined, page, pageSize: PAGE_SIZE };
  const list = useQuery({
    queryKey: qk.inquiries(query),
    queryFn: () => api.inquiries.list(query),
    placeholderData: keepPreviousData,
    refetchInterval: 60_000,
  });

  const items = list.data?.items ?? [];
  // Keep the open inquiry in sync with fresh list data.
  const current = useMemo(() => {
    const id = selected?.id ?? openId;
    if (!id) return null;
    return items.find((i) => i.id === id) ?? (selected?.id === id ? selected : null);
  }, [items, selected, openId]);

  useEffect(() => {
    if (!isDesktop || current || items.length === 0 || openId) return;
    setSelected(items[0]);
  }, [isDesktop, current, items, openId]);

  const select = (inquiry: AdminInquiry | null) => {
    setSelected(inquiry);
    setParams(inquiry ? { open: inquiry.id } : {}, { replace: true });
  };

  const counts = list.data?.counts;
  const total = counts ? INQUIRY_STATUSES.reduce((s, k) => s + counts[k], 0) : undefined;
  const tabs = [
    { value: 'ALL' as const, label: 'الكل', count: total },
    ...INQUIRY_STATUSES.map((s) => ({ value: s, label: INQUIRY_STATUS_LABELS[s], count: counts?.[s] })),
  ];
  const pages = list.data ? Math.max(1, Math.ceil(list.data.total / PAGE_SIZE)) : 1;

  // Deleting/re-filing the last messages of the last page would leave an empty page: step back.
  useEffect(() => {
    if (list.data && !list.isPlaceholderData && list.data.items.length === 0 && page > pages) setPage(pages);
  }, [list.data, list.isPlaceholderData, page, pages]);

  return (
    <div>
      <PageHeader title="الرسائل" description="طلبات الزبائن من فورم التواصل بالموقع. تابع كل طلب لحد ما تتفقون." />

      <Tabs label="حالة الرسائل" items={tabs} value={tab} onChange={setTab} className="mb-4" />

      <div className="grid gap-5 lg:grid-cols-[minmax(0,24rem)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-3">
          <Input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="ابحث بالاسم أو الرقم أو نص الرسالة…"
            start={<Search />}
            aria-label="بحث بالرسائل"
          />
          <Card
            className={cn(
              'overflow-hidden transition-opacity lg:max-h-[calc(100dvh-16rem)] lg:overflow-y-auto',
              list.isPlaceholderData && 'opacity-60',
            )}
          >
            {list.isPending ? (
              <div className="flex flex-col divide-y divide-line">
                {Array.from({ length: 6 }, (_, i) => (
                  <div key={i} className="flex gap-3 p-4">
                    <Skeleton className="size-9 shrink-0 rounded-full" />
                    <div className="flex-1">
                      <Skeleton className="h-3.5 w-1/2" />
                      <Skeleton className="mt-2 h-3 w-full" />
                    </div>
                  </div>
                ))}
              </div>
            ) : list.isError ? (
              <EmptyState compact icon={<CircleAlert />} title="تعذّر تحميل الرسائل" description={list.error.message} />
            ) : items.length === 0 ? (
              <EmptyState
                compact
                icon={<Inbox />}
                title={q ? 'ماكو نتائج' : tab === 'ALL' ? 'ماكو رسائل بعد' : `ماكو رسائل «${INQUIRY_STATUS_LABELS[tab]}»`}
                description={q ? 'جرّب كلمة ثانية.' : 'لمن أحد يراسلك من الموقع، رسالته تطلع هنا.'}
              />
            ) : (
              <ul className="flex flex-col divide-y divide-line" role="listbox" aria-label="الرسائل">
                {items.map((inquiry) => {
                  const active = current?.id === inquiry.id;
                  return (
                    <li key={inquiry.id} role="option" aria-selected={active}>
                      <button
                        type="button"
                        onClick={() => select(inquiry)}
                        className={cn(
                          'relative flex w-full items-start gap-3 px-4 py-3.5 text-start transition-colors',
                          active ? 'bg-white/[0.05]' : 'hover:bg-white/[0.025]',
                        )}
                      >
                        {active && <span className="absolute inset-y-3 start-0 w-0.5 rounded-full bg-accent" aria-hidden />}
                        <span className="relative mt-0.5 grid size-9 shrink-0 place-items-center rounded-full bg-surface-3 text-sm font-semibold text-fg-2">
                          {inquiry.name.trim().charAt(0)}
                          {inquiry.status === 'NEW' && <span className="absolute -end-0.5 -top-0.5 size-2.5 rounded-full bg-accent ring-2 ring-surface" aria-label="جديد" />}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex items-baseline justify-between gap-2">
                            <span className={cn('truncate text-sm', inquiry.status === 'NEW' ? 'font-semibold text-fg' : 'font-medium text-fg-2')}>
                              {inquiry.name}
                            </span>
                            <span className="shrink-0 text-[0.6875rem] text-subtle">{formatRelative(inquiry.createdAt)}</span>
                          </span>
                          <span className="mt-0.5 line-clamp-2 block text-xs leading-relaxed text-muted">{inquiry.message}</span>
                          <span className="mt-2 flex flex-wrap items-center gap-1.5">
                            <InquiryStatusBadge status={inquiry.status} className="h-5 px-2 text-[0.6875rem]" />
                            {inquiry.planName && (
                              <Badge tone="neutral" icon={<Crown />} className="h-5 px-2 text-[0.6875rem]">
                                {inquiry.planName}
                              </Badge>
                            )}
                          </span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
          {list.data && list.data.total > PAGE_SIZE && (
            <div className="flex items-center justify-between gap-2 text-xs text-muted">
              <span>
                <span className="num" dir="ltr">
                  {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, list.data.total)}
                </span>{' '}
                من <span className="num">{list.data.total}</span>
              </span>
              <div className="flex gap-1">
                <IconButton label="الصفحة السابقة" size="sm" variant="secondary" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                  <ChevronRight />
                </IconButton>
                <IconButton label="الصفحة التالية" size="sm" variant="secondary" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
                  <ChevronLeft />
                </IconButton>
              </div>
            </div>
          )}
        </div>

        {isDesktop ? (
          <Card className="sticky top-6 min-h-[28rem] self-start">
            {current ? (
              <InquiryDetail key={current.id} inquiry={current} onDeleted={() => select(null)} />
            ) : (
              <EmptyState icon={<MessageSquareText />} title="اختار رسالة" description="تفاصيل الرسالة وأزرار التواصل تطلع هنا." />
            )}
          </Card>
        ) : (
          <Dialog open={current !== null} onClose={() => select(null)} title={current?.name ?? ''} size="lg" bodyClassName="pb-6">
            {current && <InquiryDetail key={current.id} inquiry={current} onDeleted={() => select(null)} bare />}
          </Dialog>
        )}
      </div>
    </div>
  );
}

function InquiryDetail({ inquiry, onDeleted, bare = false }: { inquiry: AdminInquiry; onDeleted: () => void; bare?: boolean }) {
  const update = useUpdateInquiry();
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const user = useUser();
  const [notes, setNotes] = useState(inquiry.notes ?? '');
  const notesDirty = notes.trim() !== (inquiry.notes ?? '').trim();

  const remove = useMutation({
    mutationFn: () => api.inquiries.remove(inquiry.id),
    onSuccess: () => {
      toast.success('تم حذف الرسالة');
      onDeleted();
      void queryClient.invalidateQueries({ queryKey: qk.inquiriesAll });
      void queryClient.invalidateQueries({ queryKey: qk.overviewAll });
    },
  });

  const wa = inquiry.phone ? whatsappNumber(inquiry.phone) : null;
  const greeting = `هلا ${inquiry.name}، أنا ${user?.name ?? 'S5Y'}. وصلتني رسالتك من الموقع.`;

  const setStatus = (status: InquiryStatus) => {
    if (status === inquiry.status) return;
    update.mutate({ id: inquiry.id, input: { status } }, { onSuccess: () => toast.success(`صارت «${INQUIRY_STATUS_LABELS[status]}»`) });
  };

  const markContacted = () => {
    if (inquiry.status === 'NEW') update.mutate({ id: inquiry.id, input: { status: 'CONTACTED' } });
  };

  return (
    <div className={cn('flex flex-col gap-5', !bare && 'p-5 sm:p-6')}>
      <div className="flex items-start gap-3">
        <span className="grid size-11 shrink-0 place-items-center rounded-full bg-linear-to-br from-surface-4 to-surface-2 text-base font-semibold text-fg">
          {inquiry.name.trim().charAt(0)}
        </span>
        <div className="min-w-0 flex-1">
          {!bare && <h2 className="truncate text-lg font-semibold">{inquiry.name}</h2>}
          <p className="text-xs text-muted">{formatDateTime(inquiry.createdAt)}</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <InquiryStatusBadge status={inquiry.status} />
            {inquiry.planName && (
              <Badge tone="accent" icon={<Crown />}>
                باقة: {inquiry.planName}
              </Badge>
            )}
            {inquiry.source && (
              <Badge tone="neutral">من: {formatSource(inquiry.source)}</Badge>
            )}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {wa && (
          <a
            href={`https://wa.me/${wa}?text=${encodeURIComponent(greeting)}`}
            target="_blank"
            rel="noopener"
            onClick={markContacted}
            className={buttonStyles({ variant: 'primary', className: 'shadow-none hover:brightness-110' })}
            style={{ background: '#25d366', color: '#052e14' }}
          >
            <WhatsAppIcon /> واتساب
          </a>
        )}
        {inquiry.phone && (
          <a href={`tel:${normalizeDigits(inquiry.phone).replace(/[^\d+]/g, '')}`} onClick={markContacted} className={buttonStyles({ variant: 'secondary' })}>
            <Phone /> اتصال
          </a>
        )}
        {inquiry.email && (
          <a href={`mailto:${inquiry.email}?subject=${encodeURIComponent('بخصوص رسالتك')}`} onClick={markContacted} className={buttonStyles({ variant: 'secondary' })}>
            <Mail /> إيميل
          </a>
        )}
      </div>

      <dl className="grid gap-3 rounded-xl border border-line bg-surface-2/50 p-4 text-[0.8125rem] sm:grid-cols-2">
        <div className="min-w-0">
          <dt className="text-xs text-muted">الهاتف</dt>
          <dd className="mt-0.5 flex items-center gap-1.5">
            {inquiry.phone ? (
              <>
                <span className="num truncate" dir="ltr">
                  {inquiry.phone}
                </span>
                <CopyButton value={inquiry.phone} />
              </>
            ) : (
              <span className="text-subtle">—</span>
            )}
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="text-xs text-muted">البريد</dt>
          <dd className="mt-0.5 flex items-center gap-1.5">
            {inquiry.email ? (
              <>
                <span className="num truncate" dir="ltr">
                  {inquiry.email}
                </span>
                <CopyButton value={inquiry.email} />
              </>
            ) : (
              <span className="text-subtle">—</span>
            )}
          </dd>
        </div>
      </dl>

      <div>
        <h3 className="mb-2 text-xs font-medium text-muted">الرسالة</h3>
        <p className="whitespace-pre-wrap rounded-xl border border-line bg-surface-2/30 p-4 text-[0.9375rem] leading-relaxed text-fg">{inquiry.message}</p>
      </div>

      <div>
        <h3 className="mb-2 text-xs font-medium text-muted">الحالة</h3>
        <div role="radiogroup" aria-label="حالة الرسالة" className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
          {INQUIRY_STATUSES.map((s) => {
            const active = inquiry.status === s;
            return (
              <button
                key={s}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => setStatus(s)}
                className={cn(
                  'flex h-10 items-center justify-center gap-1.5 rounded-xl border text-[0.8125rem] font-medium transition-colors [&_svg]:size-3.5',
                  active ? 'border-accent/50 bg-accent/10 text-accent' : 'border-line bg-surface-2 text-fg-2 hover:border-line-strong',
                )}
              >
                {INQUIRY_ICONS[s]}
                {INQUIRY_STATUS_LABELS[s]}
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <h3 className="mb-2 text-xs font-medium text-muted">ملاحظات خاصة</h3>
        <Textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          maxLength={5000}
          placeholder="مثلاً: اتفقنا على 4 ريلز بالشهر، التصوير يوم الخميس…"
          aria-label="ملاحظات خاصة"
        />
        <div className="mt-2 flex items-center justify-between gap-2">
          <span className="text-[0.6875rem] text-subtle">الملاحظات ما تنعرض لأحد غيرك.</span>
          <Button
            size="sm"
            variant={notesDirty ? 'primary' : 'secondary'}
            disabled={!notesDirty}
            loading={update.isPending && update.variables?.input.notes !== undefined}
            onClick={() =>
              update.mutate({ id: inquiry.id, input: { notes: notes.trim() || null } }, { onSuccess: () => toast.success('تم حفظ الملاحظات') })
            }
          >
            حفظ الملاحظات
          </Button>
        </div>
      </div>

      <div className="flex justify-end border-t border-line pt-4">
        <Button
          variant="danger-ghost"
          size="sm"
          icon={<Trash2 />}
          loading={remove.isPending}
          onClick={async () => {
            const ok = await confirm({ title: 'حذف الرسالة؟', description: `راح تنحذف رسالة «${inquiry.name}» نهائياً.`, confirmLabel: 'احذف' });
            if (ok) remove.mutate();
          }}
        >
          حذف الرسالة
        </Button>
      </div>
    </div>
  );
}

function CopyButton({ value }: { value: string }) {
  return (
    <IconButton
      label="نسخ"
      size="xs"
      onClick={() => {
        void navigator.clipboard
          ?.writeText(value)
          .then(() => toast.success('تم النسخ'))
          .catch(() => toast.error('ما گدرنا ننسخ'));
      }}
    >
      <Copy />
    </IconButton>
  );
}
