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
};
