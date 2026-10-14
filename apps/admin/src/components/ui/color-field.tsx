import { useEffect, useState } from 'react';
import { Check } from 'lucide-react';
import { cn } from '../../lib/cn';

const HEX = /^#[0-9a-f]{6}$/i;
export const isHexColor = (value: string) => HEX.test(value);

export const ACCENT_PRESETS = ['#e9b35f', '#f2784b', '#e5484d', '#d6409f', '#8e4ec6', '#3e63dd', '#0090ff', '#12a594', '#30a46c', '#c8ba9d'];

export function ColorField({
  value,
  onChange,
  id,
  presets = ACCENT_PRESETS,
  'aria-invalid': invalid,
  'aria-describedby': describedBy,
}: {
  value: string;
  onChange: (value: string) => void;
  id?: string;
  presets?: string[];
  'aria-invalid'?: boolean;
  'aria-describedby'?: string;
}) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);

  const commit = (raw: string) => {
    let next = raw.trim();
    if (!next.startsWith('#')) next = `#${next}`;
    if (/^#[0-9a-f]{3}$/i.test(next)) next = `#${next[1]}${next[1]}${next[2]}${next[2]}${next[3]}${next[3]}`;
    if (HEX.test(next)) onChange(next.toLowerCase());
    else setText(value);
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2.5">
        <label className="relative size-11 shrink-0 overflow-hidden rounded-xl border border-line-strong" title="اختار لون">
          <span className="sr-only">اختار لون</span>
          <input
            type="color"
            value={HEX.test(value) ? value : '#e9b35f'}
            onChange={(event) => onChange(event.target.value.toLowerCase())}
            className="absolute -inset-1 size-[calc(100%+0.5rem)]"
          />
        </label>
        <input
          id={id}
          dir="ltr"
          value={text}
          onChange={(event) => setText(event.target.value)}
          onBlur={(event) => commit(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              commit(text);
            }
          }}
          spellCheck={false}
          maxLength={7}
          aria-invalid={invalid}
          aria-describedby={describedBy}
          className="num h-11 w-32 rounded-xl border border-line bg-surface-2 px-3 text-left text-sm uppercase text-fg hover:border-line-strong focus:border-accent/60 focus:shadow-[0_0_0_3px_rgb(233_179_95/0.14)] focus:outline-none"
        />
      </div>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="ألوان جاهزة">
        {presets.map((color) => {
          const active = color.toLowerCase() === value.toLowerCase();
          return (
            <button
              key={color}
              type="button"
              onClick={() => onChange(color)}
              aria-label={color}
              aria-pressed={active}
              className={cn(
                'grid size-7 place-items-center rounded-full ring-offset-2 ring-offset-surface transition-transform hover:scale-110',
                active && 'ring-2 ring-fg/70',
              )}
              style={{ background: color }}
            >
              {active && <Check className="size-3.5 text-black/70" aria-hidden />}
            </button>
          );
        })}
      </div>
    </div>
  );
}
