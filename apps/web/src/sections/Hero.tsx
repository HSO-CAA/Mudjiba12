import { useRef, useState } from 'react';
import { motion, useMotionValueEvent, useReducedMotion, useTransform } from 'motion/react';
import type { HomeData } from '@s5y/shared';
import { heroState, bindPointer } from '../3d/heroState';
import { useBoot } from '../app/loading';
import { useSectionNav } from '../app/useSectionNav';
import { Button, ButtonAnchor } from '../components/Button';
import { ArrowForwardIcon, WhatsappIcon } from '../components/Icons';
import { Magnetic } from '../components/Magnetic';
import { RecTimecode } from '../components/RecTimecode';
import { RevealLines } from '../components/Reveal';
import { useInView } from '../hooks/useInView';
import { usePageVisible } from '../hooks/usePageVisible';
import { useScrollProgress } from '../hooks/useScrollProgress';
import { whatsappUrl } from '../lib/links';
import { HeroStage } from './HeroStage';

bindPointer();

export function Hero({ data, hasWork }: { data: HomeData; hasWork: boolean }) {
  const { site, heroVideos } = data;
  const ref = useRef<HTMLElement>(null);
  const focusRef = useRef<HTMLSpanElement>(null);
  const reduced = useReducedMotion();
  const { dismissed } = useBoot();
  const go = useSectionNav();
  const inView = useInView(ref, { rootMargin: '0px' });
  const visible = usePageVisible();

  const scrollYProgress = useScrollProgress(ref, 'contain');
  const [covered, setCovered] = useState(false);
  useMotionValueEvent(scrollYProgress, 'change', (v) => {
    heroState.progress = v;
    // fully faded to black: stop rendering the studio until the user scrolls back
    setCovered(v > 0.93);
    if (focusRef.current) focusRef.current.textContent = `${(3.2 - 2.75 * Math.min(1, v * 1.15)).toFixed(2)}M`;
  });

  const copyOpacity = useTransform(scrollYProgress, [0, 0.22], [1, 0]);
  const copyY = useTransform(scrollYProgress, [0, 0.3], [0, reduced ? 0 : -90]);
  const copyBlur = useTransform(scrollYProgress, [0, 0.25], ['blur(0px)', reduced ? 'blur(0px)' : 'blur(8px)']);
  const blackout = useTransform(scrollYProgress, [0.7, 0.9], [0, 1]);
  const chapterOpacity = useTransform(scrollYProgress, [0.84, 0.95], [0, 1]);
  const chapterY = useTransform(scrollYProgress, [0.84, 1], [reduced ? 0 : 24, 0]);
  const hudOpacity = useTransform(scrollYProgress, [0, 0.9, 1], [1, 1, 0]);
  const cueOpacity = useTransform(scrollYProgress, [0, 0.08], [1, 0]);
  const enterOpacity = useTransform(scrollYProgress, [0.4, 0.52, 0.68, 0.78], [0, 1, 1, 0]);

  const brand = site.brand;
  const wa = whatsappUrl(site.contact.whatsapp, `هلا ${brand.name}، حاب أحجز تصوير`);
  const titleParts = brand.title.split('·').map((s) => s.trim()).filter(Boolean);

  return (
    <section ref={ref} id="top" aria-label={`${brand.name} — ${brand.title}`} className="relative h-[210svh] md:h-[240svh]">
      <div className="sticky top-0 h-[100svh] overflow-hidden">
        <HeroStage videos={heroVideos} accent={brand.accent} mark={brand.heroMark || brand.name} active={inView && visible && !covered} />

        {/* legibility gradients */}
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 hidden bg-[linear-gradient(to_left,rgba(6,6,7,0.88)_0%,rgba(6,6,7,0.55)_30%,transparent_58%)] wide:block" />
        <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-0 h-[62%] bg-[linear-gradient(to_top,rgba(6,6,7,0.97)_8%,rgba(6,6,7,0.7)_45%,transparent)] wide:h-[34%]" />
        <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 h-36 bg-gradient-to-b from-bg/80 to-transparent" />

        {/* viewfinder HUD */}
        <motion.div style={{ opacity: hudOpacity }} className="pointer-events-none absolute inset-x-4 bottom-4 top-[calc(var(--header-h)+0.5rem)] sm:inset-x-6 sm:bottom-6" aria-hidden="true">
          <div className="viewfinder absolute inset-0 opacity-70 [--vf-size:22px]" />
          <div className="absolute inset-x-4 top-4 flex items-start justify-between gap-4 sm:inset-x-5 sm:top-5 short:hidden">
            <RecTimecode />
            <p className="hud hidden text-text/60 sm:block">4K · 24FPS · ISO 800 · ƒ/1.4 · 1/50</p>
          </div>
          <div className="absolute inset-x-4 bottom-4 hidden items-end justify-between gap-4 sm:inset-x-5 sm:bottom-5 sm:flex short:hidden">
            <p className="hud text-text/55">
              SCENE 01 <span className="text-muted">·</span> TAKE 03
            </p>
            <p className="hud text-text/60">
              FOCUS <span ref={focusRef} className="text-accent">3.20M</span> <span className="text-muted">·</span> 35MM
            </p>
          </div>
        </motion.div>

        {/* "entering the lens" caption */}
        <motion.p
          style={{ opacity: enterOpacity }}
          className="hud pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-text/70"
          aria-hidden="true"
        >
          THROUGH THE LENS
        </motion.p>

        {/* copy */}
        <motion.div
          style={{ opacity: copyOpacity, y: copyY, filter: copyBlur }}
          className="absolute inset-x-0 bottom-0 pb-[max(2.5rem,env(safe-area-inset-bottom))] wide:inset-y-0 wide:flex wide:items-center wide:pb-0"
        >
          <div className="container-cine">
            <div className="max-w-xl wide:ms-0 wide:max-w-[min(40rem,46vw)] wide:pt-10 short:pt-[calc(var(--header-h)-0.5rem)]">
              <motion.p
                className="mb-5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-text/80 sm:text-base short:mb-2 short:text-sm"
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
                className="mt-4 max-w-[34rem] font-display text-[clamp(1.35rem,3.4vw,2.2rem)] font-bold leading-[1.35] text-text/95 text-balance short:mt-2 short:text-[clamp(1.05rem,5.5svh,1.5rem)]"
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
          <span className="text-xs text-muted">انزل وادخل للعدسة</span>
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
          <span className="font-display text-[clamp(1.8rem,4.5vw,3.2rem)] font-extrabold text-text/90">من وراء العدسة</span>
          <span className="h-10 w-px bg-gradient-to-b from-accent to-transparent" />
        </motion.div>
      </div>
    </section>
  );
}
