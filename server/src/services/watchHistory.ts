/**
 * WatchHistoryProvider interface
 *
 * Abstraction over watch history services (Tautulli, Tracearr, etc.)
 * so the scanner can work with any provider.
 */

export interface WatchedStatus {
  playCount: number;
  lastWatched: Date | null;
  watchedBy: string[];
  /** Shows only: distinct episodes anyone has watched, when the provider knows. */
  episodesWatched?: number;
}

export interface WatchHistoryProvider {
  /** Test the connection to the watch history service */
  testConnection(): Promise<boolean>;

  /** Get watched status for a single item (movie or episode) by its Plex ratingKey */
  getItemWatchedStatus(ratingKey: string): Promise<WatchedStatus>;

  /** Get aggregated watched status for a TV show by its Plex ratingKey and/or title */
  getShowWatchedStatus(showRatingKey: string, showTitle?: string): Promise<WatchedStatus>;

  /** Clear any cached data (called after each scan) */
  clearCache?(): void;
}

/**
 * Distinct episodes watched, from a show's cached history entries. Entries
 * keyed to the show itself (rather than an episode) say nothing about how far
 * through the series anyone is, so they are left out.
 */
export function countWatchedEpisodes(
  entries: ReadonlyArray<{ plex_rating_key: string; watched: boolean }>,
  showRatingKey: string
): number {
  const episodes = new Set<string>();
  for (const entry of entries) {
    if (entry.watched && entry.plex_rating_key !== showRatingKey) episodes.add(entry.plex_rating_key);
  }
  return episodes.size;
}
