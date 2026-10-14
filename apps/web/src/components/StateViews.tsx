import { Link } from 'react-router';
import { ApiError } from '../api/client';
import { Button } from './Button';

/** Full-page error with retry (network / server failures). */
export function ErrorView({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const message = error instanceof ApiError ? error.message : 'صار خطأ غير متوقع أثناء تحميل الصفحة.';
  return (
    <section className="container-cine flex min-h-[80svh] flex-col items-center justify-center gap-6 py-32 text-center" role="alert">
      <p className="hud flex items-center gap-2 text-rec">
        <span className="inline-block size-1.5 rounded-full bg-rec" /> SIGNAL LOST
      </p>
      <h1 className="display-xl text-[clamp(2.2rem,6vw,4rem)]">انقطع البث للحظة</h1>
      <p className="max-w-md leading-8 text-muted">{message}</p>
      <div className="flex flex-wrap justify-center gap-3">
        {onRetry && (
          <Button size="lg" onClick={onRetry}>
            حاول مرة ثانية
          </Button>
        )}
        <Link to="/" className="inline-flex h-14 items-center rounded-full border border-line-strong px-7 font-semibold transition hover:border-accent">
          الرئيسية
        </Link>
      </div>
    </section>
  );
}

/** Skeleton for the place page while details load and nothing is cached. */
export function PlaceSkeleton() {
  return (
    <div aria-busy="true" aria-label="جاري التحميل">
      <div className="skeleton h-[78svh] w-full" />
      <div className="container-cine grid gap-5 py-16 sm:grid-cols-3">
        {Array.from({ length: 3 }, (_, i) => (
          <div key={i} className="skeleton aspect-[9/16] rounded-[1.25rem]" />
        ))}
      </div>
    </div>
  );
}
