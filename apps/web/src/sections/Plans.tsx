import type { PublicPlan } from '@s5y/shared';
import { useContactIntent } from '../app/ContactIntent';
import { useSectionNav } from '../app/useSectionNav';
import { Button } from '../components/Button';
import { CheckIcon, SparkIcon } from '../components/Icons';
import { Reveal } from '../components/Reveal';
import { SectionHeading } from '../components/SectionHeading';
import { formatPrice, localizeDigits, periodLabel } from '../lib/format';

export function Plans({ plans, index, total }: { plans: PublicPlan[]; index: number; total: number }) {
  const { setPlanId } = useContactIntent();
  const go = useSectionNav();
  if (!plans.length) return null;

  const choose = (plan: PublicPlan) => {
    setPlanId(plan.id);
    go('contact');
  };

  return (
    <section id="plans" aria-labelledby="plans-title" className="relative scroll-mt-24 py-24 sm:py-32">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-[radial-gradient(40%_40%_at_50%_45%,color-mix(in_oklab,var(--accent)_10%,transparent),transparent)]" />
      <div className="container-cine relative">
        <SectionHeading
          id="plans"
          index={index}
          total={total}
          code="PLANS"
          kicker="الباقات"
          title="باقات واضحة، نتيجة تنشاف"
          description="اختار الباقة اللي تناسب مشروعك، أو احچي ويايا على شي مخصص إلك."
        />
        <ul className={`grid gap-5 ${plans.length >= 3 ? 'lg:grid-cols-3' : plans.length === 2 ? 'md:grid-cols-2' : 'mx-auto max-w-xl'}`}>
          {plans.map((plan, i) => {
            const price = formatPrice(plan.price, plan.currency);
            const hl = plan.highlighted;
            return (
              <Reveal as="li" key={plan.id} delay={i * 0.08} className="h-full">
                <article
                  className={`shine-border relative flex h-full flex-col overflow-hidden rounded-[1.6rem] p-7 sm:p-9 ${
                    hl
                      ? 'bg-[linear-gradient(170deg,color-mix(in_oklab,var(--accent)_16%,#121214),#0c0c0e_60%)] shadow-[0_40px_120px_-50px_var(--accent)] lg:-translate-y-3'
                      : 'bg-surface/80'
                  }`}
                  aria-labelledby={`plan-${plan.id}`}
                >
                  {hl && (
                    <div aria-hidden="true" className="pointer-events-none absolute -top-24 left-1/2 h-48 w-3/4 -translate-x-1/2 rounded-full bg-accent/25 blur-3xl" />
                  )}
                  <div className="relative flex items-start justify-between gap-3">
                    <div>
                      <h3 id={`plan-${plan.id}`} className="font-display text-2xl font-extrabold">
                        {plan.name}
                      </h3>
                      {plan.tagline && <p className="mt-2 text-sm leading-6 text-muted">{plan.tagline}</p>}
                    </div>
                    {hl && (
                      <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-accent px-3 py-1.5 text-xs font-semibold text-[var(--accent-ink)]">
                        <SparkIcon size={12} /> الأكثر طلباً
                      </span>
                    )}
                  </div>

                  <div className="relative mt-8 border-y border-line py-7">
                    {price.onRequest ? (
                      <p className="whitespace-nowrap font-display text-4xl font-black leading-tight lg:text-[2.6rem]">{price.amount}</p>
                    ) : (
                      <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                        <span className="font-display text-5xl font-black leading-none sm:text-6xl">{price.amount}</span>
                        <span className="text-lg font-semibold text-accent">{price.unit}</span>
                      </p>
                    )}
                    <p className="mt-3 text-sm text-muted">{periodLabel(plan.period)}</p>
                  </div>

                  <ul className="relative mt-7 flex-1 space-y-3.5">
                    {plan.features.map((f, k) => (
                      <li key={k} className="flex items-start gap-3 leading-7 text-text/85">
                        <span className={`mt-1 grid size-5 shrink-0 place-items-center rounded-full ${hl ? 'bg-accent text-[var(--accent-ink)]' : 'bg-white/10 text-accent'}`}>
                          <CheckIcon size={13} strokeWidth={2.4} />
                        </span>
                        {localizeDigits(f)}
                      </li>
                    ))}
                  </ul>

                  <Button variant={hl ? 'primary' : 'ghost'} size="lg" className="relative mt-9 w-full" onClick={() => choose(plan)}>
                    {plan.ctaLabel || 'اطلب الباقة'}
                  </Button>
                </article>
              </Reveal>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
