import { useEffect, useRef, useState } from 'react';
import { Check, Pencil, X } from 'lucide-react';
import { cn } from '../../lib/cn';

/** Click-to-edit single line text. Enter saves, Escape cancels, blur saves. */
export function InlineEdit({
  value,
  onSave,
  placeholder = 'بدون عنوان',
  maxLength = 120,
  label = 'تعديل العنوان',
  className,
}: {
  value: string;
  onSave: (value: string) => void;
  placeholder?: string;
  maxLength?: number;
  label?: string;
  className?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);
  const cancelled = useRef(false);

  useEffect(() => {
    if (!editing) setDraft(value);
  }, [value, editing]);

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  const commit = () => {
    setEditing(false);
    if (cancelled.current) {
      cancelled.current = false;
      setDraft(value);
      return;
    }
    const next = draft.trim();
    if (next !== value.trim()) onSave(next);
  };

  if (editing) {
    return (
      <div className={cn('flex items-center gap-1', className)}>
        <input
          ref={inputRef}
          value={draft}
          maxLength={maxLength}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              inputRef.current?.blur();
            } else if (event.key === 'Escape') {
              event.preventDefault();
              cancelled.current = true;
              inputRef.current?.blur();
            }
          }}
          aria-label={label}
          enterKeyHint="done"
          className="h-8 min-w-0 flex-1 rounded-lg border border-accent/60 bg-surface-2 px-2 text-[0.8125rem] shadow-[0_0_0_3px_rgb(233_179_95/0.14)] focus:outline-none"
        />
        <button
          type="button"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => inputRef.current?.blur()}
          className="grid size-7 shrink-0 place-items-center rounded-md text-success hover:bg-white/5"
          aria-label="حفظ"
        >
          <Check className="size-3.5" aria-hidden />
        </button>
        <button
          type="button"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            cancelled.current = true;
            inputRef.current?.blur();
          }}
          className="grid size-7 shrink-0 place-items-center rounded-md text-muted hover:bg-white/5"
          aria-label="إلغاء"
        >
          <X className="size-3.5" aria-hidden />
        </button>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      className={cn(
        'group/edit flex h-8 w-full min-w-0 items-center gap-1.5 rounded-lg px-1 text-start text-[0.8125rem] font-medium transition-colors hover:bg-white/[0.04]',
        className,
      )}
      aria-label={`${label}: ${value || placeholder}`}
    >
      <span className={cn('min-w-0 flex-1 truncate', !value && 'text-subtle')}>{value || placeholder}</span>
      <Pencil className="size-3.5 shrink-0 text-subtle opacity-60 transition-opacity group-hover/edit:opacity-100 sm:opacity-0" aria-hidden />
    </button>
  );
}
