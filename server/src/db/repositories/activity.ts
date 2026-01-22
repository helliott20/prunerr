import { getDatabase } from '../index';
import logger from '../../utils/logger';

// ============================================================================
// Activity Log Repository - Provides unified activity logging with pagination
// ============================================================================

// Event types that can be logged
export type ActivityEventType = 'scan' | 'deletion' | 'rule_match' | 'protection' | 'manual_action' | 'error';

// Actor types that can perform actions
export type ActivityActorType = 'scheduler' | 'user' | 'rule';

// Date range options for filtering
export type ActivityDateRange = '24h' | '7d' | '30d' | 'all';

// Activity log entry as stored in the database
export interface ActivityLogEntry {
  id: number;
  eventType: ActivityEventType;
  action: string;
  actorType: ActivityActorType;
  actorId: string | null;
  actorName: string | null;
  targetType: string | null;
  targetId: number | null;
  targetTitle: string | null;
  metadata: string | null;
  createdAt: string;
}

// Input for creating a new activity log entry
export interface ActivityLogInput {
  eventType: ActivityEventType;
  action: string;
  actorType: ActivityActorType;
  actorId?: string | null;
  actorName?: string | null;
  targetType?: string | null;
  targetId?: number | null;
  targetTitle?: string | null;
  metadata?: string | null;
}

// Query parameters for filtering activity log
export interface ActivityQueryParams {
  eventTypes?: ActivityEventType[];
  actorTypes?: ActivityActorType[];
  search?: string;
  page?: number;
  limit?: number;
  dateRange?: ActivityDateRange;
}

// Result of an activity query
export interface ActivityQueryResult {
  items: ActivityLogEntry[];
  total: number;
  page: number;
  limit: number;
}

// Database row structure
interface ActivityLogRow {
  id: number;
  event_type: string;
  action: string;
  actor_type: string;
  actor_id: string | null;
  actor_name: string | null;
  target_type: string | null;
  target_id: number | null;
  target_title: string | null;
  metadata: string | null;
  created_at: string;
}

/**
 * Convert database row to ActivityLogEntry
 */
function rowToActivityLogEntry(row: ActivityLogRow): ActivityLogEntry {
  return {
    id: row.id,
    eventType: row.event_type as ActivityEventType,
    action: row.action,
    actorType: row.actor_type as ActivityActorType,
    actorId: row.actor_id,
    actorName: row.actor_name,
    targetType: row.target_type,
    targetId: row.target_id,
    targetTitle: row.target_title,
    metadata: row.metadata,
    createdAt: row.created_at,
  };
}

/**
 * Get date filter SQL based on date range
 */
function getDateRangeFilter(dateRange: ActivityDateRange): string {
  switch (dateRange) {
    case '24h':
      return "AND created_at >= datetime('now', '-1 day')";
    case '7d':
      return "AND created_at >= datetime('now', '-7 days')";
    case '30d':
      return "AND created_at >= datetime('now', '-30 days')";
    case 'all':
    default:
      return '';
  }
}

/**
 * Log a new activity entry
 */
export function logActivity(entry: ActivityLogInput): ActivityLogEntry {
  const db = getDatabase();

  const stmt = db.prepare(`
    INSERT INTO activity_log (
      event_type, action, actor_type, actor_id, actor_name,
      target_type, target_id, target_title, metadata
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const result = stmt.run(
    entry.eventType,
    entry.action,
    entry.actorType,
    entry.actorId ?? null,
    entry.actorName ?? null,
    entry.targetType ?? null,
    entry.targetId ?? null,
    entry.targetTitle ?? null,
    entry.metadata ?? null
  );

  logger.debug(`Activity logged: ${entry.eventType}/${entry.action}`, {
    id: result.lastInsertRowid,
    actorType: entry.actorType,
    targetTitle: entry.targetTitle,
  });

  // Return the created entry
  const selectStmt = db.prepare<[number], ActivityLogRow>(
    'SELECT * FROM activity_log WHERE id = ?'
  );
  const row = selectStmt.get(Number(result.lastInsertRowid));

  if (!row) {
    throw new Error('Failed to retrieve activity log entry after creation');
  }

  return rowToActivityLogEntry(row);
}

/**
 * Get activity log with pagination and filtering
 */
export function getActivityLog(params: ActivityQueryParams = {}): ActivityQueryResult {
  const db = getDatabase();
  const page = Math.max(1, params.page || 1);
  const limit = Math.min(100, Math.max(1, params.limit || 20));
  const offset = (page - 1) * limit;
  const dateRangeFilter = getDateRangeFilter(params.dateRange || 'all');

  const conditions: string[] = ['1=1'];
  const queryParams: (string | number)[] = [];

  // Event type filtering
  if (params.eventTypes && params.eventTypes.length > 0) {
    const placeholders = params.eventTypes.map(() => '?').join(',');
    conditions.push(`event_type IN (${placeholders})`);
    queryParams.push(...params.eventTypes);
  }

  // Actor type filtering
  if (params.actorTypes && params.actorTypes.length > 0) {
    const placeholders = params.actorTypes.map(() => '?').join(',');
    conditions.push(`actor_type IN (${placeholders})`);
    queryParams.push(...params.actorTypes);
  }

  // Search filtering on target_title
  if (params.search && params.search.trim()) {
    conditions.push('target_title LIKE ?');
    queryParams.push(`%${params.search.trim()}%`);
  }

  const whereClause = conditions.join(' AND ');

  // Get total count
  const countQuery = `
    SELECT COUNT(*) as count
    FROM activity_log
    WHERE ${whereClause} ${dateRangeFilter}
  `;
  const countStmt = db.prepare<(string | number)[], { count: number }>(countQuery);
  const total = countStmt.get(...queryParams)?.count ?? 0;

  // Get paginated items
  const itemsQuery = `
    SELECT * FROM activity_log
    WHERE ${whereClause} ${dateRangeFilter}
    ORDER BY created_at DESC
    LIMIT ? OFFSET ?
  `;
  const itemsStmt = db.prepare<(string | number)[], ActivityLogRow>(itemsQuery);
  const rows = itemsStmt.all(...queryParams, limit, offset);

  return {
    items: rows.map(rowToActivityLogEntry),
    total,
    page,
    limit,
  };
}

/**
 * Get recent activity (simplified query for dashboard)
 */
export function getRecentActivity(limit: number = 20): ActivityLogEntry[] {
  const db = getDatabase();

  const stmt = db.prepare<[number], ActivityLogRow>(`
    SELECT * FROM activity_log
    ORDER BY created_at DESC
    LIMIT ?
  `);

  const rows = stmt.all(limit);
  return rows.map(rowToActivityLogEntry);
}

export default {
  logActivity,
  getActivityLog,
  getRecentActivity,
};
