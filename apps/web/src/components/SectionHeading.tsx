import type { ReactNode } from 'react';
import { pad2 } from '../lib/format';
import { Reveal, RevealLines } from './Reveal';

interface Props {
  index: number;
  total: number;
  /** Latin HUD label, e.g. "WORK". */
  code: string;
  kicker: string;
  title: string | string[];
  description?: ReactNode;
  aside?: ReactNode;
  id?: string;
}

/** Section header with a viewfinder-style frame counter ("02 / 05"). */
export function SectionHeading({ index, total, code, kicker, title, description, aside, id }: Props) {
  const lines = Array.isArray(title) ? title : [title];
  return (
    <header className="mb-10 flex flex-col gap-6 sm:mb-14 md:flex-row md:items-end md:justify-between">
      <div className="max-w-3xl">
        <Reveal>
          <p className="mb-5 flex items-center gap-3 text-muted">
            <span className="hud text-accent">
              {pad2(index)} / {pad2(total)}
            </span>
            <span className="h-px w-8 bg-line-strong" aria-hidden="true" />
            <span className="hud">{code}</span>
            <span className="h-px w-3 bg-line-strong" aria-hidden="true" />
            <span className="font-ui text-base leading-none text-soft">{kicker}</span>
          </p>
        </Reveal>
        <RevealLines as="h2" id={id ? `${id}-title` : undefined} lines={lines} className="display-xl text-[clamp(2.1rem,6vw,4.6rem)] text-balance" />
        {description && (
          <Reveal delay={0.15}>
            <div id={id ? `${id}-desc` : undefined} className="copy mt-5 max-w-xl">
              {description}
            </div>
          </Reveal>
        )}
      </div>
      {aside && <Reveal delay={0.2}>{aside}</Reveal>}
    </header>
  );
}
