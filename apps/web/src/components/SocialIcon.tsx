import type { SocialLink } from '../lib/links';
import { InstagramIcon, MailIcon, PhoneIcon, SnapchatIcon, TiktokIcon, WhatsappIcon, YoutubeIcon } from './Icons';

export function SocialIcon({ kind, size = 20 }: { kind: SocialLink['key']; size?: number }) {
  switch (kind) {
    case 'instagram':
      return <InstagramIcon size={size} />;
    case 'tiktok':
      return <TiktokIcon size={size} />;
    case 'youtube':
      return <YoutubeIcon size={size} />;
    case 'snapchat':
      return <SnapchatIcon size={size} />;
    case 'whatsapp':
      return <WhatsappIcon size={size} />;
    case 'email':
      return <MailIcon size={size} />;
    case 'phone':
      return <PhoneIcon size={size} />;
  }
}
