import { useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { cn } from '../../lib/cn';
import { IconButton } from './button';

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]):not([type="hidden"]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

let openCount = 0;

function lockScroll(): () => void {
  openCount += 1;
  if (openCount === 1) {
    const scrollbar = window.innerWidth - document.documentElement.clientWidth;
    document.documentElement.style.overflow = 'hidden';
    if (scrollbar > 0) document.documentElement.style.paddingInlineEnd = `${scrollbar}px`;
  }
  return () => {
    openCount -= 1;
    if (openCount === 0) {
      document.documentElement.style.overflow = '';
      document.documentElement.style.paddingInlineEnd = '';
    }
  };
}

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  /** `sheet` slides in from the start side on desktop (full height); both become bottom sheets on phones. */
  variant?: 'modal' | 'sheet';
  /** Prevent closing via backdrop/Escape (e.g. while saving). */
  dismissible?: boolean;
  className?: string;
  bodyClassName?: string;
}

/**
 * Accessible modal rendered in a portal (not <dialog>, so toasts stay visible above it):
 * focus moves in and is trapped, Escape/backdrop close, focus returns to the opener.
 */
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = 'md',
  variant = 'modal',
  dismissible = true,
  className,
  bodyClassName,
}: DialogProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descId = useId();
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const dismissibleRef = useRef(dismissible);
  dismissibleRef.current = dismissible;

  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement as HTMLElement | null;
    const unlock = lockScroll();
    const panel = panelRef.current;
    const focusFirst = () => {
      // Only explicit targets get focus: auto-focusing a text field would pop the keyboard on phones.
      const target = panel?.querySelector<HTMLElement>('[data-autofocus]') ?? panel;
      target?.focus({ preventScroll: true });
    };
    const raf = requestAnimationFrame(focusFirst);

    const onKeyDown = (event: KeyboardEvent) => {
      if (!panel) return;
      if (event.key === 'Escape') {
        // Only the top-most dialog reacts.
        const dialogs = document.querySelectorAll('[data-dialog-panel]');
        if (dialogs[dialogs.length - 1] !== panel) return;
        event.stopPropagation();
        if (dismissibleRef.current) onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab') return;
      const nodes = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((n) => n.offsetParent !== null);
      if (nodes.length === 0) {
        event.preventDefault();
        panel.focus();
        return;
      }
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (event.shiftKey && (document.activeElement === first || document.activeElement === panel)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener('keydown', onKeyDown);
      unlock();
      if (opener && document.contains(opener)) opener.focus({ preventScroll: true });
    };
  }, [open]);

  if (!open) return null;

  const widths = { sm: 'sm:max-w-md', md: 'sm:max-w-lg', lg: 'sm:max-w-2xl', xl: 'sm:max-w-4xl' }[size];
  const sheet = variant === 'sheet';

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center" dir="rtl">
      <div
        aria-hidden
        className="absolute inset-0 animate-fade-in bg-black/65 backdrop-blur-[3px]"
        onClick={() => dismissible && onClose()}
      />
      <div
        ref={panelRef}
        data-dialog-panel
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descId : undefined}
        tabIndex={-1}
        className={cn(
          'relative flex max-h-[92dvh] w-full flex-col overflow-hidden border border-line-strong bg-surface shadow-(--shadow-pop) outline-none',
          'animate-sheet-up rounded-t-3xl pb-(--safe-bottom) sm:pb-0',
          sheet
            ? cn('sm:absolute sm:inset-y-0 sm:start-0 sm:max-h-none sm:animate-slide-in-start sm:rounded-none sm:border-y-0 sm:border-s-0', widths)
            : cn('sm:animate-pop-in sm:rounded-2xl', widths),
          className,
        )}
      >
        <div className="mx-auto mt-2.5 h-1 w-10 shrink-0 rounded-full bg-white/15 sm:hidden" aria-hidden />
        <header className="flex shrink-0 items-start gap-3 px-5 pb-3 pt-4 sm:px-6 sm:pt-5">
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="text-base font-semibold text-fg">
              {title}
            </h2>
            {description && (
              <p id={descId} className="mt-1 text-[0.8125rem] leading-relaxed text-muted">
                {description}
              </p>
            )}
          </div>
          {dismissible && (
            <IconButton label="إغلاق" size="sm" onClick={onClose} className="-me-1.5 -mt-1">
              <X />
            </IconButton>
          )}
        </header>
        <div className={cn('min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-5 sm:px-6', bodyClassName)}>{children}</div>
        {footer && (
          <footer className="flex shrink-0 flex-wrap-reverse items-center justify-end gap-2 border-t border-line bg-surface-2/60 px-5 py-3.5 sm:px-6">
            {footer}
          </footer>
        )}
      </div>
    </div>,
    document.body,
  );
}
