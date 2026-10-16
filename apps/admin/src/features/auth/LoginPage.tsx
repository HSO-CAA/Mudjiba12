import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Navigate, useLocation, useNavigate, useSearchParams } from 'react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Eye, EyeOff, LockKeyhole, Mail, ShieldAlert, Timer, WifiOff } from 'lucide-react';
import type { AdminUser } from '@s5y/shared';
import { ApiError } from '../../lib/api';
import { api } from '../../lib/endpoints';
import { formatMinutes } from '../../lib/format';
import { qk } from '../../lib/query';
import { Button } from '../../components/ui/button';
import { Field, Input } from '../../components/ui/form';
import { Callout } from '../../components/ui/misc';
import { BrandMark } from '../../components/layout/BrandMark';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';
import { safeNext } from './session';

function describeError(error: ApiError): { title: string; body: string; icon: ReactNode } {
  const wait = error.retryAfterSec;
  const minutes = wait ? Math.max(1, Math.ceil(wait / 60)) : null;
  if (error.code === 'ACCOUNT_LOCKED' || error.status === 423) {
    return {
      title: 'الحساب مقفول مؤقتاً',
      body: minutes
        ? `صارت محاولات دخول خاطئة كثيرة، فقفلنا الحساب للحماية. حاول مرة ثانية بعد ${formatMinutes(minutes)}.`
        : error.message,
      icon: <LockKeyhole />,
    };
  }
  if (error.code === 'RATE_LIMITED' || error.status === 429) {
    return {
      title: 'محاولات كثيرة',
      body: minutes ? `حاولت تسجّل دخول هواية مرات خلال وقت قصير. انتظر ${formatMinutes(minutes)} وحاول مرة ثانية.` : error.message,
      icon: <Timer />,
    };
  }
  if (error.isNetwork) return { title: 'ماكو اتصال', body: error.message, icon: <WifiOff /> };
  return { title: 'تعذّر تسجيل الدخول', body: error.message, icon: <ShieldAlert /> };
}

function Timecode() {
  const [frames, setFrames] = useState(0);
  useEffect(() => {
    const started = performance.now();
    const timer = window.setInterval(() => setFrames(Math.floor(((performance.now() - started) / 1000) * 24)), 1000 / 24);
    return () => window.clearInterval(timer);
  }, []);
  const p = (n: number) => String(n).padStart(2, '0');
  const s = Math.floor(frames / 24);
  return (
    <span className="num tabular" dir="ltr">
      {p(Math.floor(s / 3600))}:{p(Math.floor(s / 60) % 60)}:{p(s % 60)}:{p(frames % 24)}
    </span>
  );
}

export default function LoginPage() {
  useDocumentTitle('تسجيل الدخول');
  const [params] = useSearchParams();
  const next = safeNext(params.get('next'));
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const location = useLocation();
  const loggedOut = (location.state as { loggedOut?: boolean } | null)?.loggedOut === true;
  useEffect(() => {
    if (loggedOut) queryClient.clear();
  }, [loggedOut, queryClient]);
  // Already signed in (cached session) → skip the form. No probe here: an anonymous visit would just log a 401.
  const cachedUser = loggedOut ? undefined : queryClient.getQueryData<{ user: AdminUser }>(qk.me)?.user;
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const login = useMutation({
    mutationFn: () => api.auth.login({ email: email.trim(), password }),
    meta: { silent: true },
    onSuccess: (data) => {
      queryClient.setQueryData(qk.me, data);
      navigate(next, { replace: true });
    },
  });

  if (cachedUser && !login.isPending && !login.isSuccess) return <Navigate to={next} replace />;

  const error = login.error instanceof ApiError ? login.error : null;
  const fieldErrors = error?.code === 'VALIDATION_ERROR' ? error.fieldErrors : {};
  const banner = error && error.code !== 'VALIDATION_ERROR' ? describeError(error) : null;

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!email.trim() || !password) return;
    login.mutate();
  };

  return (
    <div className="grid min-h-dvh lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <main className="flex flex-col justify-center px-5 py-12 sm:px-12">
        <div className="mx-auto w-full max-w-sm">
          <div className="mb-10 flex items-center gap-3">
            <BrandMark className="size-11" />
            <div>
              <p className="text-base font-bold leading-tight">S5Y Studio</p>
              <p className="text-[0.8125rem] text-muted">لوحة التحكم الخاصة</p>
            </div>
          </div>

          <h1 className="text-[1.625rem] font-bold leading-tight">هلا بيك من جديد</h1>
          <p className="mt-2 text-sm leading-relaxed text-muted">سجّل دخول حتى تدير الأماكن والفيديوهات والرسائل.</p>

          <form onSubmit={onSubmit} className="mt-8 flex flex-col gap-4" noValidate>
            {banner && (
              <Callout tone={error?.status === 423 || error?.status === 429 ? 'warning' : 'danger'} icon={banner.icon} title={banner.title}>
                {banner.body}
              </Callout>
            )}
            <Field label="البريد الإلكتروني" error={fieldErrors.email}>
              <Input
                type="email"
                name="email"
                autoComplete="username"
                inputMode="email"
                ltr
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                start={<Mail />}
                placeholder="you@example.com"
                required
                autoFocus
              />
            </Field>
            <Field label="كلمة المرور" error={fieldErrors.password}>
              <Input
                type={showPassword ? 'text' : 'password'}
                name="password"
                autoComplete="current-password"
                ltr
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                start={<LockKeyhole />}
                required
                end={
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    className="grid size-9 place-items-center rounded-lg text-muted hover:text-fg"
                    aria-label={showPassword ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور'}
                  >
                    {showPassword ? <EyeOff className="size-4" aria-hidden /> : <Eye className="size-4" aria-hidden />}
                  </button>
                }
              />
            </Field>
            <Button
              type="submit"
              variant="primary"
              size="lg"
              className="mt-2 w-full"
              loading={login.isPending}
              disabled={!email.trim() || !password}
            >
              دخول
              {!login.isPending && <ArrowLeft aria-hidden />}
            </Button>
          </form>

          <p className="mt-8 text-xs leading-relaxed text-subtle">
            هذه الصفحة خاصة وغير مرتبطة بالموقع العام. إذا نسيت كلمة المرور، غيّرها من الخادم بأمر
            <code className="num mx-1 block break-all rounded bg-surface-3 px-1.5 py-0.5 text-[0.6875rem] text-fg-2" dir="ltr">
              docker compose exec app node dist/scripts/create-admin.js --email … --password …
            </code>
          </p>
        </div>
      </main>

      <aside className="relative hidden overflow-hidden border-s border-line bg-surface lg:block" aria-hidden>
        <div className="absolute inset-0 bg-[radial-gradient(70%_60%_at_30%_40%,rgb(233_179_95/0.16),transparent_70%),radial-gradient(50%_50%_at_80%_90%,rgb(57_135_229/0.08),transparent_70%)]" />
        <div className="absolute inset-0 opacity-[0.07] [background-image:linear-gradient(rgb(255_255_255/0.6)_1px,transparent_1px),linear-gradient(90deg,rgb(255_255_255/0.6)_1px,transparent_1px)] [background-size:calc(100%/3)_calc(100%/3)]" />
        <div className="absolute inset-10">
          {['top-0 start-0 border-t border-s rounded-ss-lg', 'top-0 end-0 border-t border-e rounded-se-lg', 'bottom-0 start-0 border-b border-s rounded-es-lg', 'bottom-0 end-0 border-b border-e rounded-ee-lg'].map((c) => (
            <span key={c} className={`absolute size-8 border-fg/40 ${c}`} />
          ))}
        </div>
        <div className="hud absolute start-14 top-14 flex items-center gap-2 text-fg-2" dir="ltr">
          <span className="size-2 animate-rec rounded-full bg-rec" />
          REC <Timecode />
        </div>
        <div className="hud absolute end-14 top-14 text-muted" dir="ltr">
          4K · 24FPS · ISO 800 · ƒ/1.8
        </div>
        <div className="absolute inset-0 grid place-items-center">
          <div className="relative grid size-72 place-items-center rounded-full border border-white/10 bg-[radial-gradient(circle_at_35%_30%,#2a2a31,#0b0b0d_65%)] shadow-[0_40px_120px_-20px_rgb(0_0_0/0.9),inset_0_0_0_10px_#121216,inset_0_0_0_11px_rgb(255_255_255/0.06)]">
            <div className="grid size-48 place-items-center rounded-full border border-white/10 bg-[radial-gradient(circle_at_40%_35%,rgb(233_179_95/0.25),#060607_60%)] shadow-[inset_0_0_40px_rgb(0_0_0/0.9)]">
              <div className="size-20 rounded-full bg-[radial-gradient(circle_at_40%_35%,rgb(140_120_255/0.35),rgb(233_179_95/0.15)_40%,#020203_70%)] ring-1 ring-white/10" />
            </div>
            <span className="absolute inset-3 rounded-full border border-dashed border-accent/25" />
          </div>
        </div>
        <div className="absolute inset-x-14 bottom-14 flex items-end justify-between">
          <div>
            <p className="text-3xl font-bold leading-tight text-fg">كل مكان عنده قصة.</p>
            <p className="mt-1 text-sm text-muted">رتّب شغلك، وخلّي الموقع يحچي عنك.</p>
          </div>
          <span className="hud text-muted" dir="ltr">
            S5Y · 35MM
          </span>
        </div>
      </aside>
    </div>
  );
}
