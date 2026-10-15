import { useCallback, useEffect, useRef, useState } from 'react';
import { motion, useMotionValueEvent, useTransform, type MotionValue } from 'motion/react';
import type { HomeData } from '@s5y/shared';
import { heroState, bindPointer } from '../3d/heroState';
import { HERO_CUES, HERO_FRAMES, HERO_STAGES, heroFocusMetres, heroStageAt } from '../3d/heroTimeline';
import { useRenderLease } from '../3d/renderLease';
import { useBoot } from '../app/loading';
import { useSectionNav } from '../app/useSectionNav';
import { Button, ButtonAnchor } from '../components/Button';
import { ArrowForwardIcon, WhatsappIcon } from '../components/Icons';
import { Magnetic } from '../components/Magnetic';
import { RecTimecode } from '../components/RecTimecode';
import { RevealLines } from '../components/Reveal';
import { useInView } from '../hooks/useInView';
import { useReducedMotion, useWideHero } from '../hooks/useMediaQuery';
import { usePageVisible } from '../hooks/usePageVisible';
import { useScrollTimeline } from '../hooks/useScrollTimeline';
import { hasWebGL } from '../lib/device';
import { formatTimecode, pad2 } from '../lib/format';
import { whatsappUrl } from '../lib/links';
import { HeroStage } from './HeroStage';

bindPointer();

/** One line per choreography stage, shown on a backplate while that stage plays (the cut has the chapter card). */
const STAGE_CAPTIONS = ['كل قصة تبدي بلقطة واضحة', 'كل شاشة قصة مكان', 'هسّه ادخل للعدسة'];

export function Hero({ data, hasWork }: { data: HomeData; hasWork: boolean }) {
  const { site, heroVideos } = data;
  const ref = useRef<HTMLElement>(null);
  /** Scroll-driven HUD readouts (`data-hud="…"`): written straight to the DOM on scroll, never through React. */
  const hud = useRef<Record<HudKey, HTMLElement[]>>({ focus: [], tc: [], frame: [], stage: [] });
  const reduced = useReducedMotion();
  const wide = useWideHero();
  const { dismissed } = useBoot();
  const go = useSectionNav();
  const inView = useInView(ref, { rootMargin: '0px' });
  const visible = usePageVisible();

  // The long, choreographed runway needs the live studio; without WebGL or with reduced motion the hero keeps
  // the short push-in (static frame + fades).
  const [webgl] = useState(() => hasWebGL());
  const [glDown, setGlDown] = useState(false);
  const onUnavailable = useCallback(() => setGlDown(true), []);
  const cinematic = webgl && !glDown && !reduced;
  const cues = cinematic ? HERO_CUES.cinematic : HERO_CUES.simple;

  const { progress } = useScrollTimeline(ref, 'contain');
  const [covered, setCovered] = useState(false);
  const active = useRenderLease('hero', inView && visible && !covered);
  const lastStage = useRef(-2);

  const lastFrame = useRef(-1);
  const writeHud = useCallback(
    (v: number, force = false) => {
      const els = hud.current;
      const metres = cinematic ? heroFocusMetres(v, !wide) : 3.2 - 2.75 * Math.min(1, v * 1.15);
      setText(els.focus, `${metres.toFixed(2)}M`);
      // scroll-driven "footage" counter: the runway is a 12-second take at 24 fps
      const frame = Math.round(v * HERO_FRAMES);
      if (frame !== lastFrame.current || force) {
        lastFrame.current = frame;
        setText(els.tc, formatTimecode(frame / 24));
        setText(els.frame, String(frame).padStart(4, '0'));
      }
      const stage = cinematic ? heroStageAt(v) : -1;
      if (stage !== lastStage.current || force) {
        lastStage.current = stage;
        setText(els.stage, stage < 0 ? 'SCENE 01 · TAKE 03' : `${pad2(stage + 1)} / ${pad2(HERO_STAGES.length)} · ${HERO_STAGES[stage]?.code ?? ''}`);
      }
    },
    [cinematic, wide],
  );

  // (re)collect the readouts whenever the layout swaps them (cinematic ↔ simple, phone ↔ desktop)
  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const pick = (key: HudKey) => Array.from(root.querySelectorAll<HTMLElement>(`[data-hud="${key}"]`));
    hud.current = { focus: pick('focus'), tc: pick('tc'), frame: pick('frame'), stage: pick('stage') };
    writeHud(progress.get(), true);
  }, [writeHud, progress]);

  useMotionValueEvent(progress, 'change', (v) => {
    heroState.progress = v;
    // fully faded to black: stop rendering the studio until the user scrolls back
    setCovered(v > cues.covered);
    writeHud(v);
  });

  const copyOpacity = useTransform(progress, [...cues.copy], [1, 0]);
  const copyY = useTransform(progress, [...cues.copyMove], [0, reduced ? 0 : -90]);
  const copyBlur = useTransform(progress, [...cues.copy], ['blur(0px)', reduced ? 'blur(0px)' : 'blur(8px)']);
  const blackout = useTransform(progress, [...cues.blackout], [0, 1]);
  const chapterOpacity = useTransform(progress, [...cues.chapter], [0, 1]);
  const chapterY = useTransform(progress, [cues.chapter[0], 1], [reduced ? 0 : 24, 0]);
  const hudOpacity = useTransform(progress, [...cues.hud], [1, 1, 0]);
  const cueOpacity = useTransform(progress, [...cues.cue], [1, 0]);
  // the take counter arrives once the scroll cue (desktop) / the copy (phones) has left the bottom of the frame
  const scrubberOpacity = useTransform(progress, [0.025, 0.07], [0, 1]);
  const scrub = useTransform(progress, [HERO_STAGES[0]?.from ?? 0, 1], [0, 1]);

  const brand = site.brand;
  const wa = whatsappUrl(site.contact.whatsapp, `هلا ${brand.name}، حاب أحجز تصوير`);
  const titleParts = brand.title.split('·').map((s) => s.trim()).filter(Boolean);

  return (
    <section
      ref={ref}
      id="top"
      aria-label={`${brand.name} — ${brand.title}`}
      className={`relative ${cinematic ? 'h-[460svh] md:h-[500svh]' : 'h-[210svh] md:h-[240svh]'}`}
    >
      <div className="sticky top-0 h-[100svh] overflow-hidden">
        <HeroStage
          videos={heroVideos}
          accent={brand.accent}
          mark={brand.heroMark || brand.name}
          active={active}
          decode={wide || inView}
          onUnavailable={onUnavailable}
        />

        {/* legibility gradients (scrims under every HUD line and the copy) */}
        <motion.div
          aria-hidden="true"
          style={{ opacity: copyOpacity }}
          className="pointer-events-none absolute inset-0 hidden bg-[linear-gradient(to_left,rgba(6,6,7,0.88)_0%,rgba(6,6,7,0.55)_30%,transparent_58%)] wide:block"
        />
        <motion.div
          aria-hidden="true"
          style={{ opacity: copyOpacity }}
          className="pointer-events-none absolute inset-x-0 bottom-0 h-[62%] bg-[linear-gradient(to_top,rgba(6,6,7,0.97)_8%,rgba(6,6,7,0.7)_45%,transparent)] wide:h-[34%]"
        />
        <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-0 h-[32%] bg-[linear-gradient(to_top,rgba(6,6,7,0.9)_6%,rgba(6,6,7,0.45)_50%,transparent)] wide:h-[26%]" />
        <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 h-36 bg-gradient-to-b from-bg/80 to-transparent" />

        {/* viewfinder HUD */}
        <motion.div style={{ opacity: hudOpacity }} className="pointer-events-none absolute inset-x-4 bottom-4 top-[calc(var(--header-h)+0.5rem)] sm:inset-x-6 sm:bottom-6" aria-hidden="true">
          <div className="viewfinder absolute inset-0 opacity-70 [--vf-size:22px]" />
          <div className="absolute inset-x-4 top-4 flex items-start justify-between gap-4 sm:inset-x-5 sm:top-5 short:hidden">
            <RecTimecode />
            <p className="hud hidden text-soft sm:block">4K · 24FPS · ISO 800 · ƒ/1.4 · 1/50</p>
          </div>
          <div className="absolute inset-x-4 bottom-4 hidden items-end justify-between gap-6 sm:inset-x-5 sm:bottom-5 sm:flex short:hidden">
            <p className="hud text-soft">
              <span data-hud="stage">SCENE 01 · TAKE 03</span>
            </p>
            {cinematic && (
              <motion.div style={{ opacity: scrubberOpacity }} className="hidden max-w-[24rem] flex-1 lg:flex">
                <Scrubber scrub={scrub} className="flex w-full" />
              </motion.div>
            )}
            <p className="hud text-soft">
              FOCUS <span data-hud="focus" className="text-accent">3.20M</span> <span className="text-muted">·</span> 35MM
            </p>
          </div>
          {/* phones + tablets: a compact scrubber (frame counter · line · focus distance) once the copy has left the frame */}
          {cinematic && (
            <motion.div style={{ opacity: scrubberOpacity }} className="absolute inset-x-4 bottom-4 sm:inset-x-5 sm:bottom-14 lg:hidden short:hidden">
              <Scrubber scrub={scrub} compact className="flex" />
            </motion.div>
          )}
        </motion.div>

        {/* stage captions — always on a backplate: the frame behind them is moving 3D */}
        {cinematic &&
          STAGE_CAPTIONS.map((text, i) => (
            <StageCaption key={i} progress={progress} cue={cues.captions[i]} index={i} text={text} />
          ))}

        {/* copy */}
        <motion.div
          style={{ opacity: copyOpacity, y: copyY, filter: copyBlur }}
          className="absolute inset-x-0 bottom-0 pb-[max(2.5rem,env(safe-area-inset-bottom))] wide:inset-y-0 wide:flex wide:items-center wide:pb-0"
        >
          <div className="container-cine">
            <div className="max-w-xl wide:ms-0 wide:max-w-[min(40rem,46vw)] wide:pt-10 short:pt-[calc(var(--header-h)-0.5rem)]">
              <motion.p
                className="mb-5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-soft sm:text-base short:mb-2 short:text-sm"
                initial={{ opacity: 0, y: 12 }}
                animate={dismissed ? { opacity: 1, y: 0 } : { opacity: 0, y: 12 }}
                transition={{ duration: 0.9, delay: 0.35, ease: [0.16, 1, 0.3, 1] }}
              >
                <span className="inline-block h-px w-8 bg-accent" aria-hidden="true" />
                {titleParts.map((part, i) => (
                  <span key={i} className="flex items-center gap-3">
                    {i > 0 && <span className="size-1 rounded-full bg-accent" aria-hidden="true" />}
                    {part}
                  </span>
                ))}
              </motion.p>
              <h1 className="sr-only">
                {brand.name} — {brand.title}
              </h1>
              <RevealLines
                as="p"
                play={dismissed}
                delay={0.45}
                lines={[brand.name]}
                className="display-xl text-[clamp(4.6rem,15vw,11.5rem)] leading-[0.86] [text-shadow:0_10px_60px_rgba(0,0,0,0.5)] short:text-[min(15vw,22svh)]"
                lineClassName="font-black"
              />
              <RevealLines
                as="p"
                play={dismissed}
                delay={0.62}
                lines={[brand.tagline]}
                className="mt-4 max-w-[34rem] font-display text-[clamp(1.35rem,3.4vw,2.2rem)] leading-[1.35] text-text text-balance short:mt-2 short:text-[clamp(1.05rem,5.5svh,1.5rem)]"
              />
              <motion.div
                className="mt-8 flex flex-wrap items-center gap-3 short:mt-4"
                initial={{ opacity: 0, y: 16 }}
                animate={dismissed ? { opacity: 1, y: 0 } : { opacity: 0, y: 16 }}
                transition={{ duration: 0.9, delay: 0.85, ease: [0.16, 1, 0.3, 1] }}
              >
                <Magnetic>
                  <Button size="lg" onClick={() => go(hasWork ? 'work' : 'contact')} icon={<ArrowForwardIcon size={18} className="transition-transform group-hover/btn:-translate-x-1" />}>
                    شوف الشغل
                  </Button>
                </Magnetic>
                {wa ? (
                  <ButtonAnchor variant="ghost" size="lg" href={wa} target="_blank" rel="noopener noreferrer" icon={<WhatsappIcon size={19} />}>
                    تواصل
                  </ButtonAnchor>
                ) : (
                  <Button variant="ghost" size="lg" onClick={() => go('contact')}>
                    تواصل
                  </Button>
                )}
              </motion.div>
            </div>
          </div>
        </motion.div>

        {/* scroll cue */}
        <motion.div style={{ opacity: cueOpacity }} className="pointer-events-none absolute bottom-8 left-1/2 hidden -translate-x-1/2 flex-col items-center gap-3 wide:flex short:hidden" aria-hidden="true">
          <span className="rounded-full bg-bg/80 px-3.5 py-1.5 text-sm text-soft">انزل وادخل للعدسة</span>
          <span className="relative h-12 w-px overflow-hidden bg-line-strong">
            <span className="scroll-cue-line absolute inset-0 bg-accent" />
          </span>
        </motion.div>

        <motion.div style={{ opacity: blackout }} className="pointer-events-none absolute inset-0 bg-bg" aria-hidden="true" />

        {/* chapter card on the cut to black — then the page scrolls on into the work */}
        <motion.div
          style={{ opacity: chapterOpacity, y: chapterY }}
          className="pointer-events-none absolute inset-x-0 top-1/2 flex -translate-y-1/2 flex-col items-center gap-4 text-center"
          aria-hidden="true"
        >
          <span className="hud text-accent">SCENE 02 · CUT TO</span>
          <span className="font-display text-[clamp(1.8rem,4.5vw,3.2rem)] text-text">من وراء العدسة</span>
          <span className="h-10 w-px bg-gradient-to-b from-accent to-transparent" />
        </motion.div>
      </div>
    </section>
  );
}

type HudKey = 'focus' | 'tc' | 'frame' | 'stage';

function setText(els: HTMLElement[], text: string): void {
  for (const el of els) if (el.textContent !== text) el.textContent = text;
}

/**
 * Scroll-driven take counter: four stage segments filling with the runway, plus timecode / frame readouts
 * (desktop) or frame counter / focus distance (phones: the bottom HUD row is hidden there).
 */
function Scrubber({ scrub, compact = false, className = '' }: { scrub: MotionValue<number>; compact?: boolean; className?: string }) {
  const start = HERO_STAGES[0]?.from ?? 0;
  return (
    <div dir="ltr" className={`items-center gap-3 ${className}`}>
      <span className="hud text-soft">
        {compact ? (
          <>
            FR <span data-hud="frame" className="text-text">0000</span>
          </>
        ) : (
          <>
            TC <span data-hud="tc" className="text-text">00:00:00:00</span>
          </>
        )}
      </span>
      <div className="relative h-px min-w-16 flex-1 bg-white/20">
        <motion.span style={{ scaleX: scrub }} className="absolute inset-0 origin-left bg-accent" />
        {HERO_STAGES.slice(1).map((s) => (
          <span key={s.code} className="absolute -top-[3px] h-[7px] w-px bg-white/45" style={{ left: `${((s.from - start) / (1 - start)) * 100}%` }} />
        ))}
      </div>
      <span className="hud text-soft">
        {compact ? (
          <span data-hud="focus" className="text-accent">3.20M</span>
        ) : (
          <>
            FR <span data-hud="frame" className="text-text">0000</span>
            <span className="text-muted"> / {String(HERO_FRAMES).padStart(4, '0')}</span>
          </>
        )}
      </span>
    </div>
  );
}

function StageCaption({
  progress,
  cue,
  index,
  text,
}: {
  progress: MotionValue<number>;
  cue: readonly [number, number, number, number] | undefined;
  index: number;
  text: string;
}) {
  const range = cue ?? [2, 2, 2, 2];
  const opacity = useTransform(progress, [...range], [0, 1, 1, 0]);
  const y = useTransform(progress, [range[0], range[1], range[2], range[3]], [14, 0, 0, -10]);
  const stage = HERO_STAGES[index];
  // side-by-side layouts: the first caption sits left (the lens' front ring owns the right of that frame), the
  // others right, where the camera leaves room for them
  const side = index === 0 ? 'wide:justify-end' : 'wide:justify-start';
  return (
    <motion.div
      style={{ opacity, y }}
      className={`pointer-events-none absolute inset-x-0 bottom-[calc(max(1rem,env(safe-area-inset-bottom))+3.25rem)] flex justify-center px-4 sm:bottom-24 wide:px-[max(var(--gutter),3.5rem)] ${side}`}
      aria-hidden="true"
    >
      <div className="max-w-[min(34rem,100%)] rounded-2xl bg-bg/85 px-5 py-3.5 text-center shadow-[0_20px_60px_-20px_rgba(0,0,0,0.9)] ring-1 ring-white/10 sm:px-7 sm:py-4 wide:text-start">
        <p className="hud text-accent">
          {pad2(index + 1)} · {stage?.code}
        </p>
        <p className="mt-2.5 font-display text-[clamp(1.3rem,4.8vw,2rem)] leading-[1.3] text-text text-balance">{text}</p>
      </div>
    </motion.div>
  );
}
