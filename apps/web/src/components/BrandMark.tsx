/** Small lens glyph + wordmark used in the header and footer. */
export function LensGlyph({ className = '' }: { className?: string }) {
  return (
    <span className={`relative inline-grid size-8 shrink-0 place-items-center rounded-full bg-[#0b0b0d] ring-1 ring-white/15 ${className}`} aria-hidden="true">
      <span className="absolute inset-[3px] rounded-full ring-[1.5px] ring-accent" />
      <span className="size-3.5 rounded-full bg-[radial-gradient(circle_at_35%_30%,#6d5bd0_0%,#1a1630_55%,#050507_100%)] shadow-[inset_0_0_4px_rgba(255,255,255,0.25)]" />
      <span className="absolute left-[9px] top-[8px] size-1 rounded-full bg-white/70" />
    </span>
  );
}
