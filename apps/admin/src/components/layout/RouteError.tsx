import { isRouteErrorResponse, Link, useRouteError } from 'react-router';
import { RefreshCw, TriangleAlert } from 'lucide-react';
import { Button, buttonStyles } from '../ui/button';

/** Error boundary for route modules (e.g. a chunk that failed to load after a deploy). */
export function RouteError() {
  const error = useRouteError();
  const chunkFailed = error instanceof Error && /dynamically imported module|Importing a module script failed|Failed to fetch/i.test(error.message);
  const title = isRouteErrorResponse(error) && error.status === 404 ? 'الصفحة مو موجودة' : chunkFailed ? 'نزلت نسخة جديدة من اللوحة' : 'صار خطأ غير متوقع';
  const body = chunkFailed ? 'حدّث الصفحة حتى تحمّل آخر نسخة.' : 'جرّب تحدّث الصفحة. إذا تكررت المشكلة، تأكد إن الخادم شغّال.';

  return (
    <div className="grid min-h-dvh place-items-center px-6">
      <div className="flex max-w-sm flex-col items-center gap-4 text-center">
        <span className="grid size-14 place-items-center rounded-2xl border border-line bg-surface-2 text-warning">
          <TriangleAlert className="size-6" aria-hidden />
        </span>
        <div>
          <h1 className="text-lg font-semibold">{title}</h1>
          <p className="mt-1 text-sm text-muted">{body}</p>
        </div>
        <div className="flex gap-2">
          <Button variant="primary" icon={<RefreshCw />} onClick={() => window.location.reload()}>
            تحديث الصفحة
          </Button>
          <Link to="/" className={buttonStyles({ variant: 'ghost' })}>
            الرئيسية
          </Link>
        </div>
      </div>
    </div>
  );
}
