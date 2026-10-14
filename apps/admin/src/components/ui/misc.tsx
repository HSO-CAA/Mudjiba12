import type { HTMLAttributes, ReactNode } from 'react';
import { LoaderCircle } from 'lucide-react';
import { cn } from '../../lib/cn';

export type Tone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger' | 'info';

const toneClasses: Record<Tone, string> = {
  neutral: 'bg-white/[0.06] text-fg-2 ring-white/10',
  accent: 'bg-accent/12 text-accent ring-accent/25',
  success: 'bg-success/12 text-success ring-success/25',
  warning: 'bg-warning/12 text-warning ring-warning/25',
  danger: 'bg-danger/12 text-danger ring-danger/25',
  info: 'bg-info/12 text-info ring-info/25',
};

const dotClasses: Record<Tone, string> = {
  neutral: 'bg-muted',
  accent: 'bg-accent',
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-danger',
  info: 'bg-info',
};

export function Badge({
  tone = 'neutral',
  dot = false,
  pulse = false,
  icon,
  className,
  children,
}: {
  tone?: Tone;
  dot?: boolean;
  pulse?: boolean;
  icon?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        'inline-flex h-6 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 text-xs font-medium ring-1 ring-inset [&_svg]:size-3.5',
        toneClasses[tone],
        className,
      )}
    >
      {dot && (
        <span className="relative flex size-1.5">
          {pulse && <span className={cn('absolute inset-0 animate-ping rounded-full opacity-60', dotClasses[tone])} />}
          <span className={cn('relative size-1.5 rounded-full', dotClasses[tone])} />
        </span>
      )}
      {icon}
      {children}
    </span>
  );
}

export function Card({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('rounded-2xl border border-line bg-surface shadow-(--shadow-card)', className)} {...rest} />;
}

export function CardHeader({
  title,
  description,
  actions,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex items-start justify-between gap-3 px-5 pt-5 sm:px-6', className)}>
      <div className="min-w-0">
        <h2 className="text-[0.9375rem] font-semibold text-fg">{title}</h2>
        {description && <p className="mt-0.5 text-[0.8125rem] text-muted">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn('skeleton', className)} />;
}

export function Spinner({ className, label = 'جاري التحميل' }: { className?: string; label?: string }) {
  return <LoaderCircle role="status" aria-label={label} className={cn('size-5 animate-spin text-muted', className)} />;
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
  compact = false,
}: {
  icon?: ReactNode;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
  compact?: boolean;
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center text-center',
        compact ? 'gap-2 px-4 py-8' : 'gap-3 px-6 py-14 sm:py-20',
        className,
      )}
    >
      {icon && (
        <div
          className={cn(
            'viewfinder grid place-items-center rounded-2xl border border-line bg-surface-2 text-accent [&_svg]:size-6',
            compact ? 'size-12 [&_svg]:size-5 before:hidden after:hidden' : 'size-16',
          )}
        >
          {icon}
        </div>
      )}
      <div className="max-w-sm">
        <h3 className={cn('font-semibold text-fg', compact ? 'text-sm' : 'text-base')}>{title}</h3>
        {description && <p className="mt-1 text-[0.8125rem] leading-relaxed text-muted">{description}</p>}
      </div>
      {action && <div className="mt-2 flex flex-wrap items-center justify-center gap-2">{action}</div>}
    </div>
  );
}

export function ProgressBar({
  value,
  tone = 'accent',
  indeterminate = false,
  className,
  label,
}: {
  /** 0..1 */
  value: number;
  tone?: 'accent' | 'success' | 'danger' | 'muted';
  indeterminate?: boolean;
  className?: string;
  label?: string;
}) {
  const pct = Math.max(0, Math.min(1, value)) * 100;
  const fill = {
    accent: 'bg-accent',
    success: 'bg-success',
    danger: 'bg-danger',
    muted: 'bg-muted',
  }[tone];
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={indeterminate ? undefined : Math.round(pct)}
      className={cn('h-1.5 w-full overflow-hidden rounded-full bg-white/[0.07]', className)}
    >
      <div
        className={cn(
          'h-full rounded-full transition-[width] duration-700 ease-out',
          fill,
          indeterminate && 'progress-stripes w-full opacity-70',
        )}
        style={indeterminate ? undefined : { width: `${pct}%` }}
      />
    </div>
  );
}

/** Small inline alert. */
export function Callout({
  tone = 'neutral',
  icon,
  title,
  children,
  action,
  className,
}: {
  tone?: Tone;
  icon?: ReactNode;
  title?: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  const border = {
    neutral: 'border-line bg-surface-2',
    accent: 'border-accent/25 bg-accent/[0.07]',
    success: 'border-success/25 bg-success/[0.07]',
    warning: 'border-warning/30 bg-warning/[0.08]',
    danger: 'border-danger/30 bg-danger/[0.08]',
    info: 'border-info/25 bg-info/[0.07]',
  }[tone];
  const iconColor = {
    neutral: 'text-muted',
    accent: 'text-accent',
    success: 'text-success',
    warning: 'text-warning',
    danger: 'text-danger',
    info: 'text-info',
  }[tone];
  return (
    <div
      role={tone === 'danger' || tone === 'warning' ? 'alert' : undefined}
      className={cn('flex flex-col gap-3 rounded-xl border px-4 py-3 sm:flex-row sm:items-center', border, className)}
    >
      <div className="flex min-w-0 flex-1 items-start gap-3">
        {icon && <span className={cn('mt-0.5 shrink-0 [&_svg]:size-[1.125rem]', iconColor)}>{icon}</span>}
        <div className="min-w-0 text-[0.8125rem] leading-relaxed">
          {title && <p className="font-semibold text-fg">{title}</p>}
          {children && <div className="text-fg-2">{children}</div>}
        </div>
      </div>
      {action && <div className="flex shrink-0 items-center gap-2 sm:ms-auto">{action}</div>}
    </div>
  );
}
