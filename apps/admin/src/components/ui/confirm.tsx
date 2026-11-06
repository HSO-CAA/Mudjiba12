import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { TriangleAlert } from 'lucide-react';
import { Button } from './button';
import { Dialog } from './dialog';

export interface ConfirmOptions {
  title: string;
  description?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'danger' | 'default';
}

type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn | null>(null);

interface Pending extends ConfirmOptions {
  resolve: (value: boolean) => void;
}

/** `const ok = await confirm({...})` — one confirm at a time; a new request cancels the previous one. */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<Pending | null>(null);
  const pendingRef = useRef<Pending | null>(null);

  const confirm = useCallback<ConfirmFn>((options) => {
    return new Promise<boolean>((resolve) => {
      pendingRef.current?.resolve(false);
      const next: Pending = { ...options, resolve };
      pendingRef.current = next;
      setPending(next);
    });
  }, []);

  const settle = useCallback((value: boolean) => {
    pendingRef.current?.resolve(value);
    pendingRef.current = null;
    setPending(null);
  }, []);

  const danger = pending?.tone !== 'default';

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <Dialog
        open={pending !== null}
        onClose={() => settle(false)}
        size="sm"
        title={
          <span className="flex items-center gap-2.5">
            {danger && (
              <span className="grid size-8 place-items-center rounded-full bg-danger/12 text-danger">
                <TriangleAlert className="size-4" aria-hidden />
              </span>
            )}
            {pending?.title}
          </span>
        }
        description={pending?.description}
        footer={
          <>
            <Button variant="ghost" onClick={() => settle(false)} data-autofocus={danger || undefined}>
              {pending?.cancelLabel ?? 'إلغاء'}
            </Button>
            <Button variant={danger ? 'danger' : 'primary'} onClick={() => settle(true)} data-autofocus={!danger || undefined}>
              {pending?.confirmLabel ?? 'تأكيد'}
            </Button>
          </>
        }
      />
    </ConfirmContext.Provider>
  );
}

export function useConfirm(): ConfirmFn {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error('useConfirm must be used inside <ConfirmProvider>');
  return useMemo(() => ctx, [ctx]);
}
