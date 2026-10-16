import { Link } from 'react-router';
import { motion } from 'motion/react';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { useSite } from '../api/queries';
import { buttonClass } from '../components/Button';
import { ArrowForwardIcon } from '../components/Icons';
import { RecTimecode } from '../components/RecTimecode';

/** On-brand 404: an empty viewfinder ("المشهد مو موجود"). */
export function NotFoundPage({ title = 'المشهد مو موجود', body = 'الصفحة اللي تدور عليها انحذفت أو انتقلت لمكان ثاني. خلّينا نرجعك للقطة الصح.' }: { title?: string; body?: string }) {
  const { data: site } = useSite();
  useDocumentTitle(`${title} — ${site?.brand.name ?? 'S5Y'}`);
  return (
    <section className="relative flex min-h-[100svh] items-center overflow-hidden pt-[var(--header-h)]">
      <div aria-hidden="true" className="absolute inset-0 bg-[radial-gradient(50%_50%_at_50%_50%,color-mix(in_oklab,var(--accent)_12%,transparent),transparent_70%)]" />
      <div aria-hidden="true" className="viewfinder absolute inset-x-4 bottom-4 top-[calc(var(--header-h)+0.5rem)] opacity-60 sm:inset-x-6 sm:bottom-6 [--vf-size:26px]" />
      <div aria-hidden="true" className="absolute inset-x-8 top-[calc(var(--header-h)+1.5rem)] flex justify-between sm:inset-x-10">
        <RecTimecode />
        <span className="hud text-soft">NO SIGNAL · 404</span>
      </div>
      <div className="container-cine relative text-center">
        <motion.p
          dir="ltr"
          initial={{ opacity: 0, filter: 'blur(18px)', scale: 1.08 }}
          animate={{ opacity: 1, filter: 'blur(0px)', scale: 1 }}
          transition={{ duration: 1.6, ease: [0.16, 1, 0.3, 1] }}
          className="bg-gradient-to-b from-white/[0.9] via-white/[0.5] to-white/[0.12] bg-clip-text pb-2 font-display text-[clamp(7rem,30vw,22rem)] leading-[0.8] text-transparent"
          aria-hidden="true"
        >
          404
        </motion.p>
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.35, duration: 0.9, ease: [0.16, 1, 0.3, 1] }}>
          <h1 className="display-xl mt-6 text-[clamp(2rem,6vw,4rem)]">{title}</h1>
          <p className="copy mx-auto mt-4 max-w-md">{body}</p>
          <div className="mt-9 flex flex-wrap justify-center gap-3">
            <Link to="/" className={buttonClass('primary', 'lg')}>
              <span>رجوع للرئيسية</span>
              <ArrowForwardIcon size={18} />
            </Link>
            <Link to="/#work" state={{ scrollTo: 'work' }} className={buttonClass('ghost', 'lg')}>
              <span>شوف الشغل</span>
            </Link>
          </div>
        </motion.div>
      </div>
    </section>
  );
}

export default NotFoundPage;
