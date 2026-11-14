import type { MediaItem } from '../types';
import logger from '../utils/logger';

/**
 * Lookups used to find an item's Sonarr/Radarr entry by external id. Each
 * returns null when there is no match or the call fails.
 */
export interface ArrLookups {
  radarr?: {
    getMovieByTmdbId(tmdbId: number): Promise<{ id: number } | null>;
    getMovieByImdbId(imdbId: string): Promise<{ id: number } | null>;
  } | null;
  sonarr?: {
    getSeriesByTvdbId(tvdbId: number): Promise<{ id: number } | null>;
    getSeriesByImdbId(imdbId: string): Promise<{ id: number } | null>;
  } | null;
}

type LinkableItem = Pick<
  MediaItem,
  'id' | 'title' | 'type' | 'sonarr_id' | 'radarr_id' | 'tmdb_id' | 'imdb_id' | 'tvdb_id'
>;

/**
 * Find the Sonarr/Radarr id for an item the last scan didn't link.
 *
 * The scan links items by the ids the media server reports, and only when it
 * could read Sonarr/Radarr at that moment. A movie added to Radarr after the
 * scan, a scan whose Radarr fetch failed, or a media server reporting ids the
 * scan couldn't parse all leave `radarr_id` empty even though Radarr has the
 * movie. Asking Sonarr/Radarr directly at delete time closes that gap.
 *
 * Returns the ids found (to be saved on the item), or null when there is
 * nothing to add.
 */
export async function resolveArrLink(
  item: LinkableItem,
  lookups: ArrLookups
): Promise<{ radarr_id?: number; sonarr_id?: number } | null> {
  try {
    if (item.type === 'movie' && !item.radarr_id && lookups.radarr) {
      let movie: { id: number } | null = null;
      if (item.tmdb_id) movie = await lookups.radarr.getMovieByTmdbId(item.tmdb_id);
      if (!movie && item.imdb_id) movie = await lookups.radarr.getMovieByImdbId(item.imdb_id);
      if (movie?.id) {
        logger.info(`Linked "${item.title}" to Radarr movie ${movie.id} at delete time`);
        return { radarr_id: movie.id };
      }
    }

    if (item.type === 'show' && !item.sonarr_id && lookups.sonarr) {
      let series: { id: number } | null = null;
      if (item.tvdb_id) series = await lookups.sonarr.getSeriesByTvdbId(item.tvdb_id);
      if (!series && item.imdb_id) series = await lookups.sonarr.getSeriesByImdbId(item.imdb_id);
      if (series?.id) {
        logger.info(`Linked "${item.title}" to Sonarr series ${series.id} at delete time`);
        return { sonarr_id: series.id };
      }
    }
  } catch (error) {
    logger.warn(`Could not look up "${item.title}" in Sonarr/Radarr`, {
      message: (error as Error).message,
    });
  }
  return null;
}
