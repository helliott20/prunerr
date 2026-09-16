import type { ActivityLogEntry, SonarrHistoryEvent, SonarrHistoryEventType } from '@/types';

/**
 * A timeline row. Real activity entries and the synthetic ones we derive from
 * Sonarr history render through the same path, so the event type is widened to
 * a plain string here.
 */
export type TimelineEntry = Omit<ActivityLogEntry, 'eventType'> & { eventType: string };

/** One episode line inside a grouped row. */
export interface EpisodeDetailLine {
  code: string;
  title: string;
  meta?: string;
}

/** Sonarr history events that happened within this window group into one row. */
const GROUP_WINDOW_MS = 6 * 60 * 60 * 1000;

const ACTION_BY_EVENT: Record<SonarrHistoryEventType, string> = {
  grabbed: 'episodes_grabbed',
  imported: 'episodes_imported',
  upgraded: 'episodes_upgraded',
  deleted: 'episodes_removed_in_sonarr',
  failed: 'episodes_failed',
};

function episodeCode(seasonNumber: number, episodeNumber: number): string {
  return `S${String(seasonNumber).padStart(2, '0')}E${String(episodeNumber).padStart(2, '0')}`;
}

/**
 * Group Sonarr history into timeline rows.
 *
 * A season that imports over an afternoon becomes one row of "8 episodes
 * imported" rather than eight near-identical lines; the episodes themselves
 * stay in the metadata so the row can be expanded.
 *
 * Events must be newest first (the API returns them that way).
 */
export function buildEpisodeHistoryEntries(
  events: SonarrHistoryEvent[],
  windowMs: number = GROUP_WINDOW_MS
): TimelineEntry[] {
  const entries: TimelineEntry[] = [];
  let current: { eventType: SonarrHistoryEventType; events: SonarrHistoryEvent[] } | null = null;

  const flush = () => {
    if (!current) return;
    const [newest] = current.events;
    if (!newest) return;

    entries.push({
      // Synthetic rows never collide with real activity ids, which are positive.
      id: -1_000_000 - entries.length,
      eventType: 'sonarr_history',
      action: ACTION_BY_EVENT[current.eventType],
      actorType: 'scheduler',
      actorId: null,
      actorName: 'Sonarr',
      targetType: null,
      targetId: null,
      targetTitle: null,
      metadata: {
        count: current.events.length,
        episodes: current.events.map((event) => ({
          code: episodeCode(event.seasonNumber, event.episodeNumber),
          title: event.episodeTitle,
          quality: event.quality,
        })),
      },
      createdAt: newest.date,
    });
    current = null;
  };

  for (const event of events) {
    if (
      current &&
      current.eventType === event.eventType &&
      Math.abs(
        new Date(current.events[current.events.length - 1]!.date).getTime() -
          new Date(event.date).getTime()
      ) <= windowMs
    ) {
      current.events.push(event);
      continue;
    }

    flush();
    current = { eventType: event.eventType, events: [event] };
  }
  flush();

  return entries;
}

/**
 * Pull the per-episode lines out of an entry's metadata, for both our own
 * grouped entries (queued/deleted) and the synthetic Sonarr ones.
 */
export function episodeDetailLines(
  entry: TimelineEntry,
  formatSize: (bytes: number) => string
): EpisodeDetailLine[] {
  const episodes = entry.metadata?.['episodes'];
  if (!Array.isArray(episodes)) return [];

  return episodes.flatMap((raw) => {
    if (!raw || typeof raw !== 'object') return [];
    const episode = raw as { code?: unknown; title?: unknown; size?: unknown; quality?: unknown };
    if (typeof episode.code !== 'string') return [];

    const meta =
      typeof episode.quality === 'string'
        ? episode.quality
        : typeof episode.size === 'number' && episode.size > 0
          ? formatSize(episode.size)
          : undefined;

    return [
      {
        code: episode.code,
        title: typeof episode.title === 'string' ? episode.title : '',
        ...(meta ? { meta } : {}),
      },
    ];
  });
}

/** How many episodes an entry covers, for the count shown on the row. */
export function episodeCount(entry: TimelineEntry): number {
  const count = entry.metadata?.['count'];
  if (typeof count === 'number') return count;
  const episodes = entry.metadata?.['episodes'];
  return Array.isArray(episodes) ? episodes.length : 0;
}
