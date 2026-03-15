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
