import { useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { useSmoothScroll } from './SmoothScroll';

export type SectionId = 'work' | 'showreel' | 'about' | 'plans' | 'contact' | 'top';

/** Scrolls to a home section, navigating home first when needed. */
export function useSectionNav() {
  const location = useLocation();
  const navigate = useNavigate();
  const { scrollTo } = useSmoothScroll();
  return useCallback(
    (id: SectionId) => {
      if (location.pathname === '/') {
        if (id === 'top') scrollTo(0);
        else scrollTo(`#${id}`);
        return;
      }
      navigate(id === 'top' ? '/' : `/#${id}`, { state: { scrollTo: id } });
    },
    [location.pathname, navigate, scrollTo],
  );
}
