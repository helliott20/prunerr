import type { SonarrEpisodeSummary, SonarrSeasonSummary } from '@/types';

/** Episode states the Sonarr panel lets you narrow the season tree down to. */
export type EpisodeFilter = 'all' | 'missing' | 'downloading' | 'upgradable';

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
    return Boolean(episode.file?.qualityCutoffNotMet);
  };

  return seasons
    .map((season) => ({ season, episodes: season.episodes.filter(matches) }))
    .filter(({ episodes }) => episodes.length > 0);
}
