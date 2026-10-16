import { BrandMark } from './BrandMark';

export function Splash() {
  return (
    <div className="grid min-h-dvh place-items-center" role="status" aria-label="جاري التحميل">
      <div className="flex flex-col items-center gap-5">
        <BrandMark className="size-12 animate-pulse" />
        <div className="h-0.5 w-28 overflow-hidden rounded-full bg-white/10">
          <div className="progress-stripes h-full w-full bg-accent/60" />
        </div>
      </div>
    </div>
  );
}
