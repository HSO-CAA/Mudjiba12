import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router';
import { RefreshCw, ServerCrash } from 'lucide-react';
import { ApiError } from '../../lib/api';
import { Button } from '../../components/ui/button';
import { Splash } from '../../components/layout/Splash';
import { useSession } from './session';

export function RequireAuth({ children }: { children: ReactNode }) {
  const session = useSession();
  const location = useLocation();

  if (session.isPending) return <Splash />;

  if (session.isError) {
    const unauthorized = session.error instanceof ApiError && session.error.status === 401;
    if (unauthorized) {
      const next = `${location.pathname}${location.search}`;
      return <Navigate to={next === '/' ? '/login' : `/login?next=${encodeURIComponent(next)}`} replace />;
    }
    return (
      <div className="grid min-h-dvh place-items-center px-6">
        <div className="flex max-w-sm flex-col items-center gap-4 text-center">
          <span className="grid size-14 place-items-center rounded-2xl border border-line bg-surface-2 text-danger">
            <ServerCrash className="size-6" aria-hidden />
          </span>
          <div>
            <h1 className="text-lg font-semibold">ما گدرنا نوصل للخادم</h1>
            <p className="mt-1 text-sm text-muted">{session.error.message}</p>
          </div>
          <Button variant="primary" icon={<RefreshCw />} onClick={() => void session.refetch()} loading={session.isFetching}>
            إعادة المحاولة
          </Button>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
