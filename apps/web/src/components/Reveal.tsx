import type { ReactNode } from 'react';
import { motion, useReducedMotion } from 'motion/react';

const EASE = [0.16, 1, 0.3, 1] as const;

interface RevealProps {
  children: ReactNode;
  delay?: number;
  y?: number;
  className?: string;
  as?: 'div' | 'li' | 'p' | 'section' | 'span';
  /**
   * Animate when this turns true (above-the-fold hero content) instead of on scroll. Content sitting near
   * the bottom edge of a full-height hero would otherwise stay invisible until the visitor scrolls.
   */
  play?: boolean;
}

/** Fades + lifts content in once it scrolls into view (or when `play` turns true). */
export function Reveal({ children, delay = 0, y = 28, className, as = 'div', play }: RevealProps) {
  const reduced = useReducedMotion();
  const Comp = motion[as];
  const hidden = reduced ? { opacity: 0 } : { opacity: 0, y };
  const shown = { opacity: 1, y: 0 };
  const trigger =
    play === undefined
      ? { whileInView: shown, viewport: { once: true, margin: '0px 0px -12% 0px' } }
      : { animate: play ? shown : hidden };
  return (
    <Comp
      className={className}
      initial={hidden}
      {...trigger}
      transition={{ duration: reduced ? 0.2 : 0.95, delay, ease: EASE }}
    >
      {children}
    </Comp>
  );
}

interface LinesProps {
  lines: string[];
  className?: string;
  lineClassName?: string;
  delay?: number;
  /** Animate immediately (hero) instead of on scroll. */
  play?: boolean;
  as?: 'h1' | 'h2' | 'h3' | 'p';
  id?: string;
}

/** Staggered masked line reveal for headlines (each line slides up from behind a mask). */
export function RevealLines({ lines, className, lineClassName, delay = 0, play, as = 'h2', id }: LinesProps) {
  const reduced = useReducedMotion();
  const Tag = as;
  const animateProps =
    play === undefined
      ? { whileInView: 'shown' as const, viewport: { once: true, margin: '0px 0px -10% 0px' } }
      : { animate: play ? ('shown' as const) : ('hidden' as const) };
  return (
    <Tag className={className} id={id}>
      {lines.map((line, i) => (
        <span key={i} className="-my-[0.3em] block overflow-hidden py-[0.3em]">
          <motion.span
            className={`block ${lineClassName ?? ''}`}
            initial="hidden"
            {...animateProps}
            variants={{
              hidden: reduced ? { opacity: 0 } : { y: '110%', opacity: 0 },
              shown: { y: '0%', opacity: 1 },
            }}
            transition={{ duration: reduced ? 0.2 : 1.1, delay: delay + i * 0.09, ease: EASE }}
          >
            {line}
          </motion.span>
          {/* keeps words apart in the heading's accessible name (lines are separate block spans) */}
          {i < lines.length - 1 ? ' ' : null}
        </span>
      ))}
    </Tag>
  );
}
