import type { PublicSite } from '@s5y/shared';
import { useSectionNav } from '../app/useSectionNav';
import { socialLinks, whatsappUrl } from '../lib/links';
import { ArrowUpIcon, MailIcon, PhoneIcon, WhatsappIcon } from './Icons';
import { ButtonAnchor, Button } from './Button';
import { Magnetic } from './Magnetic';
import { SocialIcon } from './SocialIcon';
import { Reveal, RevealLines } from './Reveal';

export function Footer({ site }: { site: PublicSite | undefined }) {
  const go = useSectionNav();
  const year = new Date().getFullYear();
  const name = site?.brand.name ?? 'S5Y';
  const mark = site?.brand.heroMark || name;
  const wa = site ? whatsappUrl(site.contact.whatsapp, `هلا ${name}، حاب أحجز تصوير`) : null;
  const socials = site ? socialLinks(site) : [];

  return (
    <footer className="relative overflow-hidden border-t border-line bg-surface/40">
      <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 -top-40 h-80 bg-[radial-gradient(60%_60%_at_50%_100%,color-mix(in_oklab,var(--accent)_16%,transparent),transparent)]" />
      <div className="container-cine relative py-20 sm:py-28">
        <div className="flex flex-col items-start justify-between gap-10 md:flex-row md:items-end">
          <div>
            <Reveal>
              <p className="hud mb-5 text-accent">NEXT SCENE</p>
            </Reveal>
            <RevealLines as="h2" lines={['عندك مكان', 'يستاهل ينشاف؟']} className="display-xl text-[clamp(2.4rem,7vw,5.5rem)]" />
          </div>
          <Reveal delay={0.15} className="flex flex-wrap gap-3">
            {wa ? (
              <Magnetic>
                <ButtonAnchor href={wa} target="_blank" rel="noopener noreferrer" size="lg" icon={<WhatsappIcon size={20} />}>
                  راسلني على واتساب
                </ButtonAnchor>
              </Magnetic>
            ) : (
              <Magnetic>
                <Button size="lg" onClick={() => go('contact')}>
                  خلّينا نحچي
                </Button>
              </Magnetic>
            )}
            {site?.sections.contact && (
              <Button variant="ghost" size="lg" onClick={() => go('contact')}>
                أرسل رسالة
              </Button>
            )}
          </Reveal>
        </div>

        <div className="mt-20 grid gap-10 border-t border-line pt-10 sm:grid-cols-[1fr_auto] sm:items-end">
          <div className="flex flex-col gap-4">
            {site?.contact.email && (
              <a href={`mailto:${site.contact.email}`} className="inline-flex items-center gap-2.5 self-start text-soft transition hover:text-text">
                <MailIcon size={18} /> <span dir="ltr">{site.contact.email}</span>
              </a>
            )}
            {site?.contact.phone && (
              <a href={`tel:${site.contact.phone.replace(/\s+/g, '')}`} className="inline-flex items-center gap-2.5 self-start text-soft transition hover:text-text">
                <PhoneIcon size={18} /> <span dir="ltr">{site.contact.phone}</span>
              </a>
            )}
            {site?.contact.address && <p className="text-soft">{site.contact.address}</p>}
          </div>
          {socials.length > 0 && (
            <ul className="flex flex-wrap gap-2" aria-label="حسابات التواصل">
              {socials.map((s) => (
                <li key={s.key}>
                  <a
                    href={s.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={s.label}
                    title={s.label}
                    className="grid size-12 place-items-center rounded-full border border-line-strong text-text transition hover:-translate-y-0.5 hover:border-accent hover:text-accent"
                  >
                    <SocialIcon kind={s.key} />
                  </a>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="relative select-none overflow-hidden" aria-hidden="true">
        <p
          dir="ltr"
          className="whitespace-nowrap bg-gradient-to-b from-white/[0.6] via-white/[0.24] to-transparent bg-clip-text pb-4 text-center font-display text-[clamp(6rem,26vw,24rem)] leading-[0.8] tracking-[-0.04em] text-transparent"
        >
          {mark}
        </p>
      </div>

      <div className="container-cine relative flex flex-col-reverse items-center justify-between gap-4 border-t border-line py-6 font-ui text-[0.9375rem] font-semibold text-muted sm:flex-row">
        <p>
          © <span dir="ltr">{year}</span> {name} — جميع الحقوق محفوظة
        </p>
        <button type="button" onClick={() => go('top')} className="inline-flex items-center gap-2 font-ui text-base text-soft transition hover:text-text">
          للأعلى <ArrowUpIcon size={16} />
        </button>
      </div>
    </footer>
  );
}
