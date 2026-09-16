import { getDatabase } from '../index';
import logger from '../../utils/logger';

/**
 * A queued episode deletion.
 *
 * Shows are a single row in media_items, so episode- and season-level
 * deletions get their own queue. Season deletions are expanded into one row
 * per episode when queued, so any single episode can be cancelled later.
 */
export interface EpisodeDeletion {
  id: number;
  media_item_id: number;
  series_id: number;
  season_number: number;
  episode_number: number;
  episode_id: number;
  episode_file_id: number | null;
  series_title: string;
  episode_title: string;
  file_size: number;
  deletion_action: string;
  status: 'pending' | 'completed' | 'failed';
  marked_at: string;
  delete_after: string;
  completed_at: string | null;
  error: string | null;
}

export interface NewEpisodeDeletion {
  media_item_id: number;
  series_id: number;
  season_number: number;
  episode_number: number;
  episode_id: number;
  episode_file_id?: number | null;
  series_title: string;
  episode_title: string;
  file_size?: number;
  deletion_action: string;
  delete_after: string;
}

/**
 * Queue a batch of episodes. Episodes already pending are left as they are
 * (the partial unique index makes the insert a no-op), so re-queueing a season
 * never duplicates rows or resets a grace period that is already running.
 */
export function createMany(entries: NewEpisodeDeletion[]): EpisodeDeletion[] {
  if (entries.length === 0) return [];
  const db = getDatabase();

  const stmt = db.prepare(`
    INSERT OR IGNORE INTO episode_deletions
      (media_item_id, series_id, season_number, episode_number, episode_id, episode_file_id,
       series_title, episode_title, file_size, deletion_action, delete_after)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertMany = db.transaction((items: NewEpisodeDeletion[]) => {
    const ids: number[] = [];
    for (const item of items) {
      const result = stmt.run(
        item.media_item_id,
        item.series_id,
        item.season_number,
        item.episode_number,
        item.episode_id,
        item.episode_file_id ?? null,
        item.series_title,
        item.episode_title,
        item.file_size ?? 0,
        item.deletion_action,
        item.delete_after
      );
      if (result.changes > 0) ids.push(Number(result.lastInsertRowid));
    }
    return ids;
  });

  const insertedIds = insertMany(entries);
  if (insertedIds.length === 0) return [];

  const placeholders = insertedIds.map(() => '?').join(', ');
  return db
    .prepare(`SELECT * FROM episode_deletions WHERE id IN (${placeholders})`)
    .all(...insertedIds) as EpisodeDeletion[];
}

export function getById(id: number): EpisodeDeletion | null {
  const db = getDatabase();
  const row = db.prepare('SELECT * FROM episode_deletions WHERE id = ?').get(id) as
    | EpisodeDeletion
    | undefined;
  return row ?? null;
}

/** Pending rows for one show, oldest deadline first. */
export function getPendingForItem(mediaItemId: number): EpisodeDeletion[] {
  const db = getDatabase();
  return db
    .prepare(
      `SELECT * FROM episode_deletions
       WHERE media_item_id = ? AND status = 'pending'
       ORDER BY season_number, episode_number`
    )
    .all(mediaItemId) as EpisodeDeletion[];
}

/** Every pending row across all shows, soonest deadline first. */
export function getAllPending(): EpisodeDeletion[] {
  const db = getDatabase();
  return db
    .prepare(`SELECT * FROM episode_deletions WHERE status = 'pending' ORDER BY delete_after ASC`)
    .all() as EpisodeDeletion[];
}

/** Pending rows whose grace period has expired. */
export function getDue(now: Date = new Date()): EpisodeDeletion[] {
  const db = getDatabase();
  return db
    .prepare(
      `SELECT * FROM episode_deletions
       WHERE status = 'pending' AND delete_after <= ?
       ORDER BY delete_after ASC`
    )
    .all(now.toISOString()) as EpisodeDeletion[];
}

/** Cancel queued rows by their queue id. Returns how many were removed. */
export function cancelByIds(ids: number[]): number {
  if (ids.length === 0) return 0;
  const db = getDatabase();
  const placeholders = ids.map(() => '?').join(', ');
  const result = db
    .prepare(`DELETE FROM episode_deletions WHERE status = 'pending' AND id IN (${placeholders})`)
    .run(...ids);
  return result.changes;
}

/** Cancel queued rows for a show by Sonarr episode id. Returns how many were removed. */
export function cancelByEpisodeIds(mediaItemId: number, episodeIds: number[]): number {
  if (episodeIds.length === 0) return 0;
  const db = getDatabase();
  const placeholders = episodeIds.map(() => '?').join(', ');
  const result = db
    .prepare(
      `DELETE FROM episode_deletions
       WHERE status = 'pending' AND media_item_id = ? AND episode_id IN (${placeholders})`
    )
    .run(mediaItemId, ...episodeIds);
  return result.changes;
}

export function markCompleted(id: number, freedBytes: number): void {
  const db = getDatabase();
  db.prepare(
    `UPDATE episode_deletions
     SET status = 'completed', completed_at = datetime('now'), file_size = ?, error = NULL
     WHERE id = ?`
  ).run(freedBytes, id);
}

export function markFailed(id: number, error: string): void {
  const db = getDatabase();
  db.prepare(
    `UPDATE episode_deletions SET status = 'failed', error = ? WHERE id = ?`
  ).run(error.slice(0, 500), id);
}

/**
 * Drop rows for episodes Sonarr no longer knows about, so a queue entry can't
 * outlive the episode it points at (series removed, file re-imported, etc.).
 */
export function pruneMissingEpisodes(mediaItemId: number, knownEpisodeIds: number[]): number {
  const db = getDatabase();
  if (knownEpisodeIds.length === 0) {
    const result = db
      .prepare(`DELETE FROM episode_deletions WHERE status = 'pending' AND media_item_id = ?`)
      .run(mediaItemId);
    if (result.changes > 0) {
      logger.info(`Pruned ${result.changes} stale episode deletion(s) for item ${mediaItemId}`);
    }
    return result.changes;
  }

  const placeholders = knownEpisodeIds.map(() => '?').join(', ');
  const result = db
    .prepare(
      `DELETE FROM episode_deletions
       WHERE status = 'pending' AND media_item_id = ? AND episode_id NOT IN (${placeholders})`
    )
    .run(mediaItemId, ...knownEpisodeIds);
  if (result.changes > 0) {
    logger.info(`Pruned ${result.changes} stale episode deletion(s) for item ${mediaItemId}`);
  }
  return result.changes;
}

export default {
  createMany,
  getById,
  getPendingForItem,
  getAllPending,
  getDue,
  cancelByIds,
  cancelByEpisodeIds,
  markCompleted,
  markFailed,
  pruneMissingEpisodes,
};
