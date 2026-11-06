import type { PublicSite } from '@s5y/shared';

export function whatsappUrl(number: string, text?: string): string | null {
  const digits = number.replace(/\D/g, '');
  if (digits.length < 8) return null;
  return `https://wa.me/${digits}${text ? `?text=${encodeURIComponent(text)}` : ''}`;
}

function handle(value: string): string {
  return value.trim().replace(/^@/, '').replace(/^https?:\/\/[^/]+\//i, '').replace(/\/+$/, '');
}

export function instagramUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  if (/^https?:\/\//i.test(value)) return value;
  const h = handle(value);
  return h ? `https://www.instagram.com/${h}/` : null;
}

export function tiktokUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  if (/^https?:\/\//i.test(value)) return value;
  const h = handle(value);
  return h ? `https://www.tiktok.com/@${h}` : null;
}

export function youtubeUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  if (/^https?:\/\//i.test(value)) return value;
  const h = handle(value);
  return h ? `https://www.youtube.com/@${h}` : null;
}

export function snapchatUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  if (/^https?:\/\//i.test(value)) return value;
  const h = handle(value);
  return h ? `https://www.snapchat.com/add/${h}` : null;
}

export function websiteUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  const v = value.trim();
  if (!v) return null;
  return /^https?:\/\//i.test(v) ? v : `https://${v}`;
}

export function displayHost(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, '');
  } catch {
    return url;
  }
}

export interface SocialLink {
  key: 'instagram' | 'tiktok' | 'youtube' | 'snapchat' | 'whatsapp' | 'email' | 'phone';
  label: string;
  href: string;
}

export function socialLinks(site: PublicSite): SocialLink[] {
  const c = site.contact;
  const list: (SocialLink | null)[] = [
    c.instagram ? { key: 'instagram', label: 'إنستغرام', href: instagramUrl(c.instagram) ?? '' } : null,
    c.tiktok ? { key: 'tiktok', label: 'تيك توك', href: tiktokUrl(c.tiktok) ?? '' } : null,
    c.youtube ? { key: 'youtube', label: 'يوتيوب', href: youtubeUrl(c.youtube) ?? '' } : null,
    c.snapchat ? { key: 'snapchat', label: 'سناب شات', href: snapchatUrl(c.snapchat) ?? '' } : null,
    c.whatsapp ? { key: 'whatsapp', label: 'واتساب', href: whatsappUrl(c.whatsapp) ?? '' } : null,
  ];
  return list.filter((l): l is SocialLink => !!l && !!l.href);
}
