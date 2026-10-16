import { useState } from 'react';
import { Film } from 'lucide-react';
import type { AdminVideo, VideoStatus } from '@s5y/shared';
import { CircleAlert, CircleCheck, CloudUpload, LoaderCircle } from 'lucide-react';
import { cn } from '../../lib/cn';
import { VIDEO_STATUS_LABELS } from '../../lib/format';
import { Badge, type Tone } from '../../components/ui/misc';

/** Poster thumbnail with a graceful placeholder (also covers broken image URLs). */
export function VideoThumb({ video, className }: { video: Pick<AdminVideo, 'posterUrl' | 'title'>; className?: string }) {
  const [broken, setBroken] = useState(false);
  return (
    <span className={cn('relative block shrink-0 overflow-hidden bg-surface-3', className)}>
      {video.posterUrl && !broken ? (
        <img
          src={video.posterUrl}
          alt=""
          loading="lazy"
          decoding="async"
          onError={() => setBroken(true)}
          className="absolute inset-0 size-full object-cover"
        />
      ) : (
        <span className="absolute inset-0 grid place-items-center bg-[linear-gradient(160deg,#1e1e23,#101013)] text-subtle">
          <Film className="size-1/3 max-h-5 max-w-5" aria-hidden />
        </span>
      )}
    </span>
  );
}

const STATUS_TONE: Record<VideoStatus, Tone> = {
  UPLOADING: 'warning',
  PROCESSING: 'info',
  READY: 'success',
  FAILED: 'danger',
};

export function VideoStatusBadge({ status, className }: { status: VideoStatus; className?: string }) {
  const icon =
    status === 'READY' ? (
      <CircleCheck />
    ) : status === 'PROCESSING' ? (
      <LoaderCircle className="animate-spin" />
    ) : status === 'FAILED' ? (
      <CircleAlert />
    ) : (
      <CloudUpload />
    );
  return (
    <Badge tone={STATUS_TONE[status]} icon={icon} className={className}>
      {VIDEO_STATUS_LABELS[status]}
    </Badge>
  );
}
