/**
 * Dev-only QA switch: `?still=1` renders the scroll-driven scenes on demand with damping snapped to the
 * scroll position, so a headless (software-GL) browser can shoot deterministic frame sequences quickly.
 * `import.meta.env.DEV` is a compile-time false in production builds, so this folds to `false` there.
 */
export const QA_STILL: boolean =
  import.meta.env.DEV && typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('still') === '1';
