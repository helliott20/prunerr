import type { MediaServerType } from '@/types';
import { cn } from '@/lib/utils';

/**
 * Brand marks for the three supported media servers, inlined as SVG so they
 * need no network request and render identically in light and dark themes.
 *
 * These are simplified geometric marks in each project's brand colour, not the
 * official trademarked artwork — enough to identify a backend at a glance in
 * the picker without shipping third-party brand files.
 */

interface MarkProps {
  className?: string;
  size?: number;
}

function PlexMark({ className, size = 18 }: MarkProps) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} role="img" aria-hidden className={className}>
      <rect width="24" height="24" rx="5" fill="#E5A00D" />
      <path d="M8.6 5.4h4.3l5.1 6.6-5.1 6.6H8.6l5.1-6.6-5.1-6.6Z" fill="#1F1B16" />
    </svg>
  );
}

function JellyfinMark({ className, size = 18 }: MarkProps) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} role="img" aria-hidden className={className}>
      <defs>
        <linearGradient id="prunerr-jellyfin" x1="0" y1="24" x2="24" y2="0">
          <stop offset="0%" stopColor="#AA5CC3" />
          <stop offset="100%" stopColor="#00A4DC" />
        </linearGradient>
      </defs>
      <path
        d="M12 3.2c1 0 6.6 9.9 6.1 11.4-.5 1.4-11.7 1.4-12.2 0C5.4 13.1 11 3.2 12 3.2Z"
        fill="url(#prunerr-jellyfin)"
        opacity="0.55"
      />
      <path
        d="M12 9.4c.7 0 4.5 6.7 4.1 7.7-.3 1-7.9 1-8.2 0-.4-1 3.4-7.7 4.1-7.7Z"
        fill="url(#prunerr-jellyfin)"
      />
    </svg>
  );
}

function EmbyMark({ className, size = 18 }: MarkProps) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} role="img" aria-hidden className={className}>
      <path d="M12 2.2 21.8 12 12 21.8 2.2 12 12 2.2Z" fill="#52B54B" />
      <path d="M10.2 8.1 16 12l-5.8 3.9V8.1Z" fill="#0B1E0A" />
    </svg>
  );
}

const MARKS: Record<MediaServerType, (props: MarkProps) => JSX.Element> = {
  plex: PlexMark,
  jellyfin: JellyfinMark,
  emby: EmbyMark,
};

export function MediaServerLogo({
  type,
  className,
  size = 18,
}: {
  type: MediaServerType;
  className?: string;
  size?: number;
}) {
  const Mark = MARKS[type];
  return <Mark className={cn('shrink-0', className)} size={size} />;
}

export { PlexMark, JellyfinMark, EmbyMark };
