import { useMutation, useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import type { AdminUser } from '@s5y/shared';
import { api } from '../../lib/endpoints';
import { qk } from '../../lib/query';

export function useSession() {
  return useQuery({
    queryKey: qk.me,
    queryFn: () => api.auth.me(),
    staleTime: 5 * 60_000,
    retry: false,
    refetchOnWindowFocus: false,
  });
}

/** The signed-in user (only call below <RequireAuth>). */
export function useUser(): AdminUser | null {
  const { data } = useSession();
  return data?.user ?? null;
}

export function useLogout() {
  const navigate = useNavigate();
  return useMutation({
    mutationFn: () => api.auth.logout(),
    meta: { silent: true },
    // The login page clears the cache once the dashboard has unmounted (clearing here would make
    // still-mounted queries refetch and hit 401).
    onSettled: () => navigate('/login', { replace: true, state: { loggedOut: true } }),
  });
}

/** Only allow in-app absolute paths as post-login targets. */
export function safeNext(next: string | null): string {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.startsWith('/login')) return '/';
  return next;
}
