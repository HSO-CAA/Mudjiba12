import type { ReactNode } from 'react';

/** On-brand empty state: a standby viewfinder instead of a blank area. */
export function EmptyFrame({ title, body, action, code = 'STANDBY' }: { title: string; body?: ReactNode; action?: ReactNode; code?: string }) {
  return (
    <div className="relative overflow-hidden rounded-[1.6rem] border border-line bg-surface/60 px-6 py-16 text-center sm:py-24">
      <div aria-hidden="true" className="absolute inset-0 bg-[radial-gradient(50%_60%_at_50%_0%,color-mix(in_oklab,var(--accent)_14%,transparent),transparent_70%)]" />
      <div aria-hidden="true" className="viewfinder absolute inset-5 opacity-60" />
      <div className="relative mx-auto flex max-w-md flex-col items-center gap-4">
        <p className="hud flex items-center gap-2 text-muted">
          <span className="rec-dot inline-block size-1.5 rounded-full bg-accent" /> {code}
        </p>
        <h3 className="font-display text-2xl font-extrabold sm:text-3xl">{title}</h3>
        {body && <p className="leading-7 text-muted">{body}</p>}
        {action}
      </div>
    </div>
  );
}
