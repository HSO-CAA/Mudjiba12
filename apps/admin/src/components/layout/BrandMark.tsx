import { cn } from '../../lib/cn';

/** Lens-in-viewfinder mark (same drawing as the favicon). */
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={cn('size-9 shrink-0', className)} aria-hidden>
      <rect width="64" height="64" rx="16" fill="#16161a" />
      <rect x="1" y="1" width="62" height="62" rx="15" fill="none" stroke="#e9b35f" strokeOpacity=".3" strokeWidth="2" />
      <circle cx="32" cy="32" r="15" fill="none" stroke="#e9b35f" strokeWidth="4" />
      <circle cx="32" cy="32" r="5.5" fill="#e9b35f" />
      <path
        d="M15 21v-6h6M43 15h6v6M49 43v6h-6M21 49h-6v-6"
        fill="none"
        stroke="#f3f0ea"
        strokeOpacity=".65"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
    </svg>
  );
}
