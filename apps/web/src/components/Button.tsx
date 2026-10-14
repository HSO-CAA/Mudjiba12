import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode } from 'react';
import { Link, type LinkProps } from 'react-router';

type Variant = 'primary' | 'ghost' | 'quiet';
type Size = 'md' | 'lg';

const base =
  'group/btn relative inline-flex select-none items-center justify-center gap-2.5 rounded-full font-semibold transition-[background-color,border-color,color,box-shadow,transform] duration-300 ease-[cubic-bezier(.16,1,.3,1)] active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50';

const variants: Record<Variant, string> = {
  primary:
    'bg-accent text-[var(--accent-ink)] shadow-[0_10px_40px_-12px_var(--accent)] hover:shadow-[0_14px_60px_-10px_var(--accent)] hover:brightness-110',
  ghost: 'border border-line-strong bg-white/[0.03] text-text backdrop-blur-md hover:border-accent/70 hover:bg-white/[0.06]',
  quiet: 'text-text/90 hover:text-accent',
};

const sizes: Record<Size, string> = {
  md: 'h-11 px-5 text-[0.95rem]',
  lg: 'h-14 px-7 text-base sm:text-[1.05rem]',
};

export function buttonClass(variant: Variant = 'primary', size: Size = 'md', extra = ''): string {
  return `${base} ${variants[variant]} ${sizes[size]} ${extra}`;
}

interface Common {
  variant?: Variant;
  size?: Size;
  icon?: ReactNode;
  children: ReactNode;
  className?: string;
}

export function Button({ variant, size, icon, children, className, ...rest }: Common & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type="button" className={buttonClass(variant, size, className)} {...rest}>
      <span>{children}</span>
      {icon}
    </button>
  );
}

export function ButtonAnchor({ variant, size, icon, children, className, ...rest }: Common & AnchorHTMLAttributes<HTMLAnchorElement>) {
  return (
    <a className={buttonClass(variant, size, className)} {...rest}>
      <span>{children}</span>
      {icon}
    </a>
  );
}

export function ButtonLink({ variant, size, icon, children, className, ...rest }: Common & Omit<LinkProps, 'children' | 'className'>) {
  return (
    <Link className={buttonClass(variant, size, className)} {...rest}>
      <span>{children}</span>
      {icon}
    </Link>
  );
}
