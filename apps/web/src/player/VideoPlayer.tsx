import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type TouchEvent as ReactTouchEvent,
} from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { Link } from 'react-router';
import type { PublicVideo } from '@s5y/shared';
import { trackPlay } from '../lib/analytics';
import { formatDuration, pad2 } from '../lib/format';
import { useSmoothScroll } from '../app/SmoothScroll';
import {
  ChevronDownIcon,
  ChevronUpIcon,
  CloseIcon,
  ExpandIcon,
  MuteIcon,
  PauseIcon,
  PlayIcon,
  ShrinkIcon,
  VolumeIcon,
} from '../components/Icons';
import type { PlayerSession } from './PlayerProvider';

interface Props {
  session: PlayerSession;
  onClose: () => void;
}

let preferMuted = false;

function aspectOf(v: PublicVideo): number {
  if (v.aspect && v.aspect > 0) return v.aspect;
  if (v.width && v.height) return v.width / v.height;
  return 9 / 16;
}

type FullscreenVideo = HTMLVideoElement & { webkitEnterFullscreen?: () => void };

/** Custom modal player: poster first, full-quality `url`, scrubber with buffered ranges, keyboard + swipe. */
export default function VideoPlayer({ session, onClose }: Props) {
  const { videos, places } = session;
  const [index, setIndex] = useState(session.index);
  const [direction, setDirection] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [waiting, setWaiting] = useState(true);
  const [muted, setMuted] = useState(preferMuted);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [buffered, setBuffered] = useState<[number, number][]>([]);
  const [chrome, setChrome] = useState(true);
  const [ended, setEnded] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [scrubbing, setScrubbing] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const [videoEl, setVideoEl] = useState<HTMLVideoElement | null>(null);
  // Outgoing clips keep animating for a moment: only clear a ref if it still points at the detached element.
  const attachVideo = useCallback((el: HTMLVideoElement | null) => {
    if (!el) return;
    videoRef.current = el;
    setVideoEl(el);
    return () => {
      if (videoRef.current === el) videoRef.current = null;
    };
  }, []);
  const attachStage = useCallback((el: HTMLDivElement | null) => {
    if (!el) return;
    stageRef.current = el;
    return () => {
      if (stageRef.current === el) stageRef.current = null;
    };
  }, []);
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const hideTimer = useRef<number | undefined>(undefined);
  const touch = useRef<{ x: number; y: number; t: number } | null>(null);
  const reduced = useReducedMotion();
  const { lock, unlock } = useSmoothScroll();

  const video = videos[index] as PublicVideo;
  const place = places?.[video.placeId];
  const aspect = aspectOf(video);
  const vertical = aspect < 1;

  // lock page scroll, restore focus on close
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    lock();
    closeRef.current?.focus({ preventScroll: true });
    return () => {
      unlock();
      previous?.focus?.({ preventScroll: true });
    };
  }, [lock, unlock]);

  const go = useCallback(
    (delta: number) => {
      const next = index + delta;
      if (next < 0 || next >= videos.length) return;
      setDirection(delta);
      setIndex(next);
    },
    [index, videos.length],
  );

  // reset per video
  useEffect(() => {
    setTime(0);
    setDuration(video.durationSec ?? 0);
    setBuffered([]);
    setEnded(false);
    setWaiting(true);
    setChrome(true);
  }, [video.id, video.durationSec]);

  // preload neighbours' posters
  useEffect(() => {
    [videos[index + 1], videos[index - 1]].forEach((v) => {
      if (v?.posterUrl) {
        const img = new Image();
        img.src = v.posterUrl;
      }
    });
  }, [index, videos]);

  const bumpChrome = useCallback(() => {
    setChrome(true);
    window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => {
      if (videoRef.current && !videoRef.current.paused) setChrome(false);
    }, 2600);
  }, []);
  useEffect(() => () => window.clearTimeout(hideTimer.current), []);

  const togglePlay = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused || v.ended) {
      if (v.ended) v.currentTime = 0;
      v.play().catch(() => setPlaying(false));
    } else v.pause();
    bumpChrome();
  }, [bumpChrome]);

  const seekBy = useCallback(
    (sec: number) => {
      const v = videoRef.current;
      if (!v || !Number.isFinite(v.duration)) return;
      v.currentTime = Math.max(0, Math.min(v.duration, v.currentTime + sec));
      bumpChrome();
    },
    [bumpChrome],
  );

  const toggleMute = useCallback(() => {
    setMuted((m) => {
      preferMuted = !m;
      return !m;
    });
    bumpChrome();
  }, [bumpChrome]);

  const toggleFullscreen = useCallback(() => {
    const stage = stageRef.current;
    const v = videoRef.current as FullscreenVideo | null;
    if (document.fullscreenElement) {
      void document.exitFullscreen();
      return;
    }
    if (stage?.requestFullscreen) stage.requestFullscreen().catch(() => undefined);
    else v?.webkitEnterFullscreen?.();
  }, []);

  useEffect(() => {
    const onChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  const handleClose = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen();
    onClose();
  }, [onClose]);

  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    const onControl = target.closest('button, a, [role="slider"]');
    switch (e.key) {
      case 'Escape':
        e.preventDefault();
        handleClose();
        return;
      case ' ':
      case 'k':
        if (onControl && e.key === ' ' && target.tagName !== 'DIV') return;
        e.preventDefault();
        togglePlay();
        return;
      case 'ArrowRight':
        if (target.getAttribute('role') === 'slider') return;
        e.preventDefault();
        seekBy(5);
        return;
      case 'ArrowLeft':
        if (target.getAttribute('role') === 'slider') return;
        e.preventDefault();
        seekBy(-5);
        return;
      case 'ArrowDown':
        e.preventDefault();
        go(1);
        return;
      case 'ArrowUp':
        e.preventDefault();
        go(-1);
        return;
      case 'm':
      case 'M':
        toggleMute();
        return;
      case 'f':
      case 'F':
        toggleFullscreen();
        return;
      case 'Tab': {
        // focus trap
        const focusables = dialogRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], [tabindex="0"]');
        if (!focusables || !focusables.length) return;
        const first = focusables[0] as HTMLElement;
        const last = focusables[focusables.length - 1] as HTMLElement;
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
        return;
      }
      default:
        bumpChrome();
    }
  };

  // swipe: up → next, down → previous (reels-style)
  const onTouchStart = (e: ReactTouchEvent) => {
    const t = e.touches[0];
    if (t) touch.current = { x: t.clientX, y: t.clientY, t: performance.now() };
  };
  const onTouchEnd = (e: ReactTouchEvent) => {
    const start = touch.current;
    const t = e.changedTouches[0];
    touch.current = null;
    if (!start || !t) return;
    const dx = t.clientX - start.x;
    const dy = t.clientY - start.y;
    const fast = performance.now() - start.t < 600;
    if (Math.abs(dy) > 60 && Math.abs(dy) > Math.abs(dx) * 1.3 && fast) {
      if (dy < 0) go(1);
      else if (index === 0 && dy > 140) handleClose();
      else go(-1);
    }
  };

  // scrubber
  const barRef = useRef<HTMLDivElement>(null);
  const seekToClientX = (clientX: number) => {
    const bar = barRef.current;
    const v = videoRef.current;
    if (!bar || !v || !Number.isFinite(v.duration)) return;
    const rect = bar.getBoundingClientRect();
    const f = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    v.currentTime = f * v.duration;
    setTime(v.currentTime);
  };
  const onBarDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    setScrubbing(true);
    seekToClientX(e.clientX);
    bumpChrome();
  };
  const onBarMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (scrubbing) seekToClientX(e.clientX);
  };
  const onBarUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    setScrubbing(false);
  };
  const onBarKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
      e.preventDefault();
      e.stopPropagation();
      seekBy(2);
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
      e.preventDefault();
      e.stopPropagation();
      seekBy(-2);
    } else if (e.key === 'Home') {
      e.preventDefault();
      seekBy(-1e6);
    } else if (e.key === 'End') {
      e.preventDefault();
      seekBy(1e6);
    }
  };

  /**
   * Native listeners bound to the *current* element only: a clip that is still animating out can never
   * touch this clip's state, and events fired before React attached (fast autoplay) are synced on bind.
   */
  const latest = useRef({ id: video.id, index, total: videos.length, go, bumpChrome });
  latest.current = { id: video.id, index, total: videos.length, go, bumpChrome };
  useEffect(() => {
    const v = videoEl;
    if (!v) return;
    const syncBuffered = () => {
      if (!Number.isFinite(v.duration) || v.duration <= 0) return;
      const ranges: [number, number][] = [];
      for (let i = 0; i < v.buffered.length; i++) ranges.push([v.buffered.start(i) / v.duration, v.buffered.end(i) / v.duration]);
      setBuffered(ranges);
    };
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onPlaying = () => {
      setPlaying(true);
      setWaiting(false);
      setEnded(false);
      trackPlay(latest.current.id);
      latest.current.bumpChrome();
    };
    const onWaiting = () => setWaiting(true);
    const onCanPlay = () => setWaiting(false);
    const onMeta = () => Number.isFinite(v.duration) && setDuration(v.duration);
    const onTime = () => setTime(v.currentTime);
    const onEnded = () => {
      setEnded(true);
      setPlaying(false);
      setChrome(true);
      const { index: i, total, go: next } = latest.current;
      if (i < total - 1) window.setTimeout(() => next(1), 450);
    };
    const onError = () => setWaiting(false);
    const events: [string, () => void][] = [
      ['play', onPlay],
      ['pause', onPause],
      ['playing', onPlaying],
      ['waiting', onWaiting],
      ['canplay', onCanPlay],
      ['loadedmetadata', onMeta],
      ['durationchange', onMeta],
      ['timeupdate', onTime],
      ['progress', syncBuffered],
      ['ended', onEnded],
      ['error', onError],
    ];
    events.forEach(([type, fn]) => v.addEventListener(type, fn));
    // catch up with anything that happened before binding
    onMeta();
    syncBuffered();
    if (v.readyState >= 3) setWaiting(false);
    if (!v.paused && !v.ended) onPlaying();
    return () => events.forEach(([type, fn]) => v.removeEventListener(type, fn));
  }, [videoEl]);

  const progress = duration > 0 ? Math.min(1, time / duration) : 0;
  const counter = `${pad2(index + 1)} / ${pad2(videos.length)}`;
  const title = video.title || place?.name || 'فيديو';

  const stageStyle = vertical
    ? { aspectRatio: `${aspect}`, height: 'min(calc(100svh - 7.5rem), calc((100vw - 2rem) / ' + aspect + '))' }
    : { aspectRatio: `${aspect}`, width: 'min(calc(100vw - 2rem), 1280px, calc((100svh - 9rem) * ' + aspect + '))' };

  return createPortal(
    <motion.div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label={`مشغل الفيديو: ${title}`}
      className="fixed inset-0 z-[90] flex flex-col"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: reduced ? 0.1 : 0.35, ease: [0.16, 1, 0.3, 1] }}
      onKeyDown={onKeyDown}
      onPointerMove={bumpChrome}
      data-lenis-prevent
    >
      {/* backdrop */}
      <div className="absolute inset-0 bg-bg/92 backdrop-blur-xl" onClick={handleClose} aria-hidden="true" />
      {video.posterUrl && (
        <img
          key={`bg-${video.id}`}
          src={video.posterUrl}
          alt=""
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 h-full w-full scale-125 object-cover opacity-[0.18] blur-3xl"
        />
      )}

      {/* top bar */}
      <div className="relative z-10 flex items-center justify-between gap-4 px-4 pt-4 sm:px-6 sm:pt-5">
        <div className="min-w-0">
          <p className="hud text-soft">
            <span className="text-accent">REEL</span> {counter}
          </p>
          <h2 className="mt-1.5 truncate pb-1 font-display text-[1.25rem] leading-[1.35] sm:text-[1.4rem]">{title}</h2>
          {place && (
            <Link to={`/work/${place.slug}`} onClick={handleClose} className="inline-block font-display text-base leading-snug text-soft transition hover:text-accent">
              {place.name}
            </Link>
          )}
        </div>
        <button
          ref={closeRef}
          type="button"
          onClick={handleClose}
          className="grid size-11 shrink-0 place-items-center rounded-full border border-line-strong bg-surface/70 text-text transition hover:border-accent hover:text-accent"
          aria-label="إغلاق المشغل"
        >
          <CloseIcon size={20} />
        </button>
      </div>

      {/* stage */}
      <div className="relative z-10 flex min-h-0 flex-1 items-center justify-center px-4 pb-4 sm:px-20">
        <AnimatePresence mode="popLayout" initial={false} custom={direction}>
          <motion.div
            key={video.id}
            ref={attachStage}
            custom={direction}
            initial={reduced ? { opacity: 0 } : { opacity: 0, y: direction >= 0 ? 60 : -60, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={reduced ? { opacity: 0 } : { opacity: 0, y: direction >= 0 ? -60 : 60, scale: 0.97 }}
            transition={{ duration: reduced ? 0.1 : 0.5, ease: [0.16, 1, 0.3, 1] }}
            className="group relative max-h-full max-w-full overflow-hidden rounded-[1.4rem] bg-black shadow-[0_40px_120px_-30px_rgba(0,0,0,0.9)] ring-1 ring-white/10 [&:fullscreen]:rounded-none"
            style={stageStyle}
            onTouchStart={onTouchStart}
            onTouchEnd={onTouchEnd}
          >
            <video
              ref={attachVideo}
              key={video.url}
              src={video.url}
              poster={video.posterUrl ?? undefined}
              className="h-full w-full bg-black object-contain"
              playsInline
              autoPlay
              muted={muted}
              preload="auto"
              onClick={togglePlay}
            />

            {/* loading aperture */}
            {waiting && !ended && (
              <div className="pointer-events-none absolute inset-0 grid place-items-center">
                <span className="block size-12 animate-spin rounded-full border-2 border-white/15 border-t-accent" />
              </div>
            )}

            {/* big play */}
            <AnimatePresence>
              {!playing && !waiting && (
                <motion.button
                  type="button"
                  initial={{ opacity: 0, scale: 0.85 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.85 }}
                  onClick={togglePlay}
                  className="absolute left-1/2 top-1/2 grid size-20 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-accent text-[var(--accent-ink)] shadow-[0_0_60px_-10px_var(--accent)]"
                  aria-label={ended ? 'إعادة التشغيل' : 'تشغيل'}
                >
                  <PlayIcon size={30} />
                </motion.button>
              )}
            </AnimatePresence>

            {/* controls */}
            <div
              className={`absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/55 to-transparent px-3 pb-3 pt-14 transition-opacity duration-300 sm:px-4 ${
                chrome || !playing ? 'opacity-100' : 'pointer-events-none opacity-0'
              }`}
            >
              <div
                ref={barRef}
                dir="ltr"
                role="slider"
                tabIndex={0}
                aria-label="شريط التقدم"
                aria-valuemin={0}
                aria-valuemax={Math.round(duration)}
                aria-valuenow={Math.round(time)}
                aria-valuetext={`${formatDuration(time)} من ${formatDuration(duration)}`}
                className="group/bar relative flex h-5 cursor-pointer touch-none items-center"
                onPointerDown={onBarDown}
                onPointerMove={onBarMove}
                onPointerUp={onBarUp}
                onPointerCancel={onBarUp}
                onKeyDown={onBarKey}
              >
                <div className="relative h-[3px] w-full overflow-hidden rounded-full bg-white/15 transition-[height] group-hover/bar:h-[5px]">
                  {buffered.map(([s, e], i) => (
                    <div key={i} className="absolute inset-y-0 bg-white/25" style={{ left: `${s * 100}%`, width: `${(e - s) * 100}%` }} />
                  ))}
                  <div className="absolute inset-y-0 left-0 bg-accent" style={{ width: `${progress * 100}%` }} />
                </div>
                <div
                  className="absolute top-1/2 size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-text shadow transition-transform group-hover/bar:scale-110"
                  style={{ left: `${progress * 100}%` }}
                />
              </div>
              <div className="mt-1.5 flex items-center gap-1" dir="ltr">
                <CtrlButton label={playing ? 'إيقاف مؤقت' : 'تشغيل'} onClick={togglePlay}>
                  {playing ? <PauseIcon size={18} /> : <PlayIcon size={18} />}
                </CtrlButton>
                <CtrlButton label={muted ? 'تشغيل الصوت' : 'كتم الصوت'} onClick={toggleMute}>
                  {muted ? <MuteIcon size={19} /> : <VolumeIcon size={19} />}
                </CtrlButton>
                <span className="hud ms-1 text-text">
                  {formatDuration(time)} <span className="text-soft">/ {formatDuration(duration)}</span>
                </span>
                <span className="flex-1" />
                <CtrlButton label={isFullscreen ? 'الخروج من ملء الشاشة' : 'ملء الشاشة'} onClick={toggleFullscreen}>
                  {isFullscreen ? <ShrinkIcon size={18} /> : <ExpandIcon size={18} />}
                </CtrlButton>
              </div>
            </div>
          </motion.div>
        </AnimatePresence>

        {/* next / previous */}
        {videos.length > 1 && (
          <div className="absolute end-3 top-1/2 hidden -translate-y-1/2 flex-col gap-3 sm:flex">
            <NavButton label="الفيديو السابق" disabled={index === 0} onClick={() => go(-1)}>
              <ChevronUpIcon size={22} />
            </NavButton>
            <NavButton label="الفيديو التالي" disabled={index === videos.length - 1} onClick={() => go(1)}>
              <ChevronDownIcon size={22} />
            </NavButton>
          </div>
        )}
      </div>

      {videos.length > 1 && (
        <p className="relative z-10 pb-4 text-center font-display text-[0.9375rem] text-soft sm:hidden">اسحب لفوق للفيديو التالي</p>
      )}
    </motion.div>,
    document.body,
  );
}

function CtrlButton({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="grid size-10 place-items-center rounded-full text-text transition hover:bg-white/10"
    >
      {children}
    </button>
  );
}

function NavButton({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled: boolean; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className="grid size-12 place-items-center rounded-full border border-line-strong bg-surface/60 text-text backdrop-blur transition hover:border-accent hover:text-accent disabled:pointer-events-none disabled:opacity-25"
    >
      {children}
    </button>
  );
}
