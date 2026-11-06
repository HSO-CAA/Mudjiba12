import { Check, Sparkles } from 'lucide-react';
import type { PlanPeriod } from '@s5y/shared';
import { cn } from '../../lib/cn';
import { formatPrice, PERIOD_LABELS } from '../../lib/format';

export interface PlanCardData {
  name: string;
  tagline: string | null;
  price: number | null;
  currency: string;
  period: PlanPeriod;
  features: string[];
  highlighted: boolean;
  ctaLabel: string | null;
}

/** Mirrors the public pricing card so the owner sees what visitors will see. */
export function PlanCard({ plan, accent = '#e9b35f', className }: { plan: PlanCardData; accent?: string; className?: string }) {
  const price = formatPrice(plan.price, plan.currency);
  return (
    <div
      className={cn(
        'relative flex h-full flex-col overflow-hidden rounded-2xl border bg-[linear-gradient(180deg,#141418,#0c0c0f)] p-5',
        plan.highlighted ? 'border-transparent' : 'border-line',
        className,
      )}
      style={plan.highlighted ? { boxShadow: `0 0 0 1px ${accent}99, 0 24px 60px -24px ${accent}66` } : undefined}
    >
      {plan.highlighted && (
        <>
          <div className="pointer-events-none absolute inset-x-0 top-0 h-32 opacity-60" style={{ background: `radial-gradient(60% 100% at 50% 0%, ${accent}40, transparent)` }} />
          <span
            className="absolute end-4 top-4 inline-flex h-6 items-center gap-1 rounded-full px-2 text-[0.6875rem] font-semibold"
            style={{ background: `${accent}22`, color: accent }}
          >
            <Sparkles className="size-3" aria-hidden /> الأكثر طلباً
          </span>
        </>
      )}
      <div className="relative">
        <h3 className="pe-24 text-lg font-bold text-fg">{plan.name || 'اسم الباقة'}</h3>
        {plan.tagline && <p className="mt-1 text-[0.8125rem] leading-relaxed text-muted">{plan.tagline}</p>}
        <div className="mt-4 flex items-baseline gap-1.5">
          <span className={cn('font-bold leading-none text-fg', price.onRequest ? 'text-2xl' : 'text-[2rem]')}>{price.amount}</span>
          {price.unit && <span className="text-sm text-muted">{price.unit}</span>}
          {!price.onRequest && <span className="text-xs text-subtle">/ {PERIOD_LABELS[plan.period]}</span>}
        </div>
      </div>
      <ul className="relative mt-5 flex flex-1 flex-col gap-2.5 border-t border-line pt-4">
        {plan.features.length === 0 && <li className="text-xs text-subtle">أضف مميزات الباقة…</li>}
        {plan.features.map((feature, i) => (
          <li key={`${feature}-${i}`} className="flex items-start gap-2 text-[0.8125rem] leading-relaxed text-fg-2">
            <Check className="mt-1 size-3.5 shrink-0" style={{ color: accent }} aria-hidden />
            {feature}
          </li>
        ))}
      </ul>
      <span
        className="relative mt-5 inline-flex h-10 items-center justify-center rounded-xl text-sm font-semibold"
        style={plan.highlighted ? { background: accent, color: '#1b1306' } : { background: 'rgb(255 255 255 / 0.06)', color: 'var(--color-fg)' }}
      >
        {plan.ctaLabel || 'اطلب الباقة'}
      </span>
    </div>
  );
}
