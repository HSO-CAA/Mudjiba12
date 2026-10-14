import { RotateCcw, Save } from 'lucide-react';
import { cn } from '../../lib/cn';
import { Button } from './button';

/** Sticky "unsaved changes" bar; sits above the mobile bottom nav. */
export function SaveBar({
  visible,
  saving,
  onSave,
  onDiscard,
  message = 'عندك تغييرات غير محفوظة',
  saveLabel = 'حفظ التغييرات',
}: {
  visible: boolean;
  saving?: boolean;
  onSave: () => void;
  onDiscard: () => void;
  message?: string;
  saveLabel?: string;
}) {
  return (
    <div
      aria-hidden={!visible}
      className={cn(
        'pointer-events-none fixed inset-x-0 z-30 flex justify-center px-3 transition-[transform,opacity] duration-300 ease-(--ease-cine)',
        'bottom-[calc(var(--mobile-nav-h)+0.75rem)] lg:bottom-6 lg:ps-(--sidebar-w)',
        visible ? 'translate-y-0 opacity-100' : 'translate-y-6 opacity-0',
      )}
    >
      <div
        role="region"
        aria-label="حفظ التغييرات"
        className={cn(
          'flex w-full max-w-xl items-center gap-3 rounded-2xl border border-line-strong bg-surface-3/95 p-2 ps-4 shadow-(--shadow-pop) backdrop-blur-md',
          visible && 'pointer-events-auto',
        )}
      >
        <span className="flex min-w-0 flex-1 items-center gap-2 text-[0.8125rem] text-fg-2">
          <span className="size-2 shrink-0 animate-rec rounded-full bg-accent" aria-hidden />
          <span className="truncate">{message}</span>
        </span>
        <Button variant="ghost" size="sm" onClick={onDiscard} disabled={saving || !visible} icon={<RotateCcw />} tabIndex={visible ? 0 : -1} aria-label="تراجع عن التغييرات">
          <span className="hidden sm:inline">تراجع</span>
        </Button>
        <Button variant="primary" size="sm" onClick={onSave} loading={saving} disabled={!visible} icon={<Save />} tabIndex={visible ? 0 : -1}>
          {saveLabel}
        </Button>
      </div>
    </div>
  );
}
