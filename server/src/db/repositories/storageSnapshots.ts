import { getDatabase } from '../index';
import logger from '../../utils/logger';

export interface StorageSnapshot {
  id: number;
  total_size: number;
  movie_size: number;
  show_size: number;
  item_count: number;
  movie_count: number;
  show_count: number;
  space_reclaimed: number;
  captured_at: string;
}

/**
 * Capture a snapshot of current storage stats
 */
export function capture(): StorageSnapshot {
  const db = getDatabase();

  // Get size totals by type
  const sizeStmt = db.prepare<[], { type: string; total_size: number; count: number }>(`
    SELECT type, COALESCE(SUM(file_size), 0) as total_size, COUNT(*) as count
    FROM media_items
    WHERE status != 'deleted'
    GROUP BY type
  `);
  const sizeRows = sizeStmt.all();

  let totalSize = 0;
  let movieSize = 0;
  let showSize = 0;
  let itemCount = 0;
  let movieCount = 0;
  let showCount = 0;

  for (const row of sizeRows) {
    totalSize += row.total_size;
    itemCount += row.count;
    if (row.type === 'movie') {
      movieSize = row.total_size;
      movieCount = row.count;
    } else if (row.type === 'show') {
      showSize = row.total_size;
      showCount = row.count;
    }
  }

  // Get space reclaimed today
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const reclaimedStmt = db.prepare<[string], { total: number | null }>(
    'SELECT COALESCE(SUM(file_size), 0) as total FROM deletion_history WHERE deleted_at >= ?'
  );
  const spaceReclaimed = reclaimedStmt.get(todayStart.toISOString())?.total ?? 0;

  const insertStmt = db.prepare<[number, number, number, number, number, number, number], StorageSnapshot>(`
    INSERT INTO storage_snapshots (total_size, movie_size, show_size, item_count, movie_count, show_count, space_reclaimed)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  insertStmt.run(totalSize, movieSize, showSize, itemCount, movieCount, showCount, spaceReclaimed);

  const lastId = db.prepare<[], { id: number }>('SELECT last_insert_rowid() as id').get()!.id;
  const snapshot = db.prepare<[number], StorageSnapshot>('SELECT * FROM storage_snapshots WHERE id = ?').get(lastId)!;

  logger.info(`Storage snapshot captured: ${itemCount} items, ${(totalSize / (1024 * 1024 * 1024)).toFixed(2)} GB`);
  return snapshot;
}

/**
 * Get snapshot history for the last N days
 */
export function getHistory(days: number = 30): StorageSnapshot[] {
  const db = getDatabase();
  const since = new Date();
  since.setDate(since.getDate() - days);

  const stmt = db.prepare<[string], StorageSnapshot>(
    'SELECT * FROM storage_snapshots WHERE captured_at >= ? ORDER BY captured_at ASC'
  );
  return stmt.all(since.toISOString());
}

/**
 * Check if a snapshot exists for today
 */
export function hasTodaySnapshot(): boolean {
  const db = getDatabase();
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const stmt = db.prepare<[string], { count: number }>(
    'SELECT COUNT(*) as count FROM storage_snapshots WHERE captured_at >= ?'
  );
  const result = stmt.get(todayStart.toISOString());
  return (result?.count ?? 0) > 0;
}

/**
 * Delete snapshots older than N days
 */
export function pruneOld(keepDays: number = 90): number {
  const db = getDatabase();
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - keepDays);

  const stmt = db.prepare<[string]>('DELETE FROM storage_snapshots WHERE captured_at < ?');
  const result = stmt.run(cutoff.toISOString());
  if (result.changes > 0) {
    logger.info(`Pruned ${result.changes} old storage snapshots`);
  }
  return result.changes;
}

export default {
  capture,
  getHistory,
  hasTodaySnapshot,
  pruneOld,
};
