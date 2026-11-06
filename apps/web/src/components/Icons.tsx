import type { SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function Base({ size = 20, children, strokeWidth = 1.7, ...rest }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {children}
    </svg>
  );
}

export const PlayIcon = (p: IconProps) => (
  <Base {...p}>
    <path d="M7 4.8v14.4a.8.8 0 0 0 1.2.7l11.3-7.2a.8.8 0 0 0 0-1.4L8.2 4.1A.8.8 0 0 0 7 4.8Z" fill="currentColor" stroke="none" />
  </Base>
);
export const PauseIcon = (p: IconProps) => (
  <Base {...p}>
    <rect x="6" y="4.5" width="4" height="15" rx="1.2" fill="currentColor" stroke="none" />
    <rect x="14" y="4.5" width="4" height="15" rx="1.2" fill="currentColor" stroke="none" />
  </Base>
);
export const VolumeIcon = (p: IconProps) => (
  <Base {...p}>
    <path d="M4 9.5h3.2L12 5.5v13l-4.8-4H4z" fill="currentColor" stroke="none" />
    <path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11" />
  </Base>
);
export const MuteIcon = (p: IconProps) => (
  <Base {...p}>
    <path d="M4 9.5h3.2L12 5.5v13l-4.8-4H4z" fill="currentColor" stroke="none" />
    <path d="m16 9.5 5 5m0-5-5 5" />
  </Base>
);
export const ExpandIcon = (p: IconProps) => (
  <Base {...p}>
    <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
  </Base>
);
export const ShrinkIcon = (p: IconProps) => (
  <Base {...p}>
    <path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" />
  </Base>
);
export const CloseIcon = (p: IconProps) => (
  <Base {...p}>
    <path d="M6 6l12 12M18 6 6 18" />
  </Base>
);
export const ChevronLeftIcon = (p: IconProps) => (
  <Base {...p}>
    <path d="m14.5 6-6 6 6 6" />
  </Base>
);
export const ChevronRightIcon = (p: IconProps) => (
  <Base {...p}>
    <path d="m9.5 6 6 6-6 6" />
  </Base>
);
export const ChevronUpIcon = (p: IconProps) => (
  <Base {...p}>
    <path d="m6 14.5 6-6 6 6" />
  </Base>
);
export const ChevronDownIcon = (p: IconProps) => (
  <Base {...p}>
    <path d="m6 9.5 6 6 6-6" />
  </Base>
);
/** Points "forward" in RTL reading order (towards the left). */
export const ArrowForwardIcon = (p: IconProps) => (
  <Base {...p}>
    <path d="M19 12H5m0 0 5.5-5.5M5 12l5.5 5.5" />
  </Base>
);
export const ArrowBackIcon = (p: IconProps) => (
  <Base {...p}>
    <path d="M5 12h14m0 0-5.5-5.5M19 12l-5.5 5.5" />
  </Base>
);
export const ArrowUpLeftIcon = (p: IconProps) => (
  <Base {...p}>
    <path d="M17 17 7 7m0 0v8m0-8h8" />
  </Base>
);
export const ArrowUpIcon = (p: IconProps) => (
  <Base {...p}>
    <path d="M12 19V5m0 0-6 6m6-6 6 6" />
  </Base>
);
export const CheckIcon = (p: IconProps) => (
  <Base {...p}>
    <path d="m5 12.5 4.5 4.5L19 7.5" />
  </Base>
);
export const MenuIcon = (p: IconProps) => (
  <Base {...p}>
    <path d="M4 8h16M4 16h10" />
  </Base>
);
export const MapPinIcon = (p: IconProps) => (
  <Base {...p}>
    <path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11Z" />
    <circle cx="12" cy="10" r="2.3" />
  </Base>
);
export const CalendarIcon = (p: IconProps) => (
  <Base {...p}>
    <rect x="4" y="5" width="16" height="15" rx="2.5" />
    <path d="M8 3v4M16 3v4M4 10h16" />
  </Base>
);
export const FilmIcon = (p: IconProps) => (
  <Base {...p}>
    <rect x="4" y="3" width="16" height="18" rx="2.5" />
    <path d="M8 3v18M16 3v18M4 8h4M4 12h4M4 16h4M16 8h4M16 12h4M16 16h4" />
  </Base>
);
export const GlobeIcon = (p: IconProps) => (
  <Base {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M3.5 12h17M12 3.5c2.3 2.4 3.5 5.2 3.5 8.5s-1.2 6.1-3.5 8.5c-2.3-2.4-3.5-5.2-3.5-8.5S9.7 5.9 12 3.5Z" />
  </Base>
);
export const MailIcon = (p: IconProps) => (
  <Base {...p}>
    <rect x="3.5" y="5.5" width="17" height="13" rx="2.5" />
    <path d="m4.5 7 7.5 6 7.5-6" />
  </Base>
);
export const PhoneIcon = (p: IconProps) => (
  <Base {...p}>
    <path d="M6.6 3.8h2.6l1.5 4-2 1.3a10.5 10.5 0 0 0 6.2 6.2l1.3-2 4 1.5v2.6a2 2 0 0 1-2.2 2A16.6 16.6 0 0 1 4.6 6a2 2 0 0 1 2-2.2Z" />
  </Base>
);
export const SendIcon = (p: IconProps) => (
  <Base {...p}>
    <path d="M20.5 3.5 10 14M20.5 3.5 14 20.5l-4-6.5-6.5-4z" />
  </Base>
);
export const SparkIcon = (p: IconProps) => (
  <Base {...p}>
    <path d="M12 3c.6 4.6 2.4 6.4 7 7-4.6.6-6.4 2.4-7 7-.6-4.6-2.4-6.4-7-7 4.6-.6 6.4-2.4 7-7Z" fill="currentColor" stroke="none" />
  </Base>
);
export const ApertureIcon = (p: IconProps) => (
  <Base {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M14.3 3.3 9.6 11.4M20.6 9.5h-9.3M18.5 17.6l-4.7-8.1M9.7 20.7l4.7-8.1M3.4 14.5h9.3M5.5 6.4l4.7 8.1" />
  </Base>
);
export const InstagramIcon = (p: IconProps) => (
  <Base {...p}>
    <rect x="3.5" y="3.5" width="17" height="17" rx="5" />
    <circle cx="12" cy="12" r="4" />
    <circle cx="17.2" cy="6.8" r="1" fill="currentColor" stroke="none" />
  </Base>
);
export const WhatsappIcon = (p: IconProps) => (
  <Base {...p}>
    <path d="M4.2 19.8 5.3 16A8.3 8.3 0 1 1 8.4 19l-4.2.8Z" />
    <path d="M9.2 8.6c.2-.5.5-.5.8-.5h.5c.2 0 .4.1.5.4l.7 1.6c.1.2 0 .5-.1.6l-.5.6c-.1.1-.1.3 0 .5a6 6 0 0 0 2.6 2.4c.2.1.4.1.5 0l.6-.7c.2-.2.4-.2.6-.1l1.6.8c.2.1.3.3.3.5 0 .5-.2 1.2-.8 1.5-.6.3-1.5.4-3.3-.4a8.5 8.5 0 0 1-3.6-3.4c-.6-1.1-.6-2.3-.4-2.8Z" fill="currentColor" stroke="none" />
  </Base>
);
export const TiktokIcon = (p: IconProps) => (
  <Base {...p}>
    <path d="M14 3.5v11.2a3.8 3.8 0 1 1-3.8-3.8M14 3.5c.4 2.6 2.2 4.4 5 4.6" />
  </Base>
);
export const YoutubeIcon = (p: IconProps) => (
  <Base {...p}>
    <rect x="2.8" y="5.5" width="18.4" height="13" rx="4" />
    <path d="m10.3 9.4 4.4 2.6-4.4 2.6z" fill="currentColor" stroke="none" />
  </Base>
);
export const SnapchatIcon = (p: IconProps) => (
  <Base {...p}>
    <path d="M12 3.6c2.9 0 4.6 2.1 4.6 4.8v2.2l1.6-.4c.5 0 .8.6.3.9l-1.8 1c.4 1.4 1.6 2.6 3.1 3.1-.3.7-1.4 1-2.4 1.1l-.4 1.3-1.7-.2c-1.2.8-2.1 1.5-3.3 1.5s-2.1-.7-3.3-1.5l-1.7.2-.4-1.3c-1-.1-2.1-.4-2.4-1.1 1.5-.5 2.7-1.7 3.1-3.1l-1.8-1c-.5-.3-.2-.9.3-.9l1.6.4V8.4c0-2.7 1.7-4.8 4.6-4.8Z" />
  </Base>
);
