import type { MediaItem } from '../types';
import logger from '../utils/logger';

interface RadarrLookup {
  getMovieByTmdbId(tmdbId: number): Promise<{ id: number } | null>;
  getMovieByImdbId(imdbId: string): Promise<{ id: number } | null>;
}

interface SonarrLookup {
  getSeriesByTvdbId(tvdbId: number): Promise<{ id: number } | null>;
  getSeriesByImdbId(imdbId: string): Promise<{ id: number } | null>;
  getSeriesByTmdbId?(tmdbId: number): Promise<{ id: number } | null>;
}

/** One instance to search, tagged with its id so a match records where it came from. */
export type InstanceLookup<T> = T & { instanceId: string };

/**
 * Lookups used to find an item's Sonarr/Radarr entry by external id. Each
 * returns null when there is no match or the call fails.
 *
 * Either a single client (one instance, no id recorded) or a list of
 * instances, searched in order; the first that has the item wins.
 */
export interface ArrLookups {
  radarr?: RadarrLookup | InstanceLookup<RadarrLookup>[] | null;
  sonarr?: SonarrLookup | InstanceLookup<SonarrLookup>[] | null;
}

type LinkableItem = Pick<
  MediaItem,
  'id' | 'title' | 'type' | 'sonarr_id' | 'radarr_id' | 'tmdb_id' | 'imdb_id' | 'tvdb_id'
> & { arr_instance?: string | null };

export interface ArrLinkUpdate {
  radarr_id?: number;
  sonarr_id?: number;
  arr_instance?: string;
}

function asList<T>(lookup: T | InstanceLookup<T>[] | null | undefined): Array<{ instanceId?: string; lookup: T }> {
  if (!lookup) return [];
  if (Array.isArray(lookup)) return lookup.map((l) => ({ instanceId: l.instanceId, lookup: l }));
  return [{ lookup }];
}

async function findMovie(item: LinkableItem, radarr: RadarrLookup): Promise<{ id: number } | null> {
  let movie: { id: number } | null = null;
  if (item.tmdb_id) movie = await radarr.getMovieByTmdbId(item.tmdb_id);
  if (!movie && item.imdb_id) movie = await radarr.getMovieByImdbId(item.imdb_id);
  return movie?.id ? movie : null;
}

async function findSeries(item: LinkableItem, sonarr: SonarrLookup): Promise<{ id: number } | null> {
  let series: { id: number } | null = null;
  if (item.tvdb_id) series = await sonarr.getSeriesByTvdbId(item.tvdb_id);
  if (!series && item.tmdb_id && sonarr.getSeriesByTmdbId) {
    series = await sonarr.getSeriesByTmdbId(item.tmdb_id);
  }
  if (!series && item.imdb_id) series = await sonarr.getSeriesByImdbId(item.imdb_id);
  return series?.id ? series : null;
}

/**
 * Find the Sonarr/Radarr id for an item the last scan didn't link.
 *
 * The scan links items by the ids the media server reports, and only when it
 * could read Sonarr/Radarr at that moment. A movie added to Radarr after the
 * scan, a scan whose Radarr fetch failed, or a media server reporting ids the
 * scan couldn't parse all leave `radarr_id` empty even though Radarr has the
 * movie. Asking Sonarr/Radarr directly at delete time closes that gap.
 *
 * With several instances each is asked in turn; one that fails to answer
 * doesn't stop the others being asked.
 *
 * Returns the ids found (to be saved on the item), or null when there is
 * nothing to add.
 */
export async function resolveArrLink(item: LinkableItem, lookups: ArrLookups): Promise<ArrLinkUpdate | null> {
  if (item.type === 'movie' && !item.radarr_id) {
    for (const { instanceId, lookup } of asList(lookups.radarr)) {
      try {
        const movie = await findMovie(item, lookup);
        if (movie) {
          logger.info(`Linked "${item.title}" to Radarr movie ${movie.id}${instanceId ? ` (${instanceId})` : ''} at delete time`);
          return { radarr_id: movie.id, ...(instanceId ? { arr_instance: instanceId } : {}) };
        }
      } catch (error) {
        logger.warn(`Could not look up "${item.title}" in Radarr${instanceId ? ` (${instanceId})` : ''}`, {
          message: (error as Error).message,
        });
      }
    }
  }

  if (item.type === 'show' && !item.sonarr_id) {
    for (const { instanceId, lookup } of asList(lookups.sonarr)) {
      try {
        const series = await findSeries(item, lookup);
        if (series) {
          logger.info(`Linked "${item.title}" to Sonarr series ${series.id}${instanceId ? ` (${instanceId})` : ''} at delete time`);
          return { sonarr_id: series.id, ...(instanceId ? { arr_instance: instanceId } : {}) };
        }
      } catch (error) {
        logger.warn(`Could not look up "${item.title}" in Sonarr${instanceId ? ` (${instanceId})` : ''}`, {
          message: (error as Error).message,
        });
      }
    }
  }
  return null;
}

/**
 * An item linked to an instance that is no longer configured, with that link
 * dropped so it can be looked up again in the instances that are. Returns the
 * item unchanged when its link is fine (or it has none).
 */
export function withoutStaleLink<T extends LinkableItem>(item: T, configuredIds: Set<string>, linkedId: string | null): T {
  if (!linkedId || configuredIds.has(linkedId)) return item;
  return { ...item, sonarr_id: null, radarr_id: null, arr_instance: null };
}
