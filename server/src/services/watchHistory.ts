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
  /** Shows only: each person's progress, when the provider knows who watched. */
  episodeProgress?: EpisodeProgress;
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

/** The parts of a cached play that can identify which episode it was. */
export interface EpisodePlay {
  plex_rating_key: string;
  watched: boolean;
  media_type?: string | null;
  media_title?: string | null;
}

/**
 * Which episode a play was, as a stable key; null when it can't be told.
 *
 * The episode title comes first: Tracearr keys an episode's play to the
 * show's (or season's) artwork, so the rating key is shared across episodes
 * and can't be trusted for episode rows. The rating key is the fallback, and
 * only when it isn't the show's own. Two episodes sharing a title count once,
 * which can only make a show look less finished — the safe direction.
 */
export function episodeIdentity(play: EpisodePlay, showRatingKey: string): string | null {
  const title = play.media_title?.trim().toLowerCase();
  if (title && play.media_type !== 'movie') return `t:${title}`;
  if (play.plex_rating_key && play.plex_rating_key !== showRatingKey) return `k:${play.plex_rating_key}`;
  return null;
}

/** Distinct episodes of a show that were watched, from its cached plays. */
export function countWatchedEpisodes(entries: ReadonlyArray<EpisodePlay>, showRatingKey: string): number {
  const episodes = new Set<string>();
  for (const entry of entries) {
    if (!entry.watched) continue;
    const id = episodeIdentity(entry, showRatingKey);
    if (id) episodes.add(id);
  }
  return episodes.size;
}

/** One person's progress through a show. */
export interface PersonProgress {
  /** Distinct episodes they finished. */
  watched: number;
  /** Their latest play of any episode, finished or not (ISO). */
  lastWatched: string | null;
}

/** Progress through a show, keyed by username. */
export type EpisodeProgress = Record<string, PersonProgress>;

/** Each person's progress through a show, from its cached plays. */
export function episodeProgressByUser(
  entries: ReadonlyArray<EpisodePlay & { username: string; stopped_at: string }>,
  showRatingKey: string
): EpisodeProgress {
  const byUser = new Map<string, Array<EpisodePlay & { stopped_at: string }>>();
  for (const entry of entries) {
    if (!entry.username) continue;
    const list = byUser.get(entry.username) ?? [];
    list.push(entry);
    byUser.set(entry.username, list);
  }
  const progress: EpisodeProgress = {};
  for (const [user, plays] of byUser) {
    const latest = plays.reduce<string | null>(
      (max, p) => (!max || new Date(p.stopped_at) > new Date(max) ? p.stopped_at : max),
      null
    );
    progress[user] = {
      watched: countWatchedEpisodes(plays, showRatingKey),
      lastWatched: latest ? new Date(latest).toISOString() : null,
    };
  }
  return progress;
}
