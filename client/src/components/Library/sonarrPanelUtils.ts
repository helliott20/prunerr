import type { SonarrEpisodeSummary, SonarrSeasonSummary } from '@/types';

/** Episode states the Sonarr panel lets you narrow the season tree down to. */
export type EpisodeFilter = 'all' | 'missing' | 'downloading' | 'upgradable' | 'queued';

export interface VisibleSeason {
  /** Unfiltered season: its counts and status strip always show the whole season. */
  season: SonarrSeasonSummary;
  /** Episodes to list under the season header. */
  episodes: SonarrEpisodeSummary[];
}

/**
 * Narrow the episodes listed under each season to the active filter, dropping
 * seasons with no match. The season itself is passed through untouched so the
 * header keeps showing real season totals rather than filtered ones.
 */
export function filterSeasons(
  seasons: SonarrSeasonSummary[],
  filter: EpisodeFilter
): VisibleSeason[] {
  if (filter === 'all') return seasons.map((season) => ({ season, episodes: season.episodes }));

  const matches = (episode: SonarrEpisodeSummary): boolean => {
    if (filter === 'missing') return episode.state === 'missing';
    if (filter === 'downloading') return episode.state === 'downloading';
    if (filter === 'queued') return Boolean(episode.queued);
    return Boolean(episode.file?.qualityCutoffNotMet);
  };

  return seasons
    .map((season) => ({ season, episodes: season.episodes.filter(matches) }))
    .filter(({ episodes }) => episodes.length > 0);
}

export interface SelectionSummary {
  /** Selected episodes that still exist in the current season tree. */
  episodeIds: number[];
  totalSize: number;
  queuedIds: number[];
}

/**
 * Describe the current selection: which episodes it covers, how much disk they
 * hold, and which of them are already queued (those can be cancelled instead).
 */
export function summariseSelection(
  seasons: SonarrSeasonSummary[],
  selected: Set<number>
): SelectionSummary {
  const summary: SelectionSummary = { episodeIds: [], totalSize: 0, queuedIds: [] };

  for (const season of seasons) {
    for (const episode of season.episodes) {
      if (!selected.has(episode.id)) continue;
      summary.episodeIds.push(episode.id);
      summary.totalSize += episode.file?.size ?? 0;
      if (episode.queued) summary.queuedIds.push(episode.id);
    }
  }

  return summary;
}
