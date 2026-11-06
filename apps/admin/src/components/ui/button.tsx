import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Link, type LinkProps } from 'react-router';
import { LoaderCircle } from 'lucide-react';
import { cn } from '../../lib/cn';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'outline' | 'danger' | 'danger-ghost';
export type ButtonSize = 'xs' | 'sm' | 'md' | 'lg';

const base =
  'inline-flex shrink-0 select-none items-center justify-center gap-2 whitespace-nowrap rounded-xl font-medium transition-[background-color,border-color,color,box-shadow,transform,opacity] duration-150 ease-out active:scale-[0.98] disabled:pointer-events-none disabled:opacity-45';

const variants: Record<ButtonVariant, string> = {
  primary:
    'bg-accent text-accent-ink shadow-[0_1px_0_rgb(255_255_255/0.35)_inset,0_8px_24px_-10px_rgb(233_179_95/0.55)] hover:bg-accent-hover',
  secondary: 'border border-line bg-surface-3 text-fg hover:border-line-strong hover:bg-surface-4',
  outline: 'border border-line-strong bg-transparent text-fg hover:bg-white/[0.04]',
  ghost: 'text-fg-2 hover:bg-white/[0.06] hover:text-fg',
  danger: 'bg-danger/90 text-white hover:bg-danger',
  'danger-ghost': 'text-danger hover:bg-danger/10',
};

const sizes: Record<ButtonSize, string> = {
  xs: 'h-7 px-2.5 text-xs [&_svg]:size-3.5',
  sm: 'h-8.5 px-3 text-[0.8125rem] [&_svg]:size-4',
  md: 'h-10 px-4 text-sm [&_svg]:size-[1.0625rem]',
  lg: 'h-12 px-5 text-[0.9375rem] [&_svg]:size-5',
};

const iconSizes: Record<ButtonSize, string> = {
  xs: 'size-7 [&_svg]:size-3.5',
  sm: 'size-8.5 [&_svg]:size-4',
  md: 'size-10 [&_svg]:size-[1.125rem]',
  lg: 'size-12 [&_svg]:size-5',
};

export function buttonStyles(options: { variant?: ButtonVariant; size?: ButtonSize; icon?: boolean; className?: string } = {}): string {
  const { variant = 'secondary', size = 'md', icon = false, className } = options;
  return cn(base, variants[variant], icon ? iconSizes[size] : sizes[size], className);
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  icon?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', loading = false, icon, className, children, disabled, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={buttonStyles({ variant, size, className })}
      {...rest}
    >
      {loading ? <LoaderCircle className="animate-spin" aria-hidden /> : icon}
      {children}
    </button>
  );
});

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Accessible name (also shown as a native tooltip). */
  label: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, variant = 'ghost', size = 'md', loading = false, className, children, disabled, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      title={label}
      disabled={disabled || loading}
      className={buttonStyles({ variant, size, icon: true, className })}
      {...rest}
    >
      {loading ? <LoaderCircle className="animate-spin" aria-hidden /> : children}
    </button>
  );
});

export interface ButtonLinkProps extends LinkProps {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: ReactNode;
}

export function ButtonLink({ variant = 'secondary', size = 'md', icon, className, children, ...rest }: ButtonLinkProps) {
  return (
    <Link className={buttonStyles({ variant, size, className: typeof className === 'string' ? className : undefined })} {...rest}>
      {icon}
      {children}
    </Link>
  );
}
