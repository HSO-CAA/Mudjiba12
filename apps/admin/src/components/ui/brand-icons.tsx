import type { SVGProps } from 'react';

/** Minimal brand glyphs (lucide-react 1.x ships no brand icons). Stroke style matches lucide. */
type IconProps = SVGProps<SVGSVGElement>;

const base = {
  xmlns: 'http://www.w3.org/2000/svg',
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  width: 24,
  height: 24,
  'aria-hidden': true,
};

export const InstagramIcon = (props: IconProps) => (
  <svg {...base} {...props}>
    <rect x="3" y="3" width="18" height="18" rx="5" />
    <circle cx="12" cy="12" r="4" />
    <circle cx="17.5" cy="6.5" r="0.6" fill="currentColor" />
  </svg>
);

export const TikTokIcon = (props: IconProps) => (
  <svg {...base} {...props}>
    <path d="M14 3v11.5a3.5 3.5 0 1 1-3.5-3.5" />
    <path d="M14 3c.4 2.6 2.2 4.4 5 4.6" />
  </svg>
);

export const YouTubeIcon = (props: IconProps) => (
  <svg {...base} {...props}>
    <rect x="2.5" y="5.5" width="19" height="13" rx="4" />
    <path d="m10.5 9.5 4 2.5-4 2.5z" fill="currentColor" />
  </svg>
);

export const SnapchatIcon = (props: IconProps) => (
  <svg {...base} {...props}>
    <path d="M12 3.5c-3 0-5 2.2-5 5.2v2.1l-1.6.6c-.5.2-.4.9.1 1l1.2.4c-.6 1.6-1.8 2.8-3.2 3.3.4.8 1.6 1 2.6 1.1.2.6.3 1.3 1 1.3.8 0 1.5-.4 2.6-.1 1 .3 1.4 1.1 2.3 1.1s1.3-.8 2.3-1.1c1.1-.3 1.8.1 2.6.1.7 0 .8-.7 1-1.3 1-.1 2.2-.3 2.6-1.1-1.4-.5-2.6-1.7-3.2-3.3l1.2-.4c.5-.1.6-.8.1-1l-1.6-.6V8.7c0-3-2-5.2-5-5.2Z" />
  </svg>
);

export const WhatsAppIcon = (props: IconProps) => (
  <svg {...base} {...props}>
    <path d="M3.5 20.5 5 16.3A8.5 8.5 0 1 1 8 19.2z" />
    <path d="M9 8.6c0 3.3 3 6.4 6.4 6.4l1.1-1.4-1.8-1-1 .8c-1.1-.4-2.1-1.4-2.5-2.5l.8-1-1-1.8z" fill="currentColor" strokeWidth="1" />
  </svg>
);
