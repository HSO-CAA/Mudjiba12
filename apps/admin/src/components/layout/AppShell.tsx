import { useEffect, useRef, useState, type ReactNode } from 'react';
import { NavLink, Outlet, useLocation, useNavigate, useNavigation } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Clapperboard,
  Crown,
  ExternalLink,
  Inbox,
  LayoutDashboard,
  LogOut,
  Menu as MenuIcon,
  PanelRightClose,
  PanelRightOpen,
  Settings,
  Store,
  UserRound,
} from 'lucide-react';
import { setUnauthorizedHandler } from '../../lib/api';
import { cn } from '../../lib/cn';
import { api } from '../../lib/endpoints';
import { qk } from '../../lib/query';
import { siteUrl } from '../../lib/site';
import { useLogout, useUser } from '../../features/auth/session';
import { Dialog } from '../ui/dialog';
import { BrandMark } from './BrandMark';
import { UploadTray } from './UploadTray';

interface NavItem {
  to: string;
  label: string;
  icon: ReactNode;
  end?: boolean;
  badge?: number;
}

const COLLAPSE_KEY = 's5y-admin:sidebar-collapsed';

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSE_KEY) === '1';
  } catch {
    return false;
  }
}

function useNewInquiries(): number {
  const { data } = useQuery({
    queryKey: qk.inquiryBadge,
    queryFn: () => api.inquiries.list({ status: 'NEW', pageSize: 1 }),
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
  return data?.counts.NEW ?? 0;
}

/** Registers the global 401 → login redirect (keeps the current path as `next`). */
function useUnauthorizedRedirect() {
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const locationRef = useRef(location);
  locationRef.current = location;

  useEffect(() => {
    let redirecting = false;
    setUnauthorizedHandler(() => {
      if (redirecting) return;
      redirecting = true;
      const { pathname, search } = locationRef.current;
      const next = `${pathname}${search}`;
      queryClient.removeQueries({ queryKey: qk.me });
      queryClient.cancelQueries().catch(() => undefined);
      navigate(next === '/' ? '/login' : `/login?next=${encodeURIComponent(next)}`, { replace: true });
    });
    return () => setUnauthorizedHandler(null);
  }, [navigate, queryClient]);
}

function NavigationProgress() {
  const navigation = useNavigation();
  const busy = navigation.state !== 'idle';
  return (
    <div
      aria-hidden
      className={cn(
        'fixed inset-x-0 top-0 z-[60] h-0.5 origin-right bg-accent transition-[transform,opacity] duration-500 ease-(--ease-cine)',
        busy ? 'scale-x-75 opacity-100' : 'scale-x-100 opacity-0',
      )}
    />
  );
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'S';
  return parts
    .slice(0, 2)
    .map((p) => p[0])
    .join('')
    .toUpperCase();
}

export function AppShell() {
  useUnauthorizedRedirect();
  const user = useUser();
  const logout = useLogout();
  const newInquiries = useNewInquiries();
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [moreOpen, setMoreOpen] = useState(false);

  useEffect(() => {
    document.documentElement.style.setProperty('--sidebar-w', collapsed ? '4.75rem' : '16.5rem');
    try {
      localStorage.setItem(COLLAPSE_KEY, collapsed ? '1' : '0');
    } catch {
      /* private mode */
    }
  }, [collapsed]);

  useEffect(() => setMoreOpen(false), [location.pathname]);

  const primary: NavItem[] = [
    { to: '/', label: 'نظرة عامة', icon: <LayoutDashboard />, end: true },
    { to: '/places', label: 'الأماكن', icon: <Store /> },
    { to: '/videos', label: 'الفيديوهات', icon: <Clapperboard /> },
    { to: '/inquiries', label: 'الرسائل', icon: <Inbox />, badge: newInquiries },
    { to: '/plans', label: 'الباقات', icon: <Crown /> },
    { to: '/settings', label: 'الإعدادات', icon: <Settings /> },
  ];
  const mobileTabs = primary.slice(0, 4);
  const moreActive = ['/plans', '/settings', '/account'].some((p) => location.pathname.startsWith(p));

  return (
    <div className="min-h-dvh">
      <NavigationProgress />
      <a
        href="#main"
        className="sr-only z-[70] rounded-lg bg-accent px-3 py-2 text-accent-ink focus:not-sr-only focus:fixed focus:start-3 focus:top-3"
      >
        تخطَّ إلى المحتوى
      </a>

      {/* ───── Desktop sidebar ───── */}
      <aside
        className="fixed inset-y-0 start-0 z-30 hidden w-(--sidebar-w) flex-col border-e border-line bg-surface/80 backdrop-blur-xl transition-[width] duration-300 ease-(--ease-cine) lg:flex"
        aria-label="القائمة الرئيسية"
      >
        <div className={cn('flex h-16 shrink-0 items-center gap-3 px-4', collapsed && 'justify-center px-0')}>
          <BrandMark className="size-9" />
          {!collapsed && (
            <div className="min-w-0 flex-1 leading-tight">
              <p className="truncate text-sm font-bold">S5Y Studio</p>
              <p className="truncate text-xs text-muted">لوحة التحكم</p>
            </div>
          )}
        </div>

        <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto px-3 py-3">
          {primary.map((item) => (
            <SidebarLink key={item.to} item={item} collapsed={collapsed} />
          ))}
        </nav>

        <div className="flex flex-col gap-0.5 border-t border-line px-3 py-3">
          <a
            href={siteUrl('/')}
            target="_blank"
            rel="noopener"
            className={cn(sidebarItem(false), collapsed && 'justify-center px-0')}
            title={collapsed ? 'عرض الموقع' : undefined}
          >
            <ExternalLink />
            {!collapsed && <span className="flex-1">عرض الموقع</span>}
          </a>
          <button
            type="button"
            onClick={() => setCollapsed((v) => !v)}
            className={cn(sidebarItem(false), collapsed && 'justify-center px-0')}
            aria-label={collapsed ? 'توسيع القائمة' : 'تصغير القائمة'}
            title={collapsed ? 'توسيع القائمة' : undefined}
          >
            {collapsed ? <PanelRightOpen /> : <PanelRightClose />}
            {!collapsed && <span className="flex-1 text-start">تصغير القائمة</span>}
          </button>
          <NavLink
            to="/account"
            className={({ isActive }) =>
              cn(
                'mt-1 flex items-center gap-3 rounded-xl p-2 transition-colors hover:bg-white/[0.05]',
                isActive && 'bg-white/[0.06]',
                collapsed && 'justify-center',
              )
            }
            title={collapsed ? 'الحساب' : undefined}
          >
            <span className="grid size-8 shrink-0 place-items-center rounded-full bg-linear-to-br from-accent to-[#b5793a] text-xs font-bold text-accent-ink">
              {initials(user?.name ?? 'S')}
            </span>
            {!collapsed && (
              <span className="min-w-0 flex-1 leading-tight">
                <span className="block truncate text-[0.8125rem] font-medium">{user?.name}</span>
                <span className="num block truncate text-[0.6875rem] text-muted">
                  {user?.email}
                </span>
              </span>
            )}
          </NavLink>
        </div>
      </aside>

      {/* ───── Mobile top bar ───── */}
      <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-line bg-bg/85 px-4 pt-(--safe-top) backdrop-blur-xl lg:hidden">
        <BrandMark className="size-8" />
        <span className="flex-1 text-sm font-bold">S5Y Studio</span>
        <a
          href={siteUrl('/')}
          target="_blank"
          rel="noopener"
          className="grid size-9 place-items-center rounded-xl text-muted hover:bg-white/5 hover:text-fg"
          aria-label="عرض الموقع"
        >
          <ExternalLink className="size-[1.125rem]" aria-hidden />
        </a>
        <NavLink
          to="/account"
          aria-label="الحساب"
          className="grid size-8 place-items-center rounded-full bg-linear-to-br from-accent to-[#b5793a] text-[0.6875rem] font-bold text-accent-ink"
        >
          {initials(user?.name ?? 'S')}
        </NavLink>
      </header>

      <main id="main" className="min-w-0 transition-[padding] duration-300 ease-(--ease-cine) lg:ps-(--sidebar-w)">
        <div className="pb-mobile-nav mx-auto w-full max-w-[90rem] px-4 pt-6 sm:px-6 lg:px-10 lg:pt-10">
          <Outlet />
        </div>
      </main>

      {/* ───── Mobile bottom nav ───── */}
      <nav
        className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface/90 pb-(--safe-bottom) backdrop-blur-xl lg:hidden"
        aria-label="القائمة الرئيسية"
      >
        <ul className="grid h-16 grid-cols-5">
          {mobileTabs.map((item) => (
            <li key={item.to}>
              <NavLink
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  cn(
                    'relative flex h-full flex-col items-center justify-center gap-1 text-[0.6875rem] font-medium transition-colors [&_svg]:size-[1.3rem]',
                    isActive ? 'text-accent' : 'text-muted active:text-fg',
                  )
                }
              >
                {({ isActive }) => (
                  <>
                    <span className="relative">
                      {item.icon}
                      {item.badge ? (
                        <span className="num absolute -end-2.5 -top-1.5 grid h-4 min-w-4 place-items-center rounded-full bg-rec px-1 text-[0.625rem] font-semibold leading-none text-white ring-2 ring-surface">
                          {item.badge > 99 ? '99+' : item.badge}
                        </span>
                      ) : null}
                    </span>
                    {item.label}
                    {isActive && <span className="absolute inset-x-5 top-0 h-0.5 rounded-b-full bg-accent" aria-hidden />}
                  </>
                )}
              </NavLink>
            </li>
          ))}
          <li>
            <button
              type="button"
              onClick={() => setMoreOpen(true)}
              aria-haspopup="dialog"
              className={cn(
                'relative flex h-full w-full flex-col items-center justify-center gap-1 text-[0.6875rem] font-medium [&_svg]:size-[1.3rem]',
                moreActive ? 'text-accent' : 'text-muted',
              )}
            >
              <MenuIcon aria-hidden />
              المزيد
              {moreActive && <span className="absolute inset-x-5 top-0 h-0.5 rounded-b-full bg-accent" aria-hidden />}
            </button>
          </li>
        </ul>
      </nav>

      <Dialog open={moreOpen} onClose={() => setMoreOpen(false)} title="المزيد" size="sm">
        <div className="flex flex-col gap-1 pb-1">
          {[
            { to: '/plans', label: 'الباقات', icon: <Crown /> },
            { to: '/settings', label: 'إعدادات الموقع', icon: <Settings /> },
            { to: '/account', label: 'الحساب وكلمة المرور', icon: <UserRound /> },
          ].map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                cn(
                  'flex h-13 items-center gap-3 rounded-xl px-3 text-[0.9375rem] [&_svg]:size-5',
                  isActive ? 'bg-accent/10 text-accent' : 'text-fg-2 active:bg-white/5',
                )
              }
            >
              {item.icon}
              {item.label}
            </NavLink>
          ))}
          <a href={siteUrl('/')} target="_blank" rel="noopener" className="flex h-13 items-center gap-3 rounded-xl px-3 text-[0.9375rem] text-fg-2 [&_svg]:size-5">
            <ExternalLink />
            عرض الموقع
          </a>
          <div className="my-1 h-px bg-line" />
          <button
            type="button"
            onClick={() => logout.mutate()}
            className="flex h-13 items-center gap-3 rounded-xl px-3 text-[0.9375rem] text-danger [&_svg]:size-5"
          >
            <LogOut />
            تسجيل الخروج
          </button>
        </div>
      </Dialog>

      <UploadTray />
    </div>
  );
}

const sidebarItem = (active: boolean) =>
  cn(
    'group relative flex h-10 items-center gap-3 rounded-xl px-3 text-sm font-medium transition-colors [&_svg]:size-[1.125rem] [&_svg]:shrink-0',
    active ? 'bg-white/[0.07] text-fg' : 'text-muted hover:bg-white/[0.04] hover:text-fg',
  );

function SidebarLink({ item, collapsed }: { item: NavItem; collapsed: boolean }) {
  return (
    <NavLink
      to={item.to}
      end={item.end}
      title={collapsed ? item.label : undefined}
      className={({ isActive }) => cn(sidebarItem(isActive), collapsed && 'justify-center px-0')}
    >
      {({ isActive }) => (
        <>
          {isActive && <span className="absolute inset-y-2 start-0 w-0.5 rounded-full bg-accent" aria-hidden />}
          <span className={cn('relative', isActive && 'text-accent')}>
            {item.icon}
            {collapsed && item.badge ? (
              <span className="absolute -end-1 -top-1 size-2 rounded-full bg-rec ring-2 ring-surface" aria-hidden />
            ) : null}
          </span>
          {!collapsed && <span className="flex-1 truncate">{item.label}</span>}
          {!collapsed && item.badge ? (
            <span className="num grid h-5 min-w-5 place-items-center rounded-full bg-accent/15 px-1.5 text-[0.6875rem] font-semibold text-accent">
              {item.badge}
            </span>
          ) : null}
        </>
      )}
    </NavLink>
  );
}
