import { useEffect } from 'react';
import { useThree } from '@react-three/fiber';
import { QA_STILL } from './qa';

/** QA stills (`?still=1`, dev only): render on demand whenever the page scrolls, and now and then for late textures. */
export function QaStillInvalidator() {
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => {
    if (!QA_STILL) return;
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
