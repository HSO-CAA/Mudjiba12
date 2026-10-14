import { useEffect } from 'react';
import { useThree } from '@react-three/fiber';
import { mediaStats } from './videoTextures';

type DebugWindow = Window & { __s5y3d?: Record<string, () => unknown> };

/**
 * Dev-only console handle for QA: `__s5y3d.hero()` / `__s5y3d.reel()` → renderer.info + live media counts.
 * Removed on unmount so it never keeps a renderer alive; compiled out of production builds.
 */
export function DebugHandle({ name }: { name: string }) {
  const gl = useThree((s) => s.gl);
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const w = window as DebugWindow;
    const registry = (w.__s5y3d ??= {});
    registry[name] = () => ({ memory: { ...gl.info.memory }, render: { ...gl.info.render }, programs: gl.info.programs?.length ?? 0, media: mediaStats() });
    registry.media = mediaStats;
    return () => {
      delete registry[name];
    };
  }, [gl, name]);
  return null;
}
