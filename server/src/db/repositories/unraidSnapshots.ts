import { getDatabase } from '../index';
import logger from '../../utils/logger';

export interface UnraidCapacitySnapshot {
  id: number;
  total_bytes: number;
  used_bytes: number;
  free_bytes: number;
  captured_at: string;
}

export interface MonthlySample {
  month: string;
  usedBytes: number;
}

const BYTES_PER_TB = 1024 ** 4;

export function capture(input: { total: number; used: number; free: number }): UnraidCapacitySnapshot {
  const db = getDatabase();
  const insertStmt = db.prepare<[number, number, number]>(
    'INSERT INTO unraid_capacity_snapshots (total_bytes, used_bytes, free_bytes) VALUES (?, ?, ?)'
  );
  const result = insertStmt.run(input.total, input.used, input.free);
  const snapshot = db
    .prepare<[number], UnraidCapacitySnapshot>('SELECT * FROM unraid_capacity_snapshots WHERE id = ?')
    .get(Number(result.lastInsertRowid))!;
  logger.debug(`Unraid capacity snapshot captured: ${(input.used / BYTES_PER_TB).toFixed(2)} TB used`);
  return snapshot;
}

export function hasTodaySnapshot(): boolean {
  // Compare on SQLite's own datetime format. The DEFAULT (datetime('now'))
  // produces "YYYY-MM-DD HH:MM:SS" (UTC, space separator), so we can't
  // string-compare against JS toISOString() ("YYYY-MM-DDTHH:MM:SS.sssZ")
  // — the space (0x20) sorts before T (0x54), making every row appear
  // older than today's start. Use SQLite's date() on both sides instead.
  const db = getDatabase();
  const row = db
    .prepare<[], { count: number }>(
      "SELECT COUNT(*) as count FROM unraid_capacity_snapshots WHERE date(captured_at) = date('now')"
    )
    .get();
  return (row?.count ?? 0) > 0;
}

/**
 * Return the latest snapshot for each of the most recent N months,
 * oldest → newest. Months with no samples are skipped.
 */
export function getMonthlyTrend(months: number = 12): MonthlySample[] {
  // Compare in SQLite's own date space — captured_at is stored as
  // "YYYY-MM-DD HH:MM:SS" (UTC), not as ISO 8601, so string-compare against
  // toISOString() silently drops boundary rows.
  const db = getDatabase();
  const offset = `-${months - 1} months`;
  const rows = db
    .prepare<[string], { month: string; used_bytes: number }>(
      `SELECT month, used_bytes FROM (
         SELECT
           strftime('%Y-%m', captured_at) AS month,
           used_bytes,
           ROW_NUMBER() OVER (PARTITION BY strftime('%Y-%m', captured_at) ORDER BY captured_at DESC) AS rn
         FROM unraid_capacity_snapshots
         WHERE captured_at >= strftime('%Y-%m-01 00:00:00', date('now', ?))
       )
       WHERE rn = 1
       ORDER BY month ASC`
    )
    .all(offset);

  return rows.map((r) => ({ month: r.month, usedBytes: r.used_bytes }));
}

export function pruneOld(keepDays: number = 400): number {
  // Compare in SQLite's own date space (see hasTodaySnapshot for context).
  const db = getDatabase();
  const offset = `-${keepDays} days`;
  const result = db
    .prepare<[string]>("DELETE FROM unraid_capacity_snapshots WHERE date(captured_at) < date('now', ?)")
    .run(offset);
  if (result.changes > 0) {
    logger.info(`Pruned ${result.changes} old Unraid capacity snapshots`);
  }
  return result.changes;
}

export default {
  capture,
  hasTodaySnapshot,
  getMonthlyTrend,
  pruneOld,
};
