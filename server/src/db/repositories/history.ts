import { getDatabase } from '../index';
import type { DeletionHistory, MediaType, DeletionType } from '../../types';
import logger from '../../utils/logger';

// ============================================================================
// History Repository - Provides filtering, pagination, and export for deletion history
// ============================================================================

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

interface RuleRow {
  id: number;
  name: string;
}

export interface HistoryItem {
  id: number;
  mediaId: number | null;
  title: string;
  type: 'movie' | 'tv';
  size: number | null;
  deletedAt: string;
  deletedBy: string;
}

export interface HistoryQueryParams {
  search?: string;
  page?: number;
  limit?: number;
  dateRange?: '7d' | '30d' | '90d' | 'all';
}

export interface HistoryQueryResult {
  items: HistoryItem[];
  total: number;
  page: number;
  limit: number;
  stats: {
    totalDeleted: number;
    totalSpaceReclaimed: number;
  };
}

function rowToHistoryItem(row: DeletionHistoryRow, ruleName?: string): HistoryItem {
  return {
    id: row.id,
    mediaId: row.media_item_id,
    title: row.title,
    type: row.type as 'movie' | 'tv',
    size: row.file_size,
    deletedAt: row.deleted_at,
    deletedBy: ruleName || (row.deletion_type === 'manual' ? 'manual' : 'rule'),
  };
}

function getDateRangeFilter(dateRange: string): string {
  switch (dateRange) {
    case '7d':
      return "AND deleted_at >= datetime('now', '-7 days')";
    case '30d':
      return "AND deleted_at >= datetime('now', '-30 days')";
    case '90d':
      return "AND deleted_at >= datetime('now', '-90 days')";
    case 'all':
    default:
      return '';
  }
}

export function getHistory(params: HistoryQueryParams): HistoryQueryResult {
  const db = getDatabase();
  const page = Math.max(1, params.page || 1);
  const limit = Math.min(100, Math.max(1, params.limit || 20));
  const offset = (page - 1) * limit;
  const dateRangeFilter = getDateRangeFilter(params.dateRange || 'all');

  let searchFilter = '';
  const queryParams: (string | number)[] = [];

  if (params.search && params.search.trim()) {
    searchFilter = 'AND title LIKE ?';
    queryParams.push(`%${params.search.trim()}%`);
  }

  // Get total count
  const countQuery = `
    SELECT COUNT(*) as count
    FROM deletion_history
    WHERE 1=1 ${searchFilter} ${dateRangeFilter}
  `;
  const countStmt = db.prepare<(string | number)[], { count: number }>(countQuery);
  const total = countStmt.get(...queryParams)?.count ?? 0;

  // Get paginated items
  const itemsQuery = `
    SELECT * FROM deletion_history
    WHERE 1=1 ${searchFilter} ${dateRangeFilter}
    ORDER BY deleted_at DESC
    LIMIT ? OFFSET ?
  `;
  const itemsStmt = db.prepare<(string | number)[], DeletionHistoryRow>(itemsQuery);
  const rows = itemsStmt.all(...queryParams, limit, offset);

  // Get rule names for items deleted by rules
  const ruleIds = rows
    .filter((row) => row.deleted_by_rule_id !== null)
    .map((row) => row.deleted_by_rule_id as number);

  const ruleNames: Record<number, string> = {};
  if (ruleIds.length > 0) {
    const placeholders = ruleIds.map(() => '?').join(',');
    const rulesStmt = db.prepare<number[], RuleRow>(
      `SELECT id, name FROM rules WHERE id IN (${placeholders})`
    );
    const rules = rulesStmt.all(...ruleIds);
    for (const rule of rules) {
      ruleNames[rule.id] = rule.name;
    }
  }

  const items = rows.map((row) => {
    const ruleName = row.deleted_by_rule_id ? ruleNames[row.deleted_by_rule_id] : undefined;
    return rowToHistoryItem(row, ruleName);
  });

  // Calculate all-time stats (not filtered by search/dateRange)
  const allTimeCountStmt = db.prepare<[], { count: number }>(
    'SELECT COUNT(*) as count FROM deletion_history'
  );
  const totalDeleted = allTimeCountStmt.get()?.count ?? 0;

  const allTimeSizeStmt = db.prepare<[], { total_size: number | null }>(
    'SELECT SUM(file_size) as total_size FROM deletion_history'
  );
  const totalSpaceReclaimed = allTimeSizeStmt.get()?.total_size ?? 0;

  return {
    items,
    total,
    page,
    limit,
    stats: {
      totalDeleted,
      totalSpaceReclaimed,
    },
  };
}

export function getAllHistoryForExport(params: Omit<HistoryQueryParams, 'page' | 'limit'>): HistoryItem[] {
  const db = getDatabase();
  const dateRangeFilter = getDateRangeFilter(params.dateRange || 'all');

  let searchFilter = '';
  const queryParams: string[] = [];

  if (params.search && params.search.trim()) {
    searchFilter = 'AND title LIKE ?';
    queryParams.push(`%${params.search.trim()}%`);
  }

  const query = `
    SELECT * FROM deletion_history
    WHERE 1=1 ${searchFilter} ${dateRangeFilter}
    ORDER BY deleted_at DESC
  `;
  const stmt = db.prepare<string[], DeletionHistoryRow>(query);
  const rows = stmt.all(...queryParams);

  // Get all rule names
  const ruleIds = rows
    .filter((row) => row.deleted_by_rule_id !== null)
    .map((row) => row.deleted_by_rule_id as number);

  const ruleNames: Record<number, string> = {};
  if (ruleIds.length > 0) {
    const uniqueRuleIds = [...new Set(ruleIds)];
    const placeholders = uniqueRuleIds.map(() => '?').join(',');
    const rulesStmt = db.prepare<number[], RuleRow>(
      `SELECT id, name FROM rules WHERE id IN (${placeholders})`
    );
    const rules = rulesStmt.all(...uniqueRuleIds);
    for (const rule of rules) {
      ruleNames[rule.id] = rule.name;
    }
  }

  return rows.map((row) => {
    const ruleName = row.deleted_by_rule_id ? ruleNames[row.deleted_by_rule_id] : undefined;
    return rowToHistoryItem(row, ruleName);
  });
}

export function generateCsv(items: HistoryItem[]): string {
  const headers = ['ID', 'Media ID', 'Title', 'Type', 'Size (bytes)', 'Deleted At', 'Deleted By'];
  const rows = items.map((item) => [
    item.id.toString(),
    item.mediaId?.toString() ?? '',
    `"${item.title.replace(/"/g, '""')}"`,
    item.type,
    item.size?.toString() ?? '',
    item.deletedAt,
    item.deletedBy,
  ]);

  return [headers.join(','), ...rows.map((row) => row.join(','))].join('\n');
}

export default {
  getHistory,
  getAllHistoryForExport,
  generateCsv,
};
