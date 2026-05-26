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
  const db = getDatabase();
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const row = db
    .prepare<[string], { count: number }>(
      'SELECT COUNT(*) as count FROM unraid_capacity_snapshots WHERE captured_at >= ?'
    )
    .get(todayStart.toISOString());
  return (row?.count ?? 0) > 0;
}

/**
 * Return the latest snapshot for each of the most recent N months,
 * oldest → newest. Months with no samples are skipped.
 */
export function getMonthlyTrend(months: number = 12): MonthlySample[] {
  const db = getDatabase();
  const since = new Date();
  since.setMonth(since.getMonth() - months);
  since.setDate(1);
  since.setHours(0, 0, 0, 0);

  const rows = db
    .prepare<[string], { month: string; used_bytes: number }>(
      `SELECT month, used_bytes FROM (
         SELECT
           strftime('%Y-%m', captured_at) AS month,
           used_bytes,
           ROW_NUMBER() OVER (PARTITION BY strftime('%Y-%m', captured_at) ORDER BY captured_at DESC) AS rn
         FROM unraid_capacity_snapshots
         WHERE captured_at >= ?
       )
       WHERE rn = 1
       ORDER BY month ASC`
    )
    .all(since.toISOString());

  return rows.map((r) => ({ month: r.month, usedBytes: r.used_bytes }));
}

export function pruneOld(keepDays: number = 400): number {
  const db = getDatabase();
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - keepDays);
  const result = db
    .prepare<[string]>('DELETE FROM unraid_capacity_snapshots WHERE captured_at < ?')
    .run(cutoff.toISOString());
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
