import { useRef, useState, type KeyboardEvent } from 'react';
import { X } from 'lucide-react';
import { cn } from '../../lib/cn';

const SEPARATORS = /[,،\n]/;

/** Free-text tags: Enter / comma / "،" adds, Backspace on empty removes the last. */
export function ChipsInput({
  value,
  onChange,
  placeholder = 'اكتب واضغط Enter',
  max = 20,
  maxLength = 40,
  id,
  suggestions = [],
  'aria-invalid': invalid,
  'aria-describedby': describedBy,
}: {
  value: string[];
  onChange: (value: string[]) => void;
  placeholder?: string;
  max?: number;
  maxLength?: number;
  id?: string;
  suggestions?: string[];
  'aria-invalid'?: boolean;
  'aria-describedby'?: string;
}) {
  const [draft, setDraft] = useState('');
  // Latest list, also between two events of the same tap (input blur → suggestion click) before React re-renders;
  // reading `value` there would drop the chip added on blur.
  const latest = useRef(value);
  latest.current = value;

  const commit = (next: string[]) => {
    latest.current = next;
    onChange(next);
  };

  const add = (raw: string) => {
    const parts = raw
      .split(SEPARATORS)
      .map((part) => part.trim().slice(0, maxLength))
      .filter(Boolean);
    setDraft('');
    if (parts.length === 0) return;
    const next = [...latest.current];
    for (const part of parts) {
      if (next.length >= max) break;
      if (!next.some((existing) => existing.toLowerCase() === part.toLowerCase())) next.push(part);
    }
    if (next.length !== latest.current.length) commit(next);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter' || event.key === ',' || event.key === '،') {
      event.preventDefault();
      add(draft);
    } else if (event.key === 'Backspace' && draft === '' && latest.current.length > 0) {
      commit(latest.current.slice(0, -1));
    }
  };

  /** Phone keyboards often skip keydown for "،" / ","; split on the typed text instead. */
  const onType = (text: string) => {
    if (!SEPARATORS.test(text)) {
      setDraft(text);
      return;
    }
    const parts = text.split(SEPARATORS);
    const rest = parts.pop() ?? '';
    add(parts.join(','));
    setDraft(rest);
  };

  const remaining = suggestions.filter((s) => !value.some((v) => v.toLowerCase() === s.toLowerCase()));

  return (
    <div className="flex flex-col gap-2">
      <div
        className={cn(
          'flex min-h-11 flex-wrap items-center gap-1.5 rounded-xl border border-line bg-surface-2 px-2 py-1.5 transition-[border-color,box-shadow] focus-within:border-accent/60 focus-within:shadow-[0_0_0_3px_rgb(233_179_95/0.14)] hover:border-line-strong',
          invalid && 'border-danger/60',
        )}
      >
        {value.map((chip, index) => (
          <span
            key={`${chip}-${index}`}
            className="inline-flex h-7 items-center gap-1 rounded-lg border border-line bg-surface-4 ps-2.5 pe-1 text-[0.8125rem] text-fg"
          >
            {chip}
            <button
              type="button"
              onClick={() => commit(latest.current.filter((_, i) => i !== index))}
              className="grid size-5 place-items-center rounded-md text-muted hover:bg-white/10 hover:text-fg"
              aria-label={`إزالة ${chip}`}
            >
              <X className="size-3" aria-hidden />
            </button>
          </span>
        ))}
        <input
          id={id}
          value={draft}
          onChange={(event) => onType(event.target.value)}
          onKeyDown={onKeyDown}
          onBlur={() => add(draft)}
          placeholder={value.length >= max ? '' : placeholder}
          disabled={value.length >= max}
          enterKeyHint="enter"
          aria-invalid={invalid}
          aria-describedby={describedBy}
          className="h-7 min-w-32 flex-1 bg-transparent px-1.5 text-sm focus:outline-none"
        />
      </div>
      {remaining.length > 0 && value.length < max && (
        <div className="flex flex-wrap gap-1.5">
          {remaining.slice(0, 8).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => add(s)}
              className="h-7 rounded-lg border border-dashed border-line-strong px-2.5 text-xs text-muted transition-colors hover:border-accent/50 hover:text-fg"
            >
              + {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
