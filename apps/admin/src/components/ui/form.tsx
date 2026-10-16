import {
  cloneElement,
  forwardRef,
  isValidElement,
  useId,
  type InputHTMLAttributes,
  type ReactElement,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '../../lib/cn';

const control =
  'w-full rounded-xl border border-line bg-surface-2 text-[0.9375rem] text-fg transition-[border-color,box-shadow,background-color] duration-150 hover:border-line-strong focus:border-accent/60 focus:bg-surface-2 focus:shadow-[0_0_0_3px_rgb(233_179_95/0.14)] focus:outline-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-danger/60 aria-invalid:focus:shadow-[0_0_0_3px_rgb(242_107_99/0.16)]';

export interface FieldProps {
  label?: ReactNode;
  hint?: ReactNode;
  error?: string | null;
  /** Shown at the end of the label row, e.g. a character counter. */
  aside?: ReactNode;
  required?: boolean;
  className?: string;
  children: ReactElement<{ id?: string; 'aria-invalid'?: boolean; 'aria-describedby'?: string }>;
}

/** Label + control + hint/error, wiring ids and aria attributes onto the child control. */
export function Field({ label, hint, error, aside, required, className, children }: FieldProps) {
  const autoId = useId();
  const id = (isValidElement(children) && children.props.id) || autoId;
  const hintId = `${id}-hint`;
  const describedBy = error || hint ? hintId : undefined;
  return (
    <div className={cn('flex min-w-0 flex-col gap-1.5', className)}>
      {(label || aside) && (
        <div className="flex items-baseline justify-between gap-3">
          {label && (
            <label htmlFor={id} className="text-[0.8125rem] font-medium text-fg-2">
              {label}
              {required && <span className="ms-0.5 text-accent">*</span>}
            </label>
          )}
          {aside && <div className="text-xs text-subtle">{aside}</div>}
        </div>
      )}
      {cloneElement(children, { id, 'aria-invalid': error ? true : undefined, 'aria-describedby': describedBy })}
      {(error || hint) && (
        <p id={hintId} className={cn('text-xs leading-relaxed', error ? 'text-danger' : 'text-muted')}>
          {error || hint}
        </p>
      )}
    </div>
  );
}

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  /** Element pinned to the start side (right in RTL), e.g. an icon. */
  start?: ReactNode;
  /** Element pinned to the end side, e.g. a unit. */
  end?: ReactNode;
  /** Force left-to-right content (URLs, emails, numbers). */
  ltr?: boolean;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input({ start, end, ltr, className, ...rest }, ref) {
  const input = (
    <input
      ref={ref}
      dir={ltr ? 'ltr' : undefined}
      className={cn(
        control,
        'h-11 px-3.5',
        ltr && 'text-left placeholder:text-left',
        start && 'ps-10',
        end && 'pe-12',
        !start && !end && className,
      )}
      {...rest}
    />
  );
  if (!start && !end) return input;
  // LTR content (emails, URLs, handles) keeps its adornments in LTR positions too.
  return (
    <div className={cn('relative', className)} dir={ltr ? 'ltr' : undefined}>
      {start && (
        <span className="pointer-events-none absolute inset-y-0 start-0 flex w-10 items-center justify-center text-muted [&_svg]:size-4">
          {start}
        </span>
      )}
      {input}
      {end && (
        <span className="absolute inset-y-0 end-0 flex min-w-11 items-center justify-center px-2 text-xs text-muted">{end}</span>
      )}
    </div>
  );
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea(
  { className, rows = 4, ...rest },
  ref,
) {
  return <textarea ref={ref} rows={rows} className={cn(control, 'min-h-24 resize-y px-3.5 py-2.5 leading-relaxed', className)} {...rest} />;
});

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select(
  { className, children, ...rest },
  ref,
) {
  return (
    <div className={cn('relative', className)}>
      <select ref={ref} className={cn(control, 'h-11 cursor-pointer appearance-none ps-3.5 pe-10')} {...rest}>
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute end-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
    </div>
  );
});

export interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
  disabled?: boolean;
  size?: 'sm' | 'md';
  id?: string;
  className?: string;
}

export function Switch({ checked, onChange, label, disabled, size = 'md', id, className }: SwitchProps) {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={(event) => {
        event.stopPropagation();
        onChange(!checked);
      }}
      className={cn(
        'relative inline-flex shrink-0 cursor-pointer items-center rounded-full border transition-colors duration-200 disabled:cursor-not-allowed disabled:opacity-45',
        size === 'md' ? 'h-6 w-10.5' : 'h-5 w-8.5',
        checked ? 'border-accent/60 bg-accent' : 'border-line-strong bg-surface-4',
        className,
      )}
    >
      <span
        aria-hidden
        className={cn(
          'absolute top-1/2 -translate-y-1/2 rounded-full shadow-sm transition-[inset-inline-start,background-color] duration-200 ease-(--ease-cine)',
          size === 'md' ? 'size-4.5' : 'size-3.5',
          checked ? 'bg-accent-ink' : 'bg-fg-2',
          checked ? (size === 'md' ? 'start-[calc(100%-1.375rem)]' : 'start-[calc(100%-1.125rem)]') : 'start-0.5',
        )}
      />
    </button>
  );
}

/** A labelled row with a description and a switch on the end side. */
export function SwitchRow({
  title,
  description,
  checked,
  onChange,
  disabled,
  icon,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  icon?: ReactNode;
  className?: string;
}) {
  const id = useId();
  return (
    <div className={cn('flex items-center gap-3.5 py-3', className)}>
      {icon && (
        <span className="grid size-9 shrink-0 place-items-center rounded-xl border border-line bg-surface-2 text-fg-2 [&_svg]:size-[1.0625rem]">
          {icon}
        </span>
      )}
      <label htmlFor={id} className="min-w-0 flex-1 cursor-pointer">
        <span className="block text-sm font-medium text-fg">{title}</span>
        {description && <span className="mt-0.5 block text-[0.8125rem] leading-relaxed text-muted">{description}</span>}
      </label>
      <Switch id={id} checked={checked} onChange={onChange} disabled={disabled} />
    </div>
  );
}

/** Character counter for Field's `aside`. */
export function Counter({ value, max }: { value: string; max: number }) {
  const over = value.length > max;
  return (
    <span className={cn('num tabular text-[0.6875rem]', over ? 'text-danger' : 'text-subtle')} dir="ltr">
      {value.length}/{max}
    </span>
  );
}
