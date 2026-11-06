import { useEffect, useRef } from 'react';
import { useBlocker } from 'react-router';
import { useConfirm } from '../components/ui/confirm';

/** Warns before leaving a page with unsaved changes (in-app navigation and tab close). */
export function useUnsavedGuard(dirty: boolean): void {
  const confirm = useConfirm();
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) => dirty && currentLocation.pathname !== nextLocation.pathname,
  );
  const blockerRef = useRef(blocker);
  blockerRef.current = blocker;

  useEffect(() => {
    if (blocker.state !== 'blocked') return;
    let settled = false;
    void confirm({
      title: 'عندك تغييرات غير محفوظة',
      description: 'إذا طلعت هسة راح تضيع التغييرات اللي سويتها.',
      confirmLabel: 'اطلع بدون حفظ',
      cancelLabel: 'ابقَ بالصفحة',
      tone: 'danger',
    }).then((leave) => {
      if (settled) return;
      settled = true;
      const current = blockerRef.current;
      if (current.state !== 'blocked') return;
      if (leave) current.proceed();
      else current.reset();
    });
    return () => {
      settled = true;
    };
  }, [blocker.state, confirm]);

  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);
}
