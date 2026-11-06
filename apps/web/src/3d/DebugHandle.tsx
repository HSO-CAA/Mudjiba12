import { useEffect } from 'react';
import { useThree } from '@react-three/fiber';
import { QA_STILL } from './qa';
import { mediaStats } from './videoTextures';

type DebugWindow = Window & { __s5y3d?: Record<string, () => unknown> };

/**
 * Dev-only QA hooks for a scene, compiled out of production builds (render it behind `import.meta.env.DEV`):
 * - console handle `__s5y3d.hero()` / `.showreel()` / `.reel()` → renderer.info + live media counts (removed on
 *   unmount so it never keeps a renderer alive);
 * - `?still=1` stills: the on-demand frameloop redraws whenever the page scrolls, and now and then for late textures.
 */
export function DebugHandle({ name }: { name: string }) {
  const gl = useThree((s) => s.gl);
  const invalidate = useThree((s) => s.invalidate);
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
  useEffect(() => {
    if (!import.meta.env.DEV || !QA_STILL) return;
    const onScroll = () => invalidate();
    window.addEventListener('scroll', onScroll, { passive: true });
    const id = window.setInterval(onScroll, 1500);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.clearInterval(id);
    };
  }, [invalidate]);
  return null;
}
