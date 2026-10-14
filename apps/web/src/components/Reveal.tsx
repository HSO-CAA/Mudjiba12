import type { ReactNode } from 'react';
import { motion, useReducedMotion } from 'motion/react';

const EASE = [0.16, 1, 0.3, 1] as const;

interface RevealProps {
  children: ReactNode;
  delay?: number;
  y?: number;
  className?: string;
  as?: 'div' | 'li' | 'p' | 'section' | 'span';
}

/** Fades + lifts content in once it scrolls into view. */
export function Reveal({ children, delay = 0, y = 28, className, as = 'div' }: RevealProps) {
  const reduced = useReducedMotion();
  const Comp = motion[as];
  return (
    <Comp
      className={className}
      initial={reduced ? { opacity: 0 } : { opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '0px 0px -12% 0px' }}
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
        <span key={i} className="-my-[0.14em] block overflow-hidden py-[0.14em]">
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
        </span>
      ))}
    </Tag>
  );
}
