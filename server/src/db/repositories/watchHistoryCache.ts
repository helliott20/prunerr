import { getDatabase } from '../index';
import logger from '../../utils/logger';

export interface WatchHistoryCacheEntry {
  id: number;
  plex_rating_key: string;
  username: string;
  watched: boolean;
  stopped_at: string;
  session_id: string | null;
  media_title: string | null;
  media_type: string | null;
  show_title: string | null;
  created_at: string;
}

interface WatchHistoryCacheRow {
  id: number;
  plex_rating_key: string;
  username: string;
  watched: number;
  stopped_at: string;
  session_id: string | null;
  media_title: string | null;
  media_type: string | null;
  show_title: string | null;
  created_at: string;
}

/**
 * Insert a batch of watch history entries, skipping duplicates by session_id
 */
export function insertBatch(entries: Array<{
  plex_rating_key: string;
  username: string;
  watched: boolean;
  stopped_at: string;
  session_id: string | null;
  media_title: string | null;
  media_type: string | null;
  show_title: string | null;
}>): number {
  if (entries.length === 0) return 0;
  const db = getDatabase();

  const stmt = db.prepare(`
    INSERT OR IGNORE INTO watch_history_cache
      (plex_rating_key, username, watched, stopped_at, session_id, media_title, media_type, show_title)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertMany = db.transaction((items: typeof entries) => {
    let inserted = 0;
    for (const item of items) {
      const result = stmt.run(
        item.plex_rating_key,
        item.username,
        item.watched ? 1 : 0,
        item.stopped_at,
        item.session_id,
        item.media_title,
        item.media_type,
        item.show_title,
      );
      if (result.changes > 0) inserted++;
    }
    return inserted;
  });

  const inserted = insertMany(entries);
  if (inserted > 0) {
    logger.debug(`Inserted ${inserted} new watch history cache entries`);
  }
  return inserted;
}

/**
 * Get watch history for a specific item by plex rating key
 */
export function getByRatingKey(ratingKey: string): WatchHistoryCacheEntry[] {
  const db = getDatabase();
  const stmt = db.prepare<[string], WatchHistoryCacheRow>(
    'SELECT * FROM watch_history_cache WHERE plex_rating_key = ? ORDER BY stopped_at DESC'
  );
  return stmt.all(ratingKey).map(mapRow);
}

/**
 * Get watch history for all episodes of a show by show title
 */
export function getByShowTitle(showTitle: string): WatchHistoryCacheEntry[] {
  const db = getDatabase();
  const stmt = db.prepare<[string], WatchHistoryCacheRow>(
    'SELECT * FROM watch_history_cache WHERE LOWER(show_title) = LOWER(?) ORDER BY stopped_at DESC'
  );
  return stmt.all(showTitle).map(mapRow);
}

/**
 * Get the most recent stopped_at timestamp in the cache
 */
export function getLatestTimestamp(): string | null {
  const db = getDatabase();
  const stmt = db.prepare<[], { latest: string | null }>(
    'SELECT MAX(stopped_at) as latest FROM watch_history_cache'
  );
  return stmt.get()?.latest ?? null;
}

/**
 * Get total count of cached entries
 */
export function getCount(): number {
  const db = getDatabase();
  const stmt = db.prepare<[], { count: number }>('SELECT COUNT(*) as count FROM watch_history_cache');
  return stmt.get()?.count ?? 0;
}

/**
 * Prune entries older than the specified number of days
 */
export function pruneOlderThan(days: number): number {
  const db = getDatabase();
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  const stmt = db.prepare<[string]>('DELETE FROM watch_history_cache WHERE stopped_at < ?');
  const result = stmt.run(cutoff.toISOString());
  if (result.changes > 0) {
    logger.info(`Pruned ${result.changes} watch history cache entries older than ${days} days`);
  }
  return result.changes;
}

/**
 * Clear all cached entries
 */
export function clearAll(): number {
  const db = getDatabase();
  const result = db.prepare('DELETE FROM watch_history_cache').run();
  logger.info(`Cleared ${result.changes} watch history cache entries`);
  return result.changes;
}

function mapRow(row: WatchHistoryCacheRow): WatchHistoryCacheEntry {
  return {
    ...row,
    watched: row.watched === 1,
  };
}

export default {
  insertBatch,
  getByRatingKey,
  getByShowTitle,
  getLatestTimestamp,
  getCount,
  pruneOlderThan,
  clearAll,
};
