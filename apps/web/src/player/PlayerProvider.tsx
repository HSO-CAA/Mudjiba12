import { createContext, lazy, Suspense, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { AnimatePresence } from 'motion/react';
import type { PublicVideo } from '@s5y/shared';

export interface PlayerPlaceRef {
  name: string;
  slug: string;
}

export interface PlayerSession {
  videos: PublicVideo[];
  index: number;
  /** Resolves the place a video belongs to (for the caption link). */
  places?: Record<string, PlayerPlaceRef>;
}

interface PlayerApi {
  open: (session: PlayerSession) => void;
  close: () => void;
  isOpen: boolean;
}

const PlayerContext = createContext<PlayerApi | null>(null);
const VideoPlayer = lazy(() => import('./VideoPlayer'));

export function PlayerProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<PlayerSession | null>(null);
  const open = useCallback((s: PlayerSession) => {
    if (!s.videos.length) return;
    setSession({ ...s, index: Math.max(0, Math.min(s.index, s.videos.length - 1)) });
  }, []);
  const close = useCallback(() => setSession(null), []);
  const api = useMemo(() => ({ open, close, isOpen: !!session }), [open, close, session]);

  return (
    <PlayerContext.Provider value={api}>
      {children}
      <Suspense fallback={null}>
        <AnimatePresence>{session && <VideoPlayer key="player" session={session} onClose={close} />}</AnimatePresence>
      </Suspense>
    </PlayerContext.Provider>
  );
}

export function usePlayer(): PlayerApi {
  const ctx = useContext(PlayerContext);
  if (!ctx) throw new Error('usePlayer must be used inside <PlayerProvider>');
  return ctx;
}
