import { useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import type { DailyPoint } from '@s5y/shared';
import { cn } from '../../lib/cn';
import { formatNumber, formatSeriesDate, formatTick } from '../../lib/format';

/**
 * Hand-built SVG line chart for daily views & plays (one shared y-axis — same unit, counts).
 * RTL: time runs right → left (oldest on the right), y-axis ticks on the start (right) side.
 * Hover / touch / keyboard: a crosshair snaps to the nearest day and a tooltip lists both series.
 */

export interface TrendSeries {
  key: 'views' | 'plays';
  label: string;
  /** CSS colour (validated palette tokens). */
  color: string;
  area?: boolean;
}

const PAD = { top: 16, bottom: 30, start: 44, end: 12 };

function niceStep(rough: number): number {
  const exp = Math.floor(Math.log10(rough));
  const base = 10 ** exp;
  const f = rough / base;
  const nice = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10;
  return Math.max(1, nice * base);
}

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.round(entry.contentRect.width)));
    observer.observe(node);
    setWidth(Math.round(node.getBoundingClientRect().width));
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

export function TrendChart({
  data,
  series,
  height = 240,
  className,
  dimmed = false,
}: {
  data: DailyPoint[];
  series: TrendSeries[];
  height?: number;
  className?: string;
  /** Holds the previous render at reduced opacity while a new range loads. */
  dimmed?: boolean;
}) {
  const [wrapRef, width] = useWidth<HTMLDivElement>();
  const [active, setActive] = useState<number | null>(null);
  const gradientId = useId().replace(/:/g, '');

  const innerW = Math.max(0, width - PAD.start - PAD.end);
  const innerH = height - PAD.top - PAD.bottom;
  const n = data.length;

  const { ticks, yMax } = useMemo(() => {
    const max = Math.max(4, ...data.flatMap((d) => series.map((s) => d[s.key])));
    const step = niceStep(max / 4);
    const top = Math.ceil(max / step) * step;
    const list: number[] = [];
    for (let v = 0; v <= top + 1e-9; v += step) list.push(v);
    return { ticks: list, yMax: top };
  }, [data, series]);

  // Oldest on the right (start side in RTL), newest on the left.
  const x = useCallback((i: number) => PAD.end + (n <= 1 ? innerW / 2 : innerW - (i / (n - 1)) * innerW), [innerW, n]);
  const y = useCallback((v: number) => PAD.top + innerH - (v / yMax) * innerH, [innerH, yMax]);

  const paths = useMemo(
    () =>
      series.map((s) => {
        const points = data.map((d, i) => `${x(i).toFixed(1)},${y(d[s.key]).toFixed(1)}`);
        const line = points.length ? `M${points.join('L')}` : '';
        const area = points.length ? `${line}L${x(n - 1).toFixed(1)},${y(0)}L${x(0).toFixed(1)},${y(0)}Z` : '';
        return { ...s, line, area };
      }),
    [data, series, x, y, n],
  );

  const labelIndexes = useMemo(() => {
    if (n === 0) return [];
    const count = innerW < 360 ? 3 : innerW < 640 ? 4 : 6;
    const set = new Set<number>();
    for (let k = 0; k < count; k += 1) set.add(Math.round((k / (count - 1)) * (n - 1)));
    return [...set];
  }, [n, innerW]);

  const indexFromPointer = (event: PointerEvent<SVGRectElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const px = event.clientX - rect.left; // 0 … innerW, left = newest
    const ratio = innerW > 0 ? 1 - px / innerW : 0;
    return Math.max(0, Math.min(n - 1, Math.round(ratio * (n - 1))));
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (n === 0) return;
    const current = active ?? n - 1;
    if (event.key === 'ArrowLeft') setActive(Math.min(n - 1, current + 1));
    else if (event.key === 'ArrowRight') setActive(Math.max(0, current - 1));
    else if (event.key === 'Home') setActive(0);
    else if (event.key === 'End') setActive(n - 1);
    else if (event.key === 'Escape') setActive(null);
    else return;
    event.preventDefault();
  };

  const point = active !== null ? data[active] : null;
  const tooltipLeft = active !== null ? x(active) : 0;
  const flip = tooltipLeft < 150;

  return (
    <div
      ref={wrapRef}
      className={cn('relative w-full select-none outline-none transition-opacity duration-300', dimmed && 'opacity-50', className)}
      style={{ height }}
      tabIndex={0}
      role="img"
      aria-label={`رسم بياني يومي: ${series.map((s) => s.label).join(' و')}. استخدم الأسهم للتنقل بين الأيام.`}
      onKeyDown={onKeyDown}
      onBlur={() => setActive(null)}
    >
      {width > 0 && (
        <svg width={width} height={height} className="block overflow-visible" aria-hidden>
          <defs>
            {paths.map((p) => (
              <linearGradient key={p.key} id={`${gradientId}-${p.key}`} x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor={p.color} stopOpacity="0.16" />
                <stop offset="100%" stopColor={p.color} stopOpacity="0" />
              </linearGradient>
            ))}
          </defs>

          {/* Gridlines + y ticks (start side = right) */}
          {ticks.map((t) => (
            <g key={t}>
              <line
                x1={PAD.end}
                x2={PAD.end + innerW}
                y1={y(t)}
                y2={y(t)}
                stroke={t === 0 ? 'rgb(255 255 255 / 0.16)' : 'rgb(255 255 255 / 0.06)'}
                strokeWidth={1}
                shapeRendering="crispEdges"
              />
              <text
                x={width - 4}
                y={y(t)}
                dy="0.32em"
                textAnchor="end"
                className="num fill-muted text-[10.5px] tabular"
                style={{ direction: 'ltr' }}
              >
                {formatTick(t)}
              </text>
            </g>
          ))}

          {/* X labels */}
          {labelIndexes.map((i) => (
            <text
              key={i}
              x={x(i)}
              y={height - 8}
              // RTL text: "start" is the right edge — the oldest label hugs the right, the newest the left.
              textAnchor={i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'}
              className="fill-muted text-[11px]"
              style={{ direction: 'rtl' }}
            >
              {formatSeriesDate(data[i].date)}
            </text>
          ))}

          {paths.map((p) =>
            p.area ? <path key={`${p.key}-area`} d={p.area} fill={`url(#${gradientId}-${p.key})`} /> : null,
          )}
          {paths.map((p) => (
            <path
              key={p.key}
              d={p.line}
              fill="none"
              stroke={p.color}
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
          ))}

          {/* Latest-day markers */}
          {n > 0 &&
            active === null &&
            paths.map((p) => (
              <circle key={`${p.key}-end`} cx={x(n - 1)} cy={y(data[n - 1][p.key])} r={4} fill={p.color} stroke="var(--color-surface)" strokeWidth={2} />
            ))}

          {/* Crosshair */}
          {point && active !== null && (
            <g>
              <line x1={x(active)} x2={x(active)} y1={PAD.top} y2={PAD.top + innerH} stroke="rgb(255 255 255 / 0.28)" strokeWidth={1} />
              {paths.map((p) => (
                <circle key={`${p.key}-dot`} cx={x(active)} cy={y(point[p.key])} r={4.5} fill={p.color} stroke="var(--color-surface)" strokeWidth={2} />
              ))}
            </g>
          )}

          {/* Hit area larger than the marks */}
          <rect
            x={PAD.end}
            y={0}
            width={innerW}
            height={height - PAD.bottom + 8}
            fill="transparent"
            style={{ touchAction: 'pan-y', cursor: 'crosshair' }}
            onPointerMove={(event) => setActive(indexFromPointer(event))}
            onPointerDown={(event) => setActive(indexFromPointer(event))}
            onPointerLeave={(event) => event.pointerType === 'mouse' && setActive(null)}
          />
        </svg>
      )}

      {point && active !== null && (
        <div
          className="pointer-events-none absolute top-1 z-10 min-w-36 rounded-xl border border-line-strong bg-surface-3/95 px-3 py-2.5 shadow-(--shadow-pop) backdrop-blur"
          style={flip ? { left: tooltipLeft + 12 } : { left: tooltipLeft - 12, transform: 'translateX(-100%)' }}
        >
          <p className="text-[0.6875rem] text-muted">{formatSeriesDate(point.date)}</p>
          <ul className="mt-1.5 flex flex-col gap-1">
            {series.map((s) => (
              <li key={s.key} className="flex items-center gap-2 text-[0.75rem]">
                <span className="h-0.5 w-3 rounded-full" style={{ background: s.color }} aria-hidden />
                <span className="num tabular min-w-8 font-semibold text-fg">{formatNumber(point[s.key])}</span>
                <span className="text-muted">{s.label}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/** 12–30 point sparkline in the de-emphasis hue, latest point in the accent. */
export function Sparkline({ values, className }: { values: number[]; className?: string }) {
  const w = 96;
  const h = 28;
  if (values.length < 2) return null;
  const max = Math.max(1, ...values);
  // RTL: newest on the left, matching the main chart.
  const pts = values.map((v, i) => [w - (i / (values.length - 1)) * (w - 4) - 2, h - 3 - (v / max) * (h - 6)] as const);
  const last = pts[pts.length - 1];
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width={w} height={h} className={cn('overflow-visible', className)} aria-hidden>
      <polyline
        points={pts.map((p) => p.join(',')).join(' ')}
        fill="none"
        stroke="rgb(143 139 132 / 0.55)"
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <circle cx={last[0]} cy={last[1]} r={3} fill="var(--color-accent)" stroke="var(--color-surface)" strokeWidth={1.5} />
    </svg>
  );
}
