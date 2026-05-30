import { getDatabase } from '../index';
import type { ScanHistory, ScanStatus } from '../../types';
import logger from '../../utils/logger';

interface ScanHistoryRow {
  id: number;
  started_at: string;
  completed_at: string | null;
  items_scanned: number;
  items_flagged: number;
  status: string;
}

function rowToScanHistory(row: ScanHistoryRow): ScanHistory {
  return {
    ...row,
    status: row.status as ScanStatus,
  };
}

export function getAll(limit: number = 50, offset: number = 0): ScanHistory[] {
  const db = getDatabase();
  const stmt = db.prepare<[number, number], ScanHistoryRow>(
    'SELECT * FROM scan_history ORDER BY started_at DESC LIMIT ? OFFSET ?'
  );
  return stmt.all(limit, offset).map(rowToScanHistory);
}

export function getById(id: number): ScanHistory | null {
  const db = getDatabase();
  const stmt = db.prepare<[number], ScanHistoryRow>('SELECT * FROM scan_history WHERE id = ?');
  const row = stmt.get(id);
  return row ? rowToScanHistory(row) : null;
}

export function getLatest(): ScanHistory | null {
  const db = getDatabase();
  const stmt = db.prepare<[], ScanHistoryRow>(
    'SELECT * FROM scan_history ORDER BY started_at DESC LIMIT 1'
  );
  const row = stmt.get();
  return row ? rowToScanHistory(row) : null;
}

export function getRunning(): ScanHistory | null {
  const db = getDatabase();
  const stmt = db.prepare<[], ScanHistoryRow>(
    "SELECT * FROM scan_history WHERE status = 'running' ORDER BY started_at DESC LIMIT 1"
  );
  const row = stmt.get();
  return row ? rowToScanHistory(row) : null;
}

export function getByStatus(status: ScanStatus): ScanHistory[] {
  const db = getDatabase();
  const stmt = db.prepare<[string], ScanHistoryRow>(
    'SELECT * FROM scan_history WHERE status = ? ORDER BY started_at DESC'
  );
  return stmt.all(status).map(rowToScanHistory);
}

export function getByDateRange(startDate: string, endDate: string): ScanHistory[] {
  const db = getDatabase();
  const stmt = db.prepare<[string, string], ScanHistoryRow>(
    'SELECT * FROM scan_history WHERE started_at BETWEEN ? AND ? ORDER BY started_at DESC'
  );
  return stmt.all(startDate, endDate).map(rowToScanHistory);
}

export function create(): ScanHistory {
  const db = getDatabase();
  const now = new Date().toISOString();

  const stmt = db.prepare(`
    INSERT INTO scan_history (started_at, status)
    VALUES (?, 'running')
  `);

  const result = stmt.run(now);
  logger.debug(`Started scan (ID: ${result.lastInsertRowid})`);

  const scan = getById(Number(result.lastInsertRowid));
  if (!scan) {
    throw new Error('Failed to retrieve scan history after creation');
  }
  return scan;
}

export function complete(id: number, itemsScanned: number, itemsFlagged: number): ScanHistory | null {
  const db = getDatabase();
  const now = new Date().toISOString();

  const stmt = db.prepare(`
    UPDATE scan_history
    SET completed_at = ?, items_scanned = ?, items_flagged = ?, status = 'completed'
    WHERE id = ?
  `);

  stmt.run(now, itemsScanned, itemsFlagged, id);
  logger.debug(`Completed scan ${id}: scanned=${itemsScanned}, flagged=${itemsFlagged}`);

  return getById(id);
}

export function fail(id: number): ScanHistory | null {
  const db = getDatabase();
  const now = new Date().toISOString();

  const stmt = db.prepare(`
    UPDATE scan_history
    SET completed_at = ?, status = 'failed'
    WHERE id = ?
  `);

  stmt.run(now, id);
  logger.warn(`Scan ${id} failed`);

  return getById(id);
}

export function updateProgress(id: number, itemsScanned: number, itemsFlagged: number): ScanHistory | null {
  const db = getDatabase();

  const stmt = db.prepare(`
    UPDATE scan_history
    SET items_scanned = ?, items_flagged = ?
    WHERE id = ?
  `);

  stmt.run(itemsScanned, itemsFlagged, id);
  return getById(id);
}

export function deleteById(id: number): boolean {
  const db = getDatabase();
  const stmt = db.prepare('DELETE FROM scan_history WHERE id = ?');
  const result = stmt.run(id);
  logger.debug(`Deleted scan history: ${id}, affected: ${result.changes}`);
  return result.changes > 0;
}

export function deleteOlderThan(days: number): number {
  const db = getDatabase();
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - days);

  const stmt = db.prepare('DELETE FROM scan_history WHERE started_at < ?');
  const result = stmt.run(cutoffDate.toISOString());
  logger.info(`Deleted ${result.changes} scan history entries older than ${days} days`);
  return result.changes;
}

/**
 * A single day in the Schedule card's "cadence ribbon" chart.
 * `files`/`gb` are the items pruned and storage reclaimed that day (from
 * deletion_history); `dur`/`status` come from a scan that ran that day, if any.
 * `timed` is false for back-filled days with no real event timestamp (so the
 * client knows the time-of-day isn't meaningful).
 */
export interface CadenceRun {
  date: string; // ISO timestamp (real event time, or local noon for filler days)
  status: 'ok' | 'skipped' | 'failed';
  files: number; // items pruned that day
  gb: number; // storage reclaimed, GB
  dur: number; // scan duration, seconds (0 if no scan ran that day)
  flagged: number; // items the day's scan flagged/queued (pruning may lag the scan)
  timed: boolean; // whether `date` reflects a real scan/deletion timestamp
}

function localDayKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Returns the last `days` calendar days (oldest→newest) shaped for the cadence
 * ribbon. The chart is day-based rather than scan-row-based so it back-fills
 * from existing pruning history and keeps the weekday axis on consecutive days.
 *
 * Prunerr flags items during a scan but deletes them on a separate task once the
 * grace period elapses, so "files pruned / GB freed" is the actual deletion
 * activity (deletion_history) bucketed by day; `status`/`dur` come from a scan
 * that ran that day. A day with no pruning reads as `skipped`; a day whose scan
 * failed reads as `failed`.
 */
export function getCadence(days: number = 14): CadenceRun[] {
  const db = getDatabase();
  const n = Math.max(1, Math.min(60, days));

  // Build the last n local calendar days (oldest → newest) as YYYY-MM-DD keys.
  const base = new Date();
  base.setHours(0, 0, 0, 0);
  const dayKeys: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(base);
    d.setDate(base.getDate() - i);
    dayKeys.push(localDayKey(d));
  }
  const windowStart = new Date(base);
  windowStart.setDate(base.getDate() - (n - 1));
  const windowStartISO = windowStart.toISOString();

  // Deletions bucketed by local day within the window.
  const delRows = db
    .prepare<[string], { day: string; files: number; bytes: number | null; last_at: string }>(`
      SELECT date(deleted_at, 'localtime') AS day,
             COUNT(*) AS files,
             SUM(file_size) AS bytes,
             MAX(deleted_at) AS last_at
      FROM deletion_history
      WHERE deleted_at >= ?
      GROUP BY date(deleted_at, 'localtime')
    `)
    .all(windowStartISO);
  const delByDay = new Map(delRows.map((r) => [r.day, r]));

  // Scans bucketed by local day within the window (keep each day's last run).
  const scanRows = db
    .prepare<[string], { day: string; started_at: string; completed_at: string | null; status: string; items_flagged: number }>(`
      SELECT date(started_at, 'localtime') AS day, started_at, completed_at, status, items_flagged
      FROM scan_history
      WHERE started_at >= ? AND status IN ('completed', 'failed')
      ORDER BY started_at ASC
    `)
    .all(windowStartISO);
  const scanByDay = new Map<
    string,
    { started_at: string; completed_at: string | null; failed: boolean; flagged: number }
  >();
  for (const r of scanRows) {
    const prev = scanByDay.get(r.day);
    scanByDay.set(r.day, {
      started_at: r.started_at,
      completed_at: r.completed_at,
      failed: (prev?.failed ?? false) || r.status === 'failed',
      flagged: r.items_flagged ?? 0,
    });
  }

  return dayKeys.map((day): CadenceRun => {
    const del = delByDay.get(day);
    const scan = scanByDay.get(day);
    const files = del?.files ?? 0;
    const gb = del?.bytes ? +(del.bytes / 1024 ** 3).toFixed(1) : 0;

    let status: CadenceRun['status'];
    if (scan?.failed) status = 'failed';
    else if (files > 0) status = 'ok';
    else status = 'skipped';

    const dur = scan?.completed_at
      ? Math.max(0, Math.round((Date.parse(scan.completed_at) - Date.parse(scan.started_at)) / 1000))
      : 0;

    // Prefer a real timestamp (scan start, else the day's last deletion); fall
    // back to local noon so the weekday label is still correct for filler days.
    const realTs = scan?.started_at ?? del?.last_at ?? null;
    return {
      date: realTs ?? `${day}T12:00:00`,
      status,
      files,
      gb,
      dur,
      flagged: scan?.flagged ?? 0,
      timed: realTs !== null,
    };
  });
}

export interface ScanStats {
  totalScans: number;
  completedScans: number;
  failedScans: number;
  totalItemsScanned: number;
  totalItemsFlagged: number;
  averageItemsPerScan: number;
}

export function getStats(): ScanStats {
  const db = getDatabase();

  const totalStmt = db.prepare<[], { count: number }>('SELECT COUNT(*) as count FROM scan_history');
  const totalScans = totalStmt.get()?.count ?? 0;

  const completedStmt = db.prepare<[], { count: number }>(
    "SELECT COUNT(*) as count FROM scan_history WHERE status = 'completed'"
  );
  const completedScans = completedStmt.get()?.count ?? 0;

  const failedStmt = db.prepare<[], { count: number }>(
    "SELECT COUNT(*) as count FROM scan_history WHERE status = 'failed'"
  );
  const failedScans = failedStmt.get()?.count ?? 0;

  const itemsStmt = db.prepare<[], { total_scanned: number | null; total_flagged: number | null }>(
    'SELECT SUM(items_scanned) as total_scanned, SUM(items_flagged) as total_flagged FROM scan_history'
  );
  const itemsResult = itemsStmt.get();
  const totalItemsScanned = itemsResult?.total_scanned ?? 0;
  const totalItemsFlagged = itemsResult?.total_flagged ?? 0;

  const averageItemsPerScan = completedScans > 0 ? Math.round(totalItemsScanned / completedScans) : 0;

  return {
    totalScans,
    completedScans,
    failedScans,
    totalItemsScanned,
    totalItemsFlagged,
    averageItemsPerScan,
  };
}

export default {
  getAll,
  getById,
  getLatest,
  getRunning,
  getByStatus,
  getByDateRange,
  create,
  complete,
  fail,
  updateProgress,
  delete: deleteById,
  deleteOlderThan,
  getStats,
  getCadence,
};
