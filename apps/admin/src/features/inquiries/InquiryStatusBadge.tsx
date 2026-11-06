import type { ReactNode } from 'react';
import { Archive, BadgeCheck, CircleDot, PhoneCall } from 'lucide-react';
import type { InquiryStatus } from '@s5y/shared';
import { INQUIRY_STATUS_LABELS } from '../../lib/format';
import { Badge, type Tone } from '../../components/ui/misc';

export const INQUIRY_TONES: Record<InquiryStatus, Tone> = {
  NEW: 'accent',
  CONTACTED: 'info',
  WON: 'success',
  ARCHIVED: 'neutral',
};

export const INQUIRY_ICONS = {
  NEW: <CircleDot />,
  CONTACTED: <PhoneCall />,
  WON: <BadgeCheck />,
  ARCHIVED: <Archive />,
} satisfies Record<InquiryStatus, ReactNode>;

export function InquiryStatusBadge({ status, className }: { status: InquiryStatus; className?: string; 'aria-label'?: string }) {
  return (
    <Badge tone={INQUIRY_TONES[status]} icon={INQUIRY_ICONS[status]} className={className}>
      {INQUIRY_STATUS_LABELS[status]}
    </Badge>
  );
}
