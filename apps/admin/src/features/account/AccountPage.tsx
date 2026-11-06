import { useState, type FormEvent } from 'react';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Eye, EyeOff, KeyRound, LogOut, ShieldCheck } from 'lucide-react';
import { ApiError } from '../../lib/api';
import { cn } from '../../lib/cn';
import { api } from '../../lib/endpoints';
import { formatDateTime } from '../../lib/format';
import { Button } from '../../components/ui/button';
import { Field, Input } from '../../components/ui/form';
import { Badge, Card, CardHeader } from '../../components/ui/misc';
import { PageHeader } from '../../components/ui/page';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';
import { useLogout, useUser } from '../auth/session';

const MIN_LENGTH = 10;

function strength(password: string): { score: 0 | 1 | 2 | 3 | 4; label: string } {
  if (!password) return { score: 0, label: '' };
  let score = 0;
  if (password.length >= MIN_LENGTH) score += 1;
  if (password.length >= 14) score += 1;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score += 1;
  if (/\d/.test(password) && /[^A-Za-z0-9]/.test(password)) score += 1;
  const s = Math.min(4, score) as 0 | 1 | 2 | 3 | 4;
  return { score: s, label: ['ضعيفة جداً', 'ضعيفة', 'متوسطة', 'قوية', 'قوية جداً'][s] };
}

export default function AccountPage() {
  useDocumentTitle('الحساب');
  const user = useUser();
  const logout = useLogout();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirmValue, setConfirmValue] = useState('');
  const [show, setShow] = useState(false);
  const [localErrors, setLocalErrors] = useState<Record<string, string>>({});

  const change = useMutation({
    meta: { silent: true },
    mutationFn: () => api.auth.changePassword({ currentPassword: current, newPassword: next }),
    onSuccess: () => {
      toast.success('تم تغيير كلمة المرور', { description: 'وتم تسجيل الخروج من كل الأجهزة الثانية.' });
      setCurrent('');
      setNext('');
      setConfirmValue('');
    },
    onError: (error) => {
      if (!(error instanceof ApiError && error.code === 'VALIDATION_ERROR')) toast.error(error.message);
    },
  });

  const serverErrors = change.error instanceof ApiError ? change.error.fieldErrors : {};
  const errors = { ...serverErrors, ...localErrors };
  const s = strength(next);

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    const local: Record<string, string> = {};
    if (!current) local.currentPassword = 'اكتب كلمة المرور الحالية';
    if (next.length < MIN_LENGTH) local.newPassword = `كلمة المرور الجديدة لازم تكون ${MIN_LENGTH} أحرف على الأقل`;
    else if (next === current) local.newPassword = 'كلمة المرور الجديدة لازم تختلف عن الحالية';
    if (confirmValue !== next) local.confirm = 'التأكيد ما يطابق كلمة المرور الجديدة';
    setLocalErrors(local);
    if (Object.keys(local).length) return;
    change.mutate();
  };

  const type = show ? 'text' : 'password';

  return (
    <div className="max-w-3xl">
      <PageHeader title="الحساب" description="معلومات حسابك وكلمة المرور." />

      <div className="flex flex-col gap-5">
        <Card className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:p-6">
          <span className="grid size-14 shrink-0 place-items-center rounded-full bg-linear-to-br from-accent to-[#b5793a] text-lg font-bold text-accent-ink">
            {(user?.name ?? 'S').trim().charAt(0).toUpperCase()}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-semibold">{user?.name}</h2>
              <Badge tone="accent" icon={<ShieldCheck />}>
                {user?.role === 'OWNER' ? 'المالك' : 'محرر'}
              </Badge>
            </div>
            <p className="num mt-0.5 truncate text-sm text-muted">
              {user?.email}
            </p>
            {user?.lastLoginAt && <p className="mt-1 text-xs text-subtle">آخر دخول: {formatDateTime(user.lastLoginAt)}</p>}
          </div>
          <Button variant="secondary" icon={<LogOut />} onClick={() => logout.mutate()} loading={logout.isPending}>
            تسجيل الخروج
          </Button>
        </Card>

        <Card>
          <CardHeader title="تغيير كلمة المرور" description="بعد التغيير، كل الأجهزة الثانية تطلع من الحساب تلقائياً." />
          <form onSubmit={onSubmit} className="flex flex-col gap-4 p-5 sm:p-6" noValidate>
            <input type="text" name="username" autoComplete="username" value={user?.email ?? ''} readOnly hidden />
            <Field label="كلمة المرور الحالية" error={errors.currentPassword}>
              <Input type={type} value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" ltr start={<KeyRound />} />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="كلمة المرور الجديدة" error={errors.newPassword} hint={`${MIN_LENGTH} أحرف على الأقل. استخدم جملة طويلة تتذكرها.`}>
                <Input type={type} value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" ltr />
              </Field>
              <Field label="تأكيد كلمة المرور" error={errors.confirm}>
                <Input type={type} value={confirmValue} onChange={(e) => setConfirmValue(e.target.value)} autoComplete="new-password" ltr />
              </Field>
            </div>
            {next && (
              <div className="flex items-center gap-3" aria-live="polite">
                <div className="grid flex-1 grid-cols-4 gap-1">
                  {[1, 2, 3, 4].map((i) => (
                    <span
                      key={i}
                      className={cn(
                        'h-1 rounded-full',
                        i <= s.score ? (s.score <= 1 ? 'bg-danger' : s.score === 2 ? 'bg-warning' : 'bg-success') : 'bg-white/10',
                      )}
                    />
                  ))}
                </div>
                <span className="text-xs text-muted">{s.label}</span>
              </div>
            )}
            <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
              <button type="button" onClick={() => setShow((v) => !v)} className="inline-flex items-center gap-1.5 text-xs text-muted hover:text-fg">
                {show ? <EyeOff className="size-3.5" aria-hidden /> : <Eye className="size-3.5" aria-hidden />}
                {show ? 'إخفاء كلمات المرور' : 'إظهار كلمات المرور'}
              </button>
              <Button type="submit" variant="primary" loading={change.isPending}>
                تغيير كلمة المرور
              </Button>
            </div>
          </form>
        </Card>
      </div>
    </div>
  );
}
