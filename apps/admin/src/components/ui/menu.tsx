import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { cn } from '../../lib/cn';

export interface MenuItem {
  label: string;
  icon?: ReactNode;
  onSelect: () => void;
  tone?: 'default' | 'danger';
  disabled?: boolean;
  /** Draws a separator above this item. */
  separated?: boolean;
}

/** Small dropdown anchored to its trigger (opens toward the end side, flips up near the viewport bottom). */
export function Menu({
  trigger,
  items,
  className,
  align = 'end',
}: {
  trigger: (props: { onClick: () => void; 'aria-expanded': boolean; 'aria-haspopup': 'menu'; 'aria-controls': string }) => ReactNode;
  items: MenuItem[];
  className?: string;
  align?: 'start' | 'end';
}) {
  const [open, setOpen] = useState(false);
  const [up, setUp] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const id = useId();

  useEffect(() => {
    if (!open) return;
    const rect = rootRef.current?.getBoundingClientRect();
    if (rect) setUp(window.innerHeight - rect.bottom < 260 && rect.top > 260);
    const onPointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        return;
      }
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
      event.preventDefault();
      const nodes = Array.from(listRef.current?.querySelectorAll<HTMLButtonElement>('button:not([disabled])') ?? []);
      const index = nodes.indexOf(document.activeElement as HTMLButtonElement);
      const next = event.key === 'ArrowDown' ? (index + 1) % nodes.length : (index - 1 + nodes.length) % nodes.length;
      nodes[next]?.focus();
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    requestAnimationFrame(() => listRef.current?.querySelector<HTMLButtonElement>('button:not([disabled])')?.focus());
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={rootRef} className={cn('relative', className)}>
      {trigger({ onClick: () => setOpen((v) => !v), 'aria-expanded': open, 'aria-haspopup': 'menu', 'aria-controls': id })}
      {open && (
        <div
          ref={listRef}
          id={id}
          role="menu"
          className={cn(
            'absolute z-40 min-w-48 animate-pop-in rounded-xl border border-line-strong bg-surface-3 p-1 shadow-(--shadow-pop)',
            align === 'end' ? 'end-0' : 'start-0',
            up ? 'bottom-full mb-1.5' : 'top-full mt-1.5',
          )}
        >
          {items.map((item) => (
            <div key={item.label}>
              {item.separated && <div className="my-1 h-px bg-line" role="separator" />}
              <button
                type="button"
                role="menuitem"
                disabled={item.disabled}
                onClick={(event) => {
                  event.stopPropagation();
                  setOpen(false);
                  item.onSelect();
                }}
                className={cn(
                  'flex h-9.5 w-full items-center gap-2.5 rounded-lg px-2.5 text-start text-[0.8125rem] transition-colors focus:outline-none disabled:opacity-40 [&_svg]:size-4 [&_svg]:shrink-0',
                  item.tone === 'danger'
                    ? 'text-danger hover:bg-danger/10 focus:bg-danger/10'
                    : 'text-fg-2 hover:bg-white/[0.06] hover:text-fg focus:bg-white/[0.06] focus:text-fg',
                )}
              >
                {item.icon}
                {item.label}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
