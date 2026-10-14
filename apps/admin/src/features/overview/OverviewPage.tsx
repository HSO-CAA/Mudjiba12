import { useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import {
  ArrowUpLeft,
  CircleAlert,
  CircleCheck,
  Clapperboard,
  Eye,
  HardDrive,
  Inbox,
  LoaderCircle,
  Play,
  Store,
  Table2,
  ChartSpline,
  TriangleAlert,
} from 'lucide-react';
import type { AdminVideoWithPlace, Overview } from '@s5y/shared';
import { cn } from '../../lib/cn';
import { api } from '../../lib/endpoints';
import { formatBytes, formatCompact, formatNumber, formatRelative, formatSeriesDate, INQUIRY_STATUS_LABELS } from '../../lib/format';
import { qk } from '../../lib/query';
import { Sparkline, TrendChart, type TrendSeries } from '../../components/charts/TrendChart';
import { Badge, Callout, Card, CardHeader, EmptyState, Skeleton } from '../../components/ui/misc';
import { PageHeader } from '../../components/ui/page';
import { Segmented } from '../../components/ui/tabs';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';
import { useUser } from '../auth/session';
import { InquiryStatusBadge } from '../inquiries/InquiryStatusBadge';
import { VideoThumb } from '../videos/VideoThumb';

type Range = '7' | '30' | '90';
const RANGES: { value: Range; label: string }[] = [
  { value: '7', label: '7 أيام' },
  { value: '30', label: '30 يوم' },
  { value: '90', label: '90 يوم' },
];

const SERIES: TrendSeries[] = [
  { key: 'views', label: 'زيارات', color: 'var(--color-series-views)', area: true },
  { key: 'plays', label: 'مشاهدات فيديو', color: 'var(--color-series-plays)' },
];

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'صباح الخير';
  if (hour < 18) return 'هلا';
  return 'مساء الخير';
}

export default function OverviewPage() {
  useDocumentTitle('نظرة عامة');
  const user = useUser();
  const [range, setRange] = useState<Range>('30');
  const days = Number(range);

  const overview = useQuery({
    queryKey: qk.overview(days),
    queryFn: () => api.overview(days),
    placeholderData: keepPreviousData,
    refetchInterval: 60_000,
  });

  const data = overview.data;

  return (
    <div>
      <PageHeader
        title={`${greeting()}${user?.name ? `، ${user.name.split(' ')[0]}` : ''}`}
        description="ملخص سريع لشغلك وزيارات الموقع."
        actions={<Segmented label="المدة" items={RANGES} value={range} onChange={setRange} />}
      />

      {data && !data.mediaProcessing && (
        <Callout
          tone="warning"
          icon={<TriangleAlert />}
          title="معالجة الفيديو متوقفة على الخادم"
          className="mb-6"
        >
          ما لگينا ffmpeg على الخادم، فالفيديوهات تنعرض مثل ما رفعتها بدون ضغط أو معاينة قصيرة أو غلاف تلقائي. ثبّت ffmpeg حتى تتجهز
          الفيديوهات للويب.
        </Callout>
      )}

      {overview.isError && !data ? (
        <Card>
          <EmptyState
            icon={<CircleAlert />}
            title="تعذّر تحميل الإحصائيات"
            description={overview.error.message}
            action={
              <button type="button" className="text-sm text-accent hover:underline" onClick={() => void overview.refetch()}>
                إعادة المحاولة
              </button>
            }
          />
        </Card>
      ) : (
        <div className="flex flex-col gap-5">
          <KpiRow data={data} days={days} />
          <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_22rem]">
            <TrendCard data={data} days={days} loading={overview.isPending} refetching={overview.isPlaceholderData} />
            <ProcessingCard counts={data?.counts} />
          </div>
          <div className="grid gap-5 lg:grid-cols-2 2xl:grid-cols-3">
            <TopVideosCard videos={data?.topVideos} />
            <TopPlacesCard places={data?.topPlaces} days={days} />
            <RecentInquiriesCard data={data} className="lg:col-span-2 2xl:col-span-1" />
          </div>
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────── KPI tiles ─────────────────────────── */

function StatTile({
  label,
  value,
  icon,
  sub,
  trend,
  to,
  loading,
}: {
  label: string;
  value: string;
  icon: ReactNode;
  sub?: ReactNode;
  trend?: number[];
  to?: string;
  loading?: boolean;
}) {
  const body = (
    <>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[0.8125rem] text-muted">{label}</span>
        <span className="grid size-7 place-items-center rounded-lg bg-white/[0.04] text-subtle transition-colors group-hover:text-accent [&_svg]:size-3.5">
          {icon}
        </span>
      </div>
      {loading ? (
        <>
          <Skeleton className="mt-3 h-7 w-20" />
          <Skeleton className="mt-2.5 h-3.5 w-28" />
        </>
      ) : (
        <>
          <div className="mt-2 flex min-w-0 items-end justify-between gap-2">
            <span className="num truncate text-[1.625rem] font-semibold leading-none text-fg" dir="ltr">
              {value}
            </span>
            {trend && <Sparkline values={trend} className="hidden shrink-0 sm:block" />}
          </div>
          {sub && <div className="mt-2.5 truncate text-xs text-muted">{sub}</div>}
        </>
      )}
    </>
  );
  const cls = 'group block rounded-2xl border border-line bg-surface p-4 transition-colors sm:p-5';
  return to ? (
    <Link to={to} className={cn(cls, 'hover:border-line-strong hover:bg-surface-2/60')}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

function KpiRow({ data, days }: { data: Overview | undefined; days: number }) {
  const totals = useMemo(() => {
    const series = data?.series ?? [];
    return {
      views: series.reduce((s, d) => s + d.views, 0),
      plays: series.reduce((s, d) => s + d.plays, 0),
      viewsTrend: series.slice(-14).map((d) => d.views),
      playsTrend: series.slice(-14).map((d) => d.plays),
    };
  }, [data]);
  const loading = !data;
  const c = data?.counts;
  return (
    <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 2xl:grid-cols-6">
      <StatTile
        label="زيارات الموقع"
        icon={<Eye />}
        loading={loading}
        value={formatCompact(c?.views ?? 0)}
        trend={totals.viewsTrend}
        sub={
          <>
            <span className="num text-fg-2">+{formatCompact(totals.views)}</span> آخر {days} يوم
          </>
        }
      />
      <StatTile
        label="مشاهدات الفيديو"
        icon={<Play />}
        loading={loading}
        value={formatCompact(c?.plays ?? 0)}
        trend={totals.playsTrend}
        sub={
          <>
            <span className="num text-fg-2">+{formatCompact(totals.plays)}</span> آخر {days} يوم
          </>
        }
      />
      <StatTile label="الأماكن" icon={<Store />} loading={loading} value={formatNumber(c?.places ?? 0)} to="/places" sub="اضغط للإدارة" />
      <StatTile
        label="الفيديوهات"
        icon={<Clapperboard />}
        loading={loading}
        value={formatNumber(c?.videos ?? 0)}
        to="/videos"
        sub={
          c && (c.videosProcessing || c.videosFailed) ? (
            <span className="flex items-center gap-2">
              {c.videosProcessing > 0 && (
                <span className="inline-flex items-center gap-1 text-info">
                  <LoaderCircle className="size-3 animate-spin" aria-hidden />
                  <span className="num">{c.videosProcessing}</span> قيد المعالجة
                </span>
              )}
              {c.videosFailed > 0 && (
                <span className="inline-flex items-center gap-1 text-danger">
                  <CircleAlert className="size-3" aria-hidden />
                  <span className="num">{c.videosFailed}</span> فشل
                </span>
              )}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1">
              <CircleCheck className="size-3 text-success" aria-hidden /> كلها جاهزة
            </span>
          )
        }
      />
      <StatTile
        label="رسائل جديدة"
        icon={<Inbox />}
        loading={loading}
        value={formatNumber(c?.inquiriesNew ?? 0)}
        to="/inquiries"
        sub={c?.inquiriesNew ? <span className="text-accent">بانتظار ردّك</span> : 'ماكو رسائل جديدة'}
      />
      <StatTile label="التخزين المستخدم" icon={<HardDrive />} loading={loading} value={formatBytes(c?.storageBytes ?? 0)} sub="فيديوهات وصور" />
    </div>
  );
}

/* ─────────────────────────── Trend chart ─────────────────────────── */

function TrendCard({ data, days, loading, refetching }: { data: Overview | undefined; days: number; loading: boolean; refetching: boolean }) {
  const [view, setView] = useState<'chart' | 'table'>('chart');
  const series = data?.series ?? [];
  const totalViews = series.reduce((s, d) => s + d.views, 0);
  const totalPlays = series.reduce((s, d) => s + d.plays, 0);

  return (
    <Card className="min-w-0">
      <CardHeader
        title="الزيارات والمشاهدات"
        description={`يومياً، آخر ${days} يوم`}
        actions={
          <Segmented
            size="sm"
            label="طريقة العرض"
            value={view}
            onChange={setView}
            items={[
              { value: 'chart', label: <span className="sr-only sm:not-sr-only">رسم</span>, icon: <ChartSpline /> },
              { value: 'table', label: <span className="sr-only sm:not-sr-only">جدول</span>, icon: <Table2 /> },
            ]}
          />
        }
      />
      <div className="flex flex-wrap items-end gap-x-8 gap-y-3 px-5 pt-4 sm:px-6">
        {SERIES.map((s) => (
          <div key={s.key}>
            <div className="flex items-center gap-2 text-xs text-muted">
              <span className="h-0.5 w-3.5 rounded-full" style={{ background: s.color }} aria-hidden />
              {s.label}
            </div>
            {loading ? (
              <Skeleton className="mt-1.5 h-8 w-24" />
            ) : (
              <p className="num mt-1 text-[2rem] font-semibold leading-none text-fg" dir="ltr">
                {formatNumber(s.key === 'views' ? totalViews : totalPlays)}
              </p>
            )}
          </div>
        ))}
      </div>
      <div className="px-3 pb-4 pt-2 sm:px-4">
        {loading ? (
          <Skeleton className="mx-2 h-[240px]" />
        ) : view === 'chart' ? (
          <TrendChart data={series} series={SERIES} dimmed={refetching} />
        ) : (
          <div className="max-h-[240px] overflow-y-auto px-2">
            <table className="w-full text-[0.8125rem]">
              <thead className="sticky top-0 bg-surface text-xs text-muted">
                <tr className="border-b border-line">
                  <th className="py-2 text-start font-medium">اليوم</th>
                  <th className="py-2 text-end font-medium">زيارات</th>
                  <th className="py-2 text-end font-medium">مشاهدات فيديو</th>
                </tr>
              </thead>
              <tbody>
                {[...series].reverse().map((d) => (
                  <tr key={d.date} className="border-b border-line/60 last:border-0">
                    <td className="py-1.5 text-fg-2">{formatSeriesDate(d.date)}</td>
                    <td className="num tabular py-1.5 text-end">{formatNumber(d.views)}</td>
                    <td className="num tabular py-1.5 text-end">{formatNumber(d.plays)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Card>
  );
}

/* ─────────────────────────── Processing queue ─────────────────────────── */

function StatusMeter({ counts }: { counts: Overview['counts'] }) {
  const processing = counts.videosProcessing;
  const failed = counts.videosFailed;
  const ready = Math.max(0, counts.videos - processing - failed);
  const total = Math.max(1, ready + processing + failed);
  const parts = [
    { key: 'ready', label: 'جاهز', value: ready, color: 'var(--color-success)', icon: <CircleCheck className="size-3.5 text-success" aria-hidden /> },
    { key: 'processing', label: 'قيد المعالجة', value: processing, color: 'var(--color-info)', icon: <LoaderCircle className="size-3.5 text-info" aria-hidden /> },
    { key: 'failed', label: 'فشل', value: failed, color: 'var(--color-danger)', icon: <CircleAlert className="size-3.5 text-danger" aria-hidden /> },
  ];
  return (
    <div className="mb-4">
      <div className="flex h-2 gap-0.5 overflow-hidden rounded-full" role="img" aria-label={parts.map((p) => `${p.label}: ${p.value}`).join('، ')}>
        {parts
          .filter((p) => p.value > 0)
          .map((p) => (
            <span key={p.key} className="h-full first:rounded-s-full last:rounded-e-full" style={{ width: `${(p.value / total) * 100}%`, background: p.color }} />
          ))}
        {counts.videos === 0 && <span className="h-full w-full bg-white/[0.07]" />}
      </div>
      <ul className="mt-3 grid grid-cols-3 gap-2">
        {parts.map((p) => (
          <li key={p.key} className="rounded-xl bg-white/[0.03] px-3 py-2">
            <span className="flex items-center gap-1.5 text-[0.6875rem] text-muted">
              {p.icon}
              {p.label}
            </span>
            <span className="num mt-0.5 block text-base font-semibold text-fg">{formatNumber(p.value)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ProcessingCard({ counts }: { counts: Overview['counts'] | undefined }) {
  const processing = useQuery({
    queryKey: qk.videos({ status: 'PROCESSING' }),
    queryFn: () => api.videos.list({ status: 'PROCESSING' }),
    refetchInterval: (query) => ((query.state.data?.length ?? 0) > 0 ? 4000 : 30_000),
  });
  const failed = useQuery({
    queryKey: qk.videos({ status: 'FAILED' }),
    queryFn: () => api.videos.list({ status: 'FAILED' }),
    refetchInterval: 30_000,
  });
  const items: AdminVideoWithPlace[] = [...(processing.data ?? []), ...(failed.data ?? [])];
  const loading = processing.isPending || failed.isPending;

  return (
    <Card className="flex min-w-0 flex-col">
      <CardHeader
        title="طابور المعالجة"
        description="الفيديوهات اللي يجهزها الخادم هسة"
        actions={
          processing.data && processing.data.length > 0 ? (
            <Badge tone="info" dot pulse>
              <span className="num">{processing.data.length}</span> شغّال
            </Badge>
          ) : undefined
        }
      />
      <div className="flex-1 px-5 pb-4 pt-4 sm:px-6">
        {counts ? <StatusMeter counts={counts} /> : <Skeleton className="mb-4 h-20" />}
        {loading ? (
          <div className="flex flex-col gap-3">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-12" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <EmptyState compact icon={<CircleCheck />} title="الطابور فارغ" description="ماكو فيديو قيد المعالجة أو فاشل حالياً." />
        ) : (
          <ul className="flex flex-col divide-y divide-line">
            {items.slice(0, 6).map((video) => (
              <li key={video.id}>
                <Link to={`/places/${video.placeId}`} className="flex items-center gap-3 py-2.5 hover:opacity-90">
                  <VideoThumb video={video} className="h-11 w-8 rounded-md" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[0.8125rem] font-medium">{video.title || video.originalName || 'بدون عنوان'}</span>
                    <span className="block truncate text-xs text-muted">{video.placeName}</span>
                  </span>
                  {video.status === 'FAILED' ? (
                    <Badge tone="danger" icon={<CircleAlert />}>
                      فشل
                    </Badge>
                  ) : (
                    <Badge tone="info" icon={<LoaderCircle className="animate-spin" />}>
                      يتجهز
                    </Badge>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}

/* ─────────────────────────── Top lists ─────────────────────────── */

function MeterBar({ value, max }: { value: number; max: number }) {
  const pct = max > 0 && value > 0 ? Math.max(2, (value / max) * 100) : 0;
  return (
    <div className="h-1 w-full rounded-full bg-[rgb(201_133_0/0.14)]" aria-hidden>
      <div className="h-full rounded-full bg-series-views" style={{ width: `${pct}%` }} />
    </div>
  );
}

function TopVideosCard({ videos }: { videos: AdminVideoWithPlace[] | undefined }) {
  const max = Math.max(1, ...(videos ?? []).map((v) => v.plays));
  return (
    <Card className="min-w-0">
      <CardHeader title="أكثر الفيديوهات مشاهدة" description="حسب عدد التشغيل الكلي" />
      <div className="px-5 pb-4 pt-3 sm:px-6">
        {!videos ? (
          <ListSkeleton />
        ) : videos.length === 0 ? (
          <EmptyState compact icon={<Play />} title="ماكو مشاهدات بعد" description="أول ما الناس تشغّل فيديوهاتك بالموقع، راح تطلع هنا." />
        ) : (
          <ol className="flex flex-col gap-1">
            {videos.map((video) => (
              <li key={video.id}>
                <Link to={`/places/${video.placeId}`} className="flex items-center gap-3 rounded-xl py-2 transition-colors hover:bg-white/[0.02]">
                  <VideoThumb video={video} className="h-12 w-[1.6875rem] rounded-md" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="truncate text-[0.8125rem] font-medium">{video.title || video.originalName || 'بدون عنوان'}</span>
                      <span className="num tabular shrink-0 text-[0.8125rem] font-semibold">{formatCompact(video.plays)}</span>
                    </div>
                    <div className="mt-0.5 flex items-center gap-3">
                      <span className="w-24 shrink-0 truncate text-xs text-muted">{video.placeName}</span>
                      <MeterBar value={video.plays} max={max} />
                    </div>
                  </div>
                </Link>
              </li>
            ))}
          </ol>
        )}
      </div>
    </Card>
  );
}

function TopPlacesCard({ places, days }: { places: Overview['topPlaces'] | undefined; days: number }) {
  const max = Math.max(1, ...(places ?? []).map((p) => p.views));
  return (
    <Card className="min-w-0">
      <CardHeader title="أكثر الأماكن زيارة" description={`زيارات صفحات الأماكن، آخر ${days} يوم`} />
      <div className="px-5 pb-4 pt-3 sm:px-6">
        {!places ? (
          <ListSkeleton />
        ) : places.length === 0 ? (
          <EmptyState compact icon={<Store />} title="ماكو زيارات بالفترة هاي" description="جرّب مدة أطول، أو شارك روابط الأماكن بالستوري." />
        ) : (
          <ol className="flex flex-col gap-1">
            {places.map((place, index) => (
              <li key={place.id}>
                <Link to={`/places/${place.id}`} className="flex items-center gap-3 rounded-xl py-2.5 transition-colors hover:bg-white/[0.02]">
                  <span className="num grid size-7 shrink-0 place-items-center rounded-lg bg-white/[0.05] text-xs text-muted">{index + 1}</span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="truncate text-[0.8125rem] font-medium">{place.name}</span>
                      <span className="num tabular shrink-0 text-[0.8125rem] font-semibold">{formatCompact(place.views)}</span>
                    </div>
                    <div className="mt-1.5">
                      <MeterBar value={place.views} max={max} />
                    </div>
                  </div>
                </Link>
              </li>
            ))}
          </ol>
        )}
      </div>
    </Card>
  );
}

function RecentInquiriesCard({ data, className }: { data: Overview | undefined; className?: string }) {
  const items = data?.recentInquiries;
  return (
    <Card className={cn('min-w-0', className)}>
      <CardHeader
        title="آخر الرسائل"
        description="طلبات الزبائن من فورم الموقع"
        actions={
          <Link to="/inquiries" className="inline-flex items-center gap-1 text-xs font-medium text-accent hover:underline">
            كل الرسائل <ArrowUpLeft className="size-3.5" aria-hidden />
          </Link>
        }
      />
      <div className="px-5 pb-4 pt-3 sm:px-6">
        {!items ? (
          <ListSkeleton />
        ) : items.length === 0 ? (
          <EmptyState compact icon={<Inbox />} title="ماكو رسائل بعد" description="الرسائل اللي توصلك من الموقع راح تطلع هنا." />
        ) : (
          <ul className="flex flex-col divide-y divide-line">
            {items.map((inquiry) => (
              <li key={inquiry.id}>
                <Link to={`/inquiries?open=${inquiry.id}`} className="flex items-start gap-3 py-2.5 transition-opacity hover:opacity-90">
                  <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-full bg-surface-3 text-xs font-semibold text-fg-2">
                    {inquiry.name.trim().charAt(0)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-[0.8125rem] font-medium">{inquiry.name}</span>
                      <span className="shrink-0 text-[0.6875rem] text-subtle">{formatRelative(inquiry.createdAt)}</span>
                    </div>
                    <p className="mt-0.5 line-clamp-1 text-xs text-muted">{inquiry.message}</p>
                  </div>
                  <InquiryStatusBadge status={inquiry.status} className="mt-0.5" aria-label={INQUIRY_STATUS_LABELS[inquiry.status]} />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}

function ListSkeleton() {
  return (
    <div className="flex flex-col gap-3 py-1">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="flex items-center gap-3">
          <Skeleton className="size-9 shrink-0" />
          <div className="flex-1">
            <Skeleton className="h-3.5 w-2/3" />
            <Skeleton className="mt-2 h-2 w-full" />
          </div>
        </div>
      ))}
    </div>
  );
}
