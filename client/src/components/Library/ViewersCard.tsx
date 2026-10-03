import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Users } from 'lucide-react';
import { Card } from '@/components/common/Card';
import { cn, formatDate, formatRelativeTime } from '@/lib/utils';

export type ViewerStatus = 'not_started' | 'in_progress' | 'stalled' | 'finished' | 'watched' | 'started';

export interface Viewer {
  user: string;
  /** Shows: distinct episodes they finished. */
  episodesWatched: number | null;
  lastWatched: string | null;
  status: ViewerStatus | null;
}

const STATUS_CLASS: Record<ViewerStatus, string> = {
  in_progress: 'bg-violet-500/15 text-violet-text border-violet-500/25',
  stalled: 'bg-surface-700/60 text-surface-300 border-surface-600/40',
  finished: 'bg-emerald-500/15 text-emerald-text border-emerald-500/25',
  watched: 'bg-emerald-500/15 text-emerald-text border-emerald-500/25',
  started: 'bg-surface-700/60 text-surface-300 border-surface-600/40',
  not_started: 'bg-surface-700/60 text-surface-400 border-surface-600/40',
};

function statusLabel(status: ViewerStatus, t: TFunction<'library'>): string {
  switch (status) {
    case 'in_progress': return t('viewers.status.inProgress', 'In progress');
    case 'stalled': return t('viewers.status.stalled', 'Stalled');
    case 'finished': return t('viewers.status.finished', 'Finished');
    case 'watched': return t('viewers.status.watched', 'Watched');
    case 'started': return t('viewers.status.started', 'Started');
    case 'not_started': return t('viewers.status.notStarted', 'Not started');
  }
}

/**
 * Who has watched an item and how far each person got. A show is protected
 * while anyone in this list is in progress, so this is also the "why".
 */
export function ViewersCard({
  viewers,
  episodeCount,
  isShow,
}: {
  viewers: Viewer[];
  episodeCount: number | null;
  isShow: boolean;
}) {
  const { t } = useTranslation('library');
  if (viewers.length === 0) return null;

  return (
    <Card className="p-6">
      <div className="flex items-center gap-2 mb-4">
        <Users className="w-4 h-4 text-surface-400" />
        <h2 className="text-sm font-semibold text-surface-300 uppercase tracking-wider">
          {t('viewers.title', "Who's watching")}
        </h2>
      </div>
      <ul className="divide-y divide-surface-700/40">
        {viewers.map((viewer) => (
          <li key={viewer.user} className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
            <div className="w-8 h-8 rounded-full bg-surface-700/80 flex items-center justify-center text-xs font-semibold text-surface-200 flex-shrink-0 uppercase">
              {viewer.user.slice(0, 1)}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm text-surface-100 truncate">{viewer.user}</p>
              <p className="text-xs text-surface-500">
                {isShow && viewer.episodesWatched !== null
                  ? episodeCount
                    ? t('viewers.episodesOf', '{{watched}} of {{total}} episodes', {
                        watched: Math.min(viewer.episodesWatched, episodeCount),
                        total: episodeCount,
                      })
                    : t('viewers.episodes', '{{watched}} episodes', { watched: viewer.episodesWatched })
                  : null}
                {isShow && viewer.episodesWatched !== null && viewer.lastWatched ? ' · ' : null}
                {viewer.lastWatched ? (
                  <span title={formatDate(viewer.lastWatched)}>
                    {t('viewers.lastWatched', 'last watched {{when}}', {
                      when: formatRelativeTime(viewer.lastWatched),
                    })}
                  </span>
                ) : null}
              </p>
            </div>
            {viewer.status && (
              <span
                className={cn(
                  'px-2 py-0.5 rounded-md border text-[11px] font-medium flex-shrink-0',
                  STATUS_CLASS[viewer.status]
                )}
              >
                {statusLabel(viewer.status, t)}
              </span>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}
