import { useEffect, useRef, useState, type ImgHTMLAttributes } from 'react';

/** Image that fades in once decoded (no layout shift: size comes from the parent). */
export function FadeImage({ className = '', onLoad, ...rest }: ImgHTMLAttributes<HTMLImageElement>) {
  const [loaded, setLoaded] = useState(false);
  const ref = useRef<HTMLImageElement>(null);
  useEffect(() => {
    if (ref.current?.complete && ref.current.naturalWidth > 0) setLoaded(true);
  }, []);
  return (
    <img
      ref={ref}
      decoding="async"
      loading="lazy"
      {...rest}
      onLoad={(e) => {
        setLoaded(true);
        onLoad?.(e);
      }}
      className={`${className} transition-[opacity,transform,filter] duration-700 ease-[cubic-bezier(.16,1,.3,1)] ${loaded ? 'opacity-100' : 'opacity-0'}`}
    />
  );
}

interface PreviewProps {
  src: string | null | undefined;
  poster?: string | null;
  active: boolean;
  className?: string;
}

/** Muted looping preview that only loads/plays while `active` (hover / in view). */
export function PreviewVideo({ src, poster, active, className = '' }: PreviewProps) {
  const ref = useRef<HTMLVideoElement>(null);
  const [armed, setArmed] = useState(false);
  const [playing, setPlaying] = useState(false);
  useEffect(() => {
    if (active) setArmed(true);
  }, [active]);
  useEffect(() => {
    const v = ref.current;
    if (!v || !armed) return;
    if (active) {
      v.play().catch(() => undefined);
    } else {
      v.pause();
    }
  }, [active, armed]);
  if (!src || !armed) return null;
  return (
    <video
      ref={ref}
      src={src}
      poster={poster ?? undefined}
      muted
      loop
      playsInline
      preload="metadata"
      aria-hidden="true"
      tabIndex={-1}
      onPlaying={() => setPlaying(true)}
      onPause={() => setPlaying(false)}
      className={`${className} transition-opacity duration-500 ${playing && active ? 'opacity-100' : 'opacity-0'}`}
    />
  );
}
