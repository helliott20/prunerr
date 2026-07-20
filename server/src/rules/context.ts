import { getDatabase } from '../db/index';
import collectionsRepo from '../db/repositories/collections';
import logger from '../utils/logger';
import type { WatchLookup } from './conditions';
import type { EvaluationContext } from './engine';

/**
 * Build a ratingKey → username → Date lookup from the watch_history_cache.
 * Called once per preview/evaluation run.
 */
export function buildWatchLookup(): WatchLookup {
  const lookup: WatchLookup = new Map();
  try {
    // Snapshot the cache — pull all watched entries. For very large caches
    // this could be narrowed with a filter, but 100k rows is manageable.
    const db = getDatabase();
    const rows = db
      .prepare(
        'SELECT plex_rating_key, username, MAX(stopped_at) as stopped_at FROM watch_history_cache WHERE watched = 1 GROUP BY plex_rating_key, username'
      )
      .all() as Array<{ plex_rating_key: string; username: string; stopped_at: string }>;
    for (const r of rows) {
      let userMap = lookup.get(r.plex_rating_key);
      if (!userMap) {
        userMap = new Map();
        lookup.set(r.plex_rating_key, userMap);
      }
      userMap.set(r.username, new Date(r.stopped_at));
    }
  } catch (err) {
    logger.warn('Failed to build watch lookup:', err);
  }
  return lookup;
}

/**
 * The single place an EvaluationContext is assembled. Every caller that
 * evaluates rule conditions must go through here — a context missing its
 * watchLookup silently inverts watched_by/watched_by_user conditions
 * (`is_empty` reports true for every item), which previously made the
 * scheduled scan see the whole library as never-watched.
 */
export function buildEvaluationContext(): EvaluationContext {
  return {
    collectionsRepo,
    watchLookup: buildWatchLookup(),
    now: new Date(),
  };
}
