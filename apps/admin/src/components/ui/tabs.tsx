import { useEffect, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { cn } from '../../lib/cn';

export interface TabItem<T extends string> {
  value: T;
  label: ReactNode;
  icon?: ReactNode;
  count?: number;
}

function useRovingKeys<T extends string>(items: TabItem<T>[], value: T, onChange: (value: T) => void) {
  const refs = useRef(new Map<T, HTMLButtonElement | null>());
  const onKeyDown = (event: KeyboardEvent) => {
    const index = items.findIndex((item) => item.value === value);
    let next = -1;
    // RTL: ArrowLeft moves forward.
    if (event.key === 'ArrowLeft') next = (index + 1) % items.length;
    else if (event.key === 'ArrowRight') next = (index - 1 + items.length) % items.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = items.length - 1;
    if (next < 0) return;
    event.preventDefault();
    const target = items[next];
    onChange(target.value);
    refs.current.get(target.value)?.focus();
  };
  return { refs, onKeyDown };
}

/** Underlined tabs (page-level sections). Scrolls horizontally on narrow screens. */
export function Tabs<T extends string>({
  items,
  value,
  onChange,
  className,
  label,
}: {
  items: TabItem<T>[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
  label: string;
}) {
  const { refs, onKeyDown } = useRovingKeys(items, value, onChange);
  const scrollerRef = useRef<HTMLDivElement>(null);
  // Keep the active tab visible on narrow screens (horizontal scroller only — never the page).
  useEffect(() => {
    const scroller = scrollerRef.current;
    const tab = refs.current.get(value);
    if (!scroller || !tab || scroller.scrollWidth <= scroller.clientWidth) return;
    const s = scroller.getBoundingClientRect();
    const t = tab.getBoundingClientRect();
    if (t.left < s.left) scroller.scrollBy({ left: t.left - s.left - 16 });
    else if (t.right > s.right) scroller.scrollBy({ left: t.right - s.right + 16 });
  }, [value, refs]);
  return (
    <div ref={scrollerRef} className={cn('-mx-4 overflow-x-auto px-4 [scrollbar-width:none] sm:mx-0 sm:px-0', className)}>
      <div role="tablist" aria-label={label} onKeyDown={onKeyDown} className="flex min-w-max gap-1 border-b border-line">
        {items.map((item) => {
          const active = item.value === value;
          return (
            <button
              key={item.value}
              ref={(node) => {
                refs.current.set(item.value, node);
              }}
              type="button"
              role="tab"
              aria-selected={active}
              tabIndex={active ? 0 : -1}
              onClick={() => onChange(item.value)}
              className={cn(
                'relative -mb-px flex h-11 items-center gap-2 rounded-t-lg px-3.5 text-sm font-medium transition-colors [&_svg]:size-4',
                active ? 'text-fg' : 'text-muted hover:text-fg-2',
              )}
            >
              {item.icon}
              {item.label}
              {item.count !== undefined && (
                <span
                  className={cn(
                    'num tabular rounded-full px-1.5 text-[0.6875rem] leading-5',
                    active ? 'bg-accent/15 text-accent' : 'bg-white/[0.06] text-muted',
                  )}
                >
                  {item.count}
                </span>
              )}
              <span
                aria-hidden
                className={cn(
                  'absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-accent transition-opacity duration-200',
                  active ? 'opacity-100' : 'opacity-0',
                )}
              />
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Pill segmented control (filters, ranges). */
export function Segmented<T extends string>({
  items,
  value,
  onChange,
  className,
  label,
  size = 'md',
}: {
  items: TabItem<T>[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
  label: string;
  size?: 'sm' | 'md';
}) {
  const { refs, onKeyDown } = useRovingKeys(items, value, onChange);
  return (
    <div
      role="radiogroup"
      aria-label={label}
      onKeyDown={onKeyDown}
      className={cn('inline-flex items-center gap-0.5 rounded-xl border border-line bg-surface-2 p-0.5', className)}
    >
      {items.map((item) => {
        const active = item.value === value;
        return (
          <button
            key={item.value}
            ref={(node) => {
              refs.current.set(item.value, node);
            }}
            type="button"
            role="radio"
            aria-checked={active}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(item.value)}
            className={cn(
              'flex items-center justify-center gap-1.5 rounded-[0.625rem] font-medium transition-[background-color,color] duration-150 [&_svg]:size-3.5',
              size === 'sm' ? 'h-7 px-2.5 text-xs' : 'h-8.5 px-3 text-[0.8125rem]',
              active ? 'bg-surface-4 text-fg shadow-[0_1px_0_rgb(255_255_255/0.06)_inset]' : 'text-muted hover:text-fg-2',
            )}
          >
            {item.icon}
            {item.label}
            {item.count !== undefined && <span className="num tabular text-[0.6875rem] text-subtle">{item.count}</span>}
          </button>
        );
      })}
    </div>
  );
}
