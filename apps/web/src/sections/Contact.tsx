import { useEffect, useId, useState, type FormEvent, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import type { InquiryInput, PublicPlan, PublicSite } from '@s5y/shared';
import { ApiError, fieldErrors } from '../api/client';
import { useCreateInquiry } from '../api/queries';
import { useContactIntent } from '../app/ContactIntent';
import { Button, ButtonAnchor } from '../components/Button';
import { CheckIcon, InstagramIcon, MailIcon, PhoneIcon, SendIcon, WhatsappIcon } from '../components/Icons';
import { Magnetic } from '../components/Magnetic';
import { Reveal } from '../components/Reveal';
import { SectionHeading } from '../components/SectionHeading';
import { formatPrice, periodLabel } from '../lib/format';
import { instagramUrl, whatsappUrl } from '../lib/links';

type Field = 'name' | 'phone' | 'email' | 'message' | 'planId';
type Errors = Partial<Record<Field, string>>;

const PHONE_RE = /^[+0-9 -]{6,20}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function validate(v: { name: string; phone: string; email: string; message: string }): Errors {
  const e: Errors = {};
  const name = v.name.trim();
  if (name.length < 2) e.name = 'اكتب اسمك (حرفين على الأقل).';
  else if (name.length > 80) e.name = 'الاسم طويل، اختصره لـ 80 حرف.';
  const phone = v.phone.trim();
  const email = v.email.trim();
  if (!phone && !email) e.phone = 'نحتاج رقم الهاتف أو الإيميل حتى نرجعلك.';
  if (phone && !PHONE_RE.test(phone)) e.phone = 'رقم الهاتف غير صحيح — أرقام فقط مع + أو مسافات.';
  if (email && !EMAIL_RE.test(email)) e.email = 'الإيميل غير صحيح.';
  const message = v.message.trim();
  if (message.length < 5) e.message = 'احچيلي شوية عن المكان أو الفكرة (5 أحرف على الأقل).';
  else if (message.length > 2000) e.message = 'الرسالة طويلة، الحد 2000 حرف.';
  return e;
}

interface Props {
  site: PublicSite;
  plans: PublicPlan[];
  index?: number;
  total?: number;
  /** InquiryInput.source, e.g. "home" or "place:<slug>". */
  source: string;
  heading?: string;
}

export function Contact({ site, plans, index, total, source, heading }: Props) {
  const wa = whatsappUrl(site.contact.whatsapp, `هلا ${site.brand.name}، حاب أحجز تصوير`);
  const ig = instagramUrl(site.contact.instagram);

  return (
    <section id="contact" aria-labelledby="contact-title" className="relative scroll-mt-24 py-24 sm:py-32">
      <div className="container-cine grid gap-14 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] lg:gap-20">
        <div>
          {index && total ? (
            <SectionHeading
              id="contact"
              index={index}
              total={total}
              code="CONTACT"
              kicker="تواصل"
              title={heading ? [heading] : ['خلّينا نصوّر', 'قصتك الجاية']}
              description="احچيلي عن مكانك وشنو تحتاج — أرجعلك بأقرب وقت بفكرة وعرض واضح."
            />
          ) : (
            <h2 id="contact-title" className="display-xl mb-6 text-[clamp(2rem,5vw,3.6rem)]">
              {heading ?? 'خلّينا نصوّر قصتك الجاية'}
            </h2>
          )}
          <Reveal delay={0.1} className="flex flex-col gap-3">
            {wa && (
              <Magnetic className="w-full sm:w-auto">
                <ButtonAnchor href={wa} target="_blank" rel="noopener noreferrer" size="lg" icon={<WhatsappIcon size={20} />} className="w-full sm:w-auto">
                  راسلني على واتساب
                </ButtonAnchor>
              </Magnetic>
            )}
            <div className="mt-4 flex flex-col gap-1">
              {ig && (
                <ContactLine href={ig} icon={<InstagramIcon size={19} />} label="إنستغرام" value={`@${site.contact.instagram.replace(/^@/, '')}`} external />
              )}
              {site.contact.email && <ContactLine href={`mailto:${site.contact.email}`} icon={<MailIcon size={19} />} label="الإيميل" value={site.contact.email} />}
              {site.contact.phone && (
                <ContactLine href={`tel:${site.contact.phone.replace(/\s+/g, '')}`} icon={<PhoneIcon size={19} />} label="الهاتف" value={site.contact.phone} />
              )}
            </div>
          </Reveal>
        </div>
        <Reveal delay={0.15}>
          <InquiryForm plans={plans} source={source} />
        </Reveal>
      </div>
    </section>
  );
}

function ContactLine({ href, icon, label, value, external }: { href: string; icon: ReactNode; label: string; value: string; external?: boolean }) {
  return (
    <a
      href={href}
      {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
      className="group flex items-center justify-between gap-4 border-b border-line py-4 transition hover:border-accent/60"
    >
      <span className="flex items-center gap-3 text-muted transition group-hover:text-text">
        <span className="text-accent">{icon}</span>
        {label}
      </span>
      <span dir="ltr" className="font-mono text-sm text-text/90">
        {value}
      </span>
    </a>
  );
}

function InquiryForm({ plans, source }: { plans: PublicPlan[]; source: string }) {
  const uid = useId();
  const { planId: intentPlan, setPlanId } = useContactIntent();
  const mutation = useCreateInquiry();
  const [values, setValues] = useState({ name: '', phone: '', email: '', message: '', planId: '', website: '' });
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (intentPlan && plans.some((p) => p.id === intentPlan)) {
      setValues((v) => ({ ...v, planId: intentPlan }));
      setDone(false);
    }
  }, [intentPlan, plans]);

  const set = (key: keyof typeof values) => (e: { target: { value: string } }) => {
    const value = e.target.value;
    setValues((v) => ({ ...v, [key]: value }));
    if (key in errors) setErrors((er) => ({ ...er, [key]: undefined }));
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (mutation.isPending) return;
    setFormError(null);
    const found = validate(values);
    setErrors(found);
    if (Object.keys(found).length) {
      const first = Object.keys(found)[0];
      document.getElementById(`${uid}-${first}`)?.focus();
      return;
    }
    const input: InquiryInput = {
      name: values.name.trim(),
      message: values.message.trim(),
      ...(values.phone.trim() ? { phone: values.phone.trim() } : {}),
      ...(values.email.trim() ? { email: values.email.trim() } : {}),
      ...(values.planId ? { planId: values.planId } : {}),
      source: values.planId ? 'plan' : source,
      ...(values.website ? { website: values.website } : {}),
    };
    try {
      await mutation.mutateAsync(input);
      setDone(true);
      setPlanId(null);
      setValues({ name: '', phone: '', email: '', message: '', planId: '', website: '' });
    } catch (err) {
      const fe = fieldErrors(err);
      if (Object.keys(fe).length) setErrors(fe as Errors);
      setFormError(err instanceof ApiError ? err.message : 'تعذّر إرسال الرسالة، حاول مرة ثانية.');
    }
  };

  const fieldClass = (k: Field) =>
    `peer w-full rounded-2xl border bg-white/[0.03] px-4 pb-3 pt-7 text-base text-text outline-none transition placeholder:text-transparent focus:bg-white/[0.05] ${
      errors[k] ? 'border-rec/70 focus:border-rec' : 'border-line-strong focus:border-accent'
    }`;

  return (
    <div className="relative overflow-hidden rounded-[1.8rem] border border-line bg-surface/80 p-6 shadow-[0_40px_120px_-60px_rgba(0,0,0,0.9)] sm:p-9">
      <div aria-hidden="true" className="viewfinder pointer-events-none absolute inset-3 opacity-30 [--vf-size:16px]" />
      <AnimatePresence mode="wait" initial={false}>
        {done ? (
          <motion.div
            key="done"
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
            className="flex min-h-[26rem] flex-col items-center justify-center gap-5 text-center"
            role="status"
            aria-live="polite"
          >
            <span className="grid size-20 place-items-center rounded-full bg-accent text-[var(--accent-ink)] shadow-[0_0_80px_-10px_var(--accent)]">
              <CheckIcon size={36} strokeWidth={2.2} />
            </span>
            <h3 className="font-display text-3xl font-extrabold">وصلت رسالتك!</h3>
            <p className="max-w-sm leading-7 text-muted">شكراً إلك. راح أرجعلك بأقرب وقت — وإذا مستعجل، راسلني واتساب.</p>
            <Button variant="ghost" onClick={() => setDone(false)}>
              أرسل رسالة ثانية
            </Button>
          </motion.div>
        ) : (
          <motion.form
            key="form"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onSubmit={submit}
            noValidate
            className="relative flex flex-col gap-4"
            aria-describedby={formError ? `${uid}-form-error` : undefined}
          >
            <div className="mb-2 flex items-center justify-between">
              <p className="font-display text-xl font-bold">ابدأ مشروعك</p>
              <span className="hud text-muted">BRIEF · 01</span>
            </div>

            <FloatingField id={`${uid}-name`} label="الاسم" error={errors.name}>
              <input id={`${uid}-name`} name="name" autoComplete="name" value={values.name} onChange={set('name')} placeholder="الاسم" className={fieldClass('name')} maxLength={80} aria-invalid={!!errors.name} aria-describedby={errors.name ? `${uid}-name-err` : undefined} />
            </FloatingField>

            <div className="grid gap-4 sm:grid-cols-2">
              <FloatingField id={`${uid}-phone`} label="رقم الهاتف / واتساب" error={errors.phone}>
                <input id={`${uid}-phone`} name="phone" type="tel" inputMode="tel" autoComplete="tel" dir="ltr" value={values.phone} onChange={set('phone')} placeholder="07xx" className={`${fieldClass('phone')} text-end`} maxLength={20} aria-invalid={!!errors.phone} aria-describedby={errors.phone ? `${uid}-phone-err` : undefined} />
              </FloatingField>
              <FloatingField id={`${uid}-email`} label="الإيميل (اختياري)" error={errors.email}>
                <input id={`${uid}-email`} name="email" type="email" inputMode="email" autoComplete="email" dir="ltr" value={values.email} onChange={set('email')} placeholder="you@example.com" className={`${fieldClass('email')} text-end`} maxLength={160} aria-invalid={!!errors.email} aria-describedby={errors.email ? `${uid}-email-err` : undefined} />
              </FloatingField>
            </div>

            {plans.length > 0 && (
              <FloatingField id={`${uid}-planId`} label="الباقة (اختياري)" error={errors.planId}>
                <select id={`${uid}-planId`} name="planId" value={values.planId} onChange={set('planId')} className={`${fieldClass('planId')} appearance-none bg-surface`}>
                  <option value="">بدون باقة — شي مخصص</option>
                  {plans.map((p) => {
                    const price = formatPrice(p.price, p.currency);
                    return (
                      <option key={p.id} value={p.id}>
                        {p.name} — {price.onRequest ? price.amount : `${price.amount} ${price.unit} · ${periodLabel(p.period)}`}
                      </option>
                    );
                  })}
                </select>
              </FloatingField>
            )}

            <FloatingField id={`${uid}-message`} label="شنو تحتاج؟" error={errors.message}>
              <textarea id={`${uid}-message`} name="message" rows={5} value={values.message} onChange={set('message')} placeholder="رسالتك" className={`${fieldClass('message')} resize-none`} maxLength={2000} aria-invalid={!!errors.message} aria-describedby={errors.message ? `${uid}-message-err` : undefined} />
            </FloatingField>

            {/* honeypot: hidden from people, irresistible to bots */}
            <div className="absolute -left-[9999px] top-auto h-px w-px overflow-hidden" aria-hidden="true">
              <label htmlFor={`${uid}-website`}>الموقع الإلكتروني</label>
              <input id={`${uid}-website`} name="website" tabIndex={-1} autoComplete="off" value={values.website} onChange={set('website')} />
            </div>

            {formError && (
              <p id={`${uid}-form-error`} role="alert" className="rounded-xl border border-rec/40 bg-rec/10 px-4 py-3 text-sm text-text">
                {formError}
              </p>
            )}

            <Button type="submit" size="lg" className="mt-2 w-full" disabled={mutation.isPending} icon={mutation.isPending ? <span className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent" /> : <SendIcon size={18} />}>
              {mutation.isPending ? 'جاري الإرسال…' : 'أرسل الرسالة'}
            </Button>
            <p className="text-center text-xs text-muted">بياناتك تنستخدم بس حتى أتواصل وياك بخصوص طلبك.</p>
          </motion.form>
        )}
      </AnimatePresence>
    </div>
  );
}

function FloatingField({ id, label, error, children }: { id: string; label: string; error?: string; children: ReactNode }) {
  return (
    <div>
      <div className="relative">
        {children}
        <label htmlFor={id} className="pointer-events-none absolute start-4 top-2.5 text-xs text-muted transition peer-focus:text-accent">
          {label}
        </label>
      </div>
      {error && (
        <p id={`${id}-err`} className="mt-1.5 ps-1 text-sm text-[#ff7a70]">
          {error}
        </p>
      )}
    </div>
  );
}
