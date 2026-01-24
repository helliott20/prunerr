import { getDatabase } from '../index';
import type { DeletionHistory, MediaType, DeletionType } from '../../types';
import logger from '../../utils/logger';

interface DeletionHistoryRow {
  id: number;
  media_item_id: number | null;
  title: string;
  type: string;
  file_size: number | null;
  deleted_at: string;
  deletion_type: string;
  deleted_by_rule_id: number | null;
}

function rowToDeletionHistory(row: DeletionHistoryRow): DeletionHistory {
  return {
    ...row,
    type: row.type as MediaType,
    deletion_type: row.deletion_type as DeletionType,
  };
}

export function getAll(limit: number = 100, offset: number = 0): DeletionHistory[] {
  const db = getDatabase();
  const stmt = db.prepare<[number, number], DeletionHistoryRow>(
    'SELECT * FROM deletion_history ORDER BY deleted_at DESC LIMIT ? OFFSET ?'
  );
  return stmt.all(limit, offset).map(rowToDeletionHistory);
}

export function getById(id: number): DeletionHistory | null {
  const db = getDatabase();
  const stmt = db.prepare<[number], DeletionHistoryRow>(
    'SELECT * FROM deletion_history WHERE id = ?'
  );
  const row = stmt.get(id);
  return row ? rowToDeletionHistory(row) : null;
}

export function getByMediaItemId(mediaItemId: number): DeletionHistory[] {
  const db = getDatabase();
  const stmt = db.prepare<[number], DeletionHistoryRow>(
    'SELECT * FROM deletion_history WHERE media_item_id = ? ORDER BY deleted_at DESC'
  );
  return stmt.all(mediaItemId).map(rowToDeletionHistory);
}

export function getByRuleId(ruleId: number): DeletionHistory[] {
  const db = getDatabase();
  const stmt = db.prepare<[number], DeletionHistoryRow>(
    'SELECT * FROM deletion_history WHERE deleted_by_rule_id = ? ORDER BY deleted_at DESC'
  );
  return stmt.all(ruleId).map(rowToDeletionHistory);
}

export function getByDateRange(startDate: string, endDate: string): DeletionHistory[] {
  const db = getDatabase();
  const stmt = db.prepare<[string, string], DeletionHistoryRow>(
    'SELECT * FROM deletion_history WHERE deleted_at BETWEEN ? AND ? ORDER BY deleted_at DESC'
  );
  return stmt.all(startDate, endDate).map(rowToDeletionHistory);
}

export function getByType(type: MediaType): DeletionHistory[] {
  const db = getDatabase();
  const stmt = db.prepare<[string], DeletionHistoryRow>(
    'SELECT * FROM deletion_history WHERE type = ? ORDER BY deleted_at DESC'
  );
  return stmt.all(type).map(rowToDeletionHistory);
}

export function getByDeletionType(deletionType: DeletionType): DeletionHistory[] {
  const db = getDatabase();
  const stmt = db.prepare<[string], DeletionHistoryRow>(
    'SELECT * FROM deletion_history WHERE deletion_type = ? ORDER BY deleted_at DESC'
  );
  return stmt.all(deletionType).map(rowToDeletionHistory);
}

export interface CreateDeletionHistoryInput {
  media_item_id?: number | null;
  title: string;
  type: MediaType;
  file_size?: number | null;
  deletion_type: DeletionType;
  deleted_by_rule_id?: number | null;
}

export function create(input: CreateDeletionHistoryInput): DeletionHistory {
  const db = getDatabase();
  const now = new Date().toISOString();

  const stmt = db.prepare(`
    INSERT INTO deletion_history (media_item_id, title, type, file_size, deleted_at, deletion_type, deleted_by_rule_id)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  const result = stmt.run(
    input.media_item_id ?? null,
    input.title,
    input.type,
    input.file_size ?? null,
    now,
    input.deletion_type,
    input.deleted_by_rule_id ?? null
  );

  logger.debug(`Added deletion history for: ${input.title}`);

  const historyItem = getById(Number(result.lastInsertRowid));
  if (!historyItem) {
    throw new Error('Failed to retrieve deletion history after creation');
  }
  return historyItem;
}

export function deleteById(id: number): boolean {
  const db = getDatabase();
  const stmt = db.prepare('DELETE FROM deletion_history WHERE id = ?');
  const result = stmt.run(id);
  logger.debug(`Deleted history entry: ${id}, affected: ${result.changes}`);
  return result.changes > 0;
}

export function deleteOlderThan(days: number): number {
  const db = getDatabase();
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - days);

  const stmt = db.prepare('DELETE FROM deletion_history WHERE deleted_at < ?');
  const result = stmt.run(cutoffDate.toISOString());
  logger.info(`Deleted ${result.changes} history entries older than ${days} days`);
  return result.changes;
}

export interface DeletionStats {
  totalDeleted: number;
  totalSizeReclaimed: number;
  deletionsByType: Record<string, number>;
  deletionsByDeletionType: Record<string, number>;
}

export function getStats(): DeletionStats {
  const db = getDatabase();

  const totalStmt = db.prepare<[], { count: number }>('SELECT COUNT(*) as count FROM deletion_history');
  const totalDeleted = totalStmt.get()?.count ?? 0;

  const sizeStmt = db.prepare<[], { total_size: number | null }>(
    'SELECT SUM(file_size) as total_size FROM deletion_history'
  );
  const totalSizeReclaimed = sizeStmt.get()?.total_size ?? 0;

  const byTypeStmt = db.prepare<[], { type: string; count: number }>(
    'SELECT type, COUNT(*) as count FROM deletion_history GROUP BY type'
  );
  const byTypeRows = byTypeStmt.all();
  const deletionsByType: Record<string, number> = {};
  for (const row of byTypeRows) {
    deletionsByType[row.type] = row.count;
  }

  const byDeletionTypeStmt = db.prepare<[], { deletion_type: string; count: number }>(
    'SELECT deletion_type, COUNT(*) as count FROM deletion_history GROUP BY deletion_type'
  );
  const byDeletionTypeRows = byDeletionTypeStmt.all();
  const deletionsByDeletionType: Record<string, number> = {};
  for (const row of byDeletionTypeRows) {
    deletionsByDeletionType[row.deletion_type] = row.count;
  }

  return { totalDeleted, totalSizeReclaimed, deletionsByType, deletionsByDeletionType };
}

export function getRecentCount(hours: number = 24): number {
  const db = getDatabase();
  const cutoffDate = new Date();
  cutoffDate.setHours(cutoffDate.getHours() - hours);

  const stmt = db.prepare<[string], { count: number }>(
    'SELECT COUNT(*) as count FROM deletion_history WHERE deleted_at > ?'
  );
  return stmt.get(cutoffDate.toISOString())?.count ?? 0;
}

export default {
  getAll,
  getById,
  getByMediaItemId,
  getByRuleId,
  getByDateRange,
  getByType,
  getByDeletionType,
  create,
  delete: deleteById,
  deleteOlderThan,
  getStats,
  getRecentCount,
};
