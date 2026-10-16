import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

interface ContactIntentApi {
  /** Plan pre-selected from a pricing card CTA. */
  planId: string | null;
  setPlanId: (id: string | null) => void;
}

const Ctx = createContext<ContactIntentApi | null>(null);

export function ContactIntentProvider({ children }: { children: ReactNode }) {
  const [planId, setPlan] = useState<string | null>(null);
  const setPlanId = useCallback((id: string | null) => setPlan(id), []);
  const value = useMemo(() => ({ planId, setPlanId }), [planId, setPlanId]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useContactIntent(): ContactIntentApi {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useContactIntent must be used inside <ContactIntentProvider>');
  return ctx;
}
