import type { AdminVideo } from '@s5y/shared';
import { formatBytes, formatDuration } from '../../lib/format';
import { isCrossOrigin } from '../../lib/site';
import { Dialog } from '../../components/ui/dialog';

/** Quick preview of the full-quality file. */
export function VideoPlayerDialog({ video, onClose }: { video: AdminVideo | null; onClose: () => void }) {
  const vertical = video?.width && video.height ? video.height >= video.width : true;
  return (
    <Dialog open={video !== null} onClose={onClose} title={video?.title || video?.originalName || 'معاينة الفيديو'} size={vertical ? 'sm' : 'xl'}>
      {video?.url ? (
        <div className="flex flex-col gap-3">
          <div className="overflow-hidden rounded-xl bg-black">
            <video
              key={video.id}
              src={video.url}
              poster={video.posterUrl ?? undefined}
              controls
              autoPlay
              playsInline
              crossOrigin={isCrossOrigin(video.url) ? 'anonymous' : undefined}
              className={vertical ? 'mx-auto max-h-[68dvh] w-auto' : 'aspect-video w-full'}
            />
          </div>
          <p className="num text-center text-xs text-muted" dir="ltr">
            {[video.width && video.height ? `${video.width}×${video.height}` : null, formatDuration(video.durationSec), formatBytes(video.sizeBytes)]
              .filter(Boolean)
              .join(' · ')}
          </p>
        </div>
      ) : (
        <p className="py-10 text-center text-sm text-muted">الفيديو بعده ما خلص رفع.</p>
      )}
    </Dialog>
  );
}
