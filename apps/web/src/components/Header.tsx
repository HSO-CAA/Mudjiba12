import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { AnimatePresence, motion } from 'motion/react';
import type { PublicSite } from '@s5y/shared';
import { useSectionNav, type SectionId } from '../app/useSectionNav';
import { socialLinks } from '../lib/links';
import { LensGlyph } from './BrandMark';
import { CloseIcon, MenuIcon } from './Icons';
import { SocialIcon } from './SocialIcon';

interface NavItem {
  id: SectionId;
  label: string;
}

export function navItems(site: PublicSite | undefined, hasPlaces = true): NavItem[] {
  const s = site?.sections;
  const items: (NavItem | false)[] = [
    hasPlaces && { id: 'work', label: 'الشغل' },
    !!s?.showreel && { id: 'showreel', label: 'مختارات' },
    !!s?.about && { id: 'about', label: 'نبذة' },
    !!s?.plans && { id: 'plans', label: 'الباقات' },
    (s?.contact ?? true) && { id: 'contact', label: 'تواصل' },
  ];
  return items.filter((i): i is NavItem => !!i);
}

export function Header({ site, hasPlans }: { site: PublicSite | undefined; hasPlans: boolean }) {
  const [scrolled, setScrolled] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [open, setOpen] = useState(false);
  const go = useSectionNav();
  const items = navItems(site).filter((i) => i.id !== 'plans' || hasPlans);
  const name = site?.brand.name ?? 'S5Y';
  const handle = site?.brand.handle ?? '';

  useEffect(() => {
    let last = window.scrollY;
    const onScroll = () => {
      const y = window.scrollY;
      setScrolled(y > 24);
      setHidden(y > 320 && y > last + 2);
      if (y < last - 2) setHidden(false);
      last = y;
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const select = (id: SectionId) => {
    setOpen(false);
    go(id);
  };

  return (
    <>
      <header
        data-site-header
        className={`fixed inset-x-0 top-0 z-50 transition-[transform,background-color,border-color,backdrop-filter] duration-500 ease-[cubic-bezier(.16,1,.3,1)] ${
          hidden && !open ? '-translate-y-full' : 'translate-y-0'
        } ${scrolled ? 'border-b border-line bg-bg/70 backdrop-blur-xl' : 'border-b border-transparent'}`}
      >
        <div className="container-cine flex h-[var(--header-h)] items-center justify-between gap-6">
          <Link to="/" className="group flex items-center gap-3" aria-label={`${name} — الرئيسية`} onClick={() => setOpen(false)}>
            <LensGlyph className="transition-transform duration-700 group-hover:rotate-[160deg]" />
            <span className="flex flex-col leading-none">
              <span className="font-display text-lg font-extrabold">{name}</span>
              {handle && <span className="hud mt-1 text-[0.6rem] text-muted">@{handle}</span>}
            </span>
          </Link>

          <nav aria-label="القائمة الرئيسية" className="hidden items-center gap-1 md:flex">
            {items.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => select(item.id)}
                className="rounded-full px-4 py-2 text-[0.95rem] text-text/80 transition hover:bg-white/5 hover:text-text"
              >
                {item.label}
              </button>
            ))}
          </nav>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => select('contact')}
              className="hidden h-10 items-center gap-2 rounded-full bg-accent px-5 text-sm font-semibold text-[var(--accent-ink)] transition hover:brightness-110 sm:inline-flex"
            >
              <span className="rec-dot inline-block size-1.5 rounded-full bg-[var(--accent-ink)]" aria-hidden="true" />
              احجز تصوير
            </button>
            <button
              type="button"
              onClick={() => setOpen((o) => !o)}
              className="grid size-11 place-items-center rounded-full border border-line-strong bg-white/[0.03] md:hidden"
              aria-expanded={open}
              aria-controls="mobile-menu"
              aria-label={open ? 'إغلاق القائمة' : 'فتح القائمة'}
            >
              {open ? <CloseIcon size={20} /> : <MenuIcon size={20} />}
            </button>
          </div>
        </div>
      </header>

      <AnimatePresence>
        {open && (
          <motion.div
            id="mobile-menu"
            className="fixed inset-0 z-40 flex flex-col bg-bg/95 px-6 pb-10 pt-[calc(var(--header-h)+2rem)] backdrop-blur-2xl md:hidden"
            initial={{ clipPath: 'inset(0 0 100% 0)' }}
            animate={{ clipPath: 'inset(0 0 0% 0)' }}
            exit={{ clipPath: 'inset(0 0 100% 0)' }}
            transition={{ duration: 0.6, ease: [0.77, 0, 0.18, 1] }}
          >
            <nav aria-label="قائمة الجوال" className="flex flex-1 flex-col gap-2">
              {items.map((item, i) => (
                <motion.button
                  key={item.id}
                  type="button"
                  onClick={() => select(item.id)}
                  className="flex items-baseline justify-between border-b border-line py-4 text-start"
                  initial={{ opacity: 0, y: 24 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.15 + i * 0.06, duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
                >
                  <span className="font-display text-4xl font-extrabold">{item.label}</span>
                  <span className="hud text-muted">{String(i + 1).padStart(2, '0')}</span>
                </motion.button>
              ))}
            </nav>
            {site && (
              <div className="flex flex-wrap gap-2">
                {socialLinks(site).map((s) => (
                  <a
                    key={s.key}
                    href={s.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="grid size-12 place-items-center rounded-full border border-line-strong"
                    aria-label={s.label}
                  >
                    <SocialIcon kind={s.key} />
                  </a>
                ))}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
