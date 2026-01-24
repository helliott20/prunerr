import { getDatabase } from '../index';
import type {
  MediaItem,
  CreateMediaItemInput,
  UpdateMediaItemInput,
  MediaItemFilters,
  PaginatedResponse,
  MediaType,
  MediaStatus,
} from '../../types';
import logger from '../../utils/logger';

interface MediaItemRow {
  id: number;
  type: string;
  title: string;
  plex_id: string | null;
  sonarr_id: number | null;
  radarr_id: number | null;
  tmdb_id: number | null;
  imdb_id: string | null;
  tvdb_id: number | null;
  year: number | null;
  poster_url: string | null;
  file_path: string | null;
  file_size: number | null;
  resolution: string | null;
  codec: string | null;
  added_at: string | null;
  last_watched_at: string | null;
  play_count: number;
  watched_by: string | null;
  status: string;
  marked_at: string | null;
  delete_after: string | null;
  is_protected: number;
  protection_reason: string | null;
  deletion_action: string | null;
  reset_overseerr: number | null;
  matched_rule_id: number | null;
  overseerr_reset_at: string | null;
  created_at: string;
  updated_at: string;
}

function rowToMediaItem(row: MediaItemRow): MediaItem {
  return {
    ...row,
    type: row.type as MediaType,
    status: row.status as MediaStatus,
    is_protected: Boolean(row.is_protected),
  };
}

export function getAllMediaItems(filters?: MediaItemFilters): PaginatedResponse<MediaItem> {
  const db = getDatabase();
  const limit = filters?.limit ?? 50;
  const offset = filters?.offset ?? 0;

  let whereClause = '1=1';
  const params: (string | number)[] = [];

  if (filters?.type) {
    whereClause += ' AND type = ?';
    params.push(filters.type);
  }

  if (filters?.status) {
    whereClause += ' AND status = ?';
    params.push(filters.status);
  }

  if (filters?.search) {
    whereClause += ' AND title LIKE ?';
    params.push(`%${filters.search}%`);
  }

  // Size filters
  if (filters?.minSize !== undefined) {
    whereClause += ' AND (file_size IS NOT NULL AND file_size >= ?)';
    params.push(filters.minSize);
  }

  if (filters?.maxSize !== undefined) {
    whereClause += ' AND (file_size IS NULL OR file_size <= ?)';
    params.push(filters.maxSize);
  }

  // Watched/unwatched filter
  if (filters?.watched !== undefined) {
    if (filters.watched) {
      whereClause += ' AND play_count > 0';
    } else {
      whereClause += ' AND (play_count IS NULL OR play_count = 0)';
    }
  }

  // Unwatched for X days filter
  if (filters?.unwatchedDays !== undefined) {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - filters.unwatchedDays);
    whereClause += ' AND (last_watched_at IS NULL OR last_watched_at < ?)';
    params.push(cutoffDate.toISOString());
  }

  // Protected filter
  if (filters?.isProtected !== undefined) {
    whereClause += ' AND is_protected = ?';
    params.push(filters.isProtected ? 1 : 0);
  }

  // Get total count with all filters applied
  const countStmt = db.prepare(`SELECT COUNT(*) as count FROM media_items WHERE ${whereClause}`);
  const countResult = countStmt.get(...params) as { count: number };
  const total = countResult.count;

  // Build ORDER BY clause
  let orderBy = 'updated_at DESC';
  if (filters?.sortBy) {
    // Map frontend column names to database column names
    const columnMap: Record<string, string> = {
      'title': 'title',
      'size': 'file_size',
      'file_size': 'file_size',
      'lastWatched': 'last_watched_at',
      'last_watched_at': 'last_watched_at',
      'addedAt': 'added_at',
      'added_at': 'added_at',
      'play_count': 'play_count',
      'playCount': 'play_count',
      'updated_at': 'updated_at',
      'year': 'year',
    };

    const dbColumn = columnMap[filters.sortBy];
    if (dbColumn) {
      const direction = filters.sortOrder === 'asc' ? 'ASC' : 'DESC';
      orderBy = `${dbColumn} ${direction}`;
    }
  }

  // Get paginated results
  const dataStmt = db.prepare(
    `SELECT * FROM media_items WHERE ${whereClause} ORDER BY ${orderBy} LIMIT ? OFFSET ?`
  );
  const rows = dataStmt.all(...params, limit, offset) as MediaItemRow[];

  return {
    data: rows.map(rowToMediaItem),
    total,
    limit,
    offset,
  };
}

export function getMediaItemById(id: number): MediaItem | null {
  const db = getDatabase();
  const stmt = db.prepare<[number], MediaItemRow>('SELECT * FROM media_items WHERE id = ?');
  const row = stmt.get(id);
  return row ? rowToMediaItem(row) : null;
}

export function getMediaItemByPlexId(plexId: string): MediaItem | null {
  const db = getDatabase();
  const stmt = db.prepare<[string], MediaItemRow>('SELECT * FROM media_items WHERE plex_id = ?');
  const row = stmt.get(plexId);
  return row ? rowToMediaItem(row) : null;
}

export function getMediaItemBySonarrId(sonarrId: number): MediaItem | null {
  const db = getDatabase();
  const stmt = db.prepare<[number], MediaItemRow>('SELECT * FROM media_items WHERE sonarr_id = ?');
  const row = stmt.get(sonarrId);
  return row ? rowToMediaItem(row) : null;
}

export function getMediaItemByRadarrId(radarrId: number): MediaItem | null {
  const db = getDatabase();
  const stmt = db.prepare<[number], MediaItemRow>('SELECT * FROM media_items WHERE radarr_id = ?');
  const row = stmt.get(radarrId);
  return row ? rowToMediaItem(row) : null;
}

export function createMediaItem(input: CreateMediaItemInput): MediaItem {
  const db = getDatabase();
  const now = new Date().toISOString();

  const stmt = db.prepare(`
    INSERT INTO media_items (
      type, title, plex_id, sonarr_id, radarr_id, tmdb_id, imdb_id, tvdb_id, year,
      poster_url, file_path, file_size, resolution, codec, added_at, last_watched_at,
      play_count, watched_by, status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const result = stmt.run(
    input.type,
    input.title,
    input.plex_id ?? null,
    input.sonarr_id ?? null,
    input.radarr_id ?? null,
    input.tmdb_id ?? null,
    input.imdb_id ?? null,
    input.tvdb_id ?? null,
    input.year ?? null,
    input.poster_url ?? null,
    input.file_path ?? null,
    input.file_size ?? null,
    input.resolution ?? null,
    input.codec ?? null,
    input.added_at ?? null,
    input.last_watched_at ?? null,
    input.play_count ?? 0,
    input.watched_by ? JSON.stringify(input.watched_by) : null,
    input.status ?? 'monitored',
    now,
    now
  );

  logger.debug(`Created media item: ${input.title} (ID: ${result.lastInsertRowid})`);

  const item = getMediaItemById(Number(result.lastInsertRowid));
  if (!item) {
    throw new Error('Failed to retrieve media item after creation');
  }
  return item;
}

export function updateMediaItem(id: number, input: UpdateMediaItemInput): MediaItem | null {
  const db = getDatabase();
  const now = new Date().toISOString();

  const existing = getMediaItemById(id);
  if (!existing) {
    return null;
  }

  const updates: string[] = [];
  const params: (string | number | null)[] = [];

  if (input.title !== undefined) {
    updates.push('title = ?');
    params.push(input.title);
  }
  if (input.plex_id !== undefined) {
    updates.push('plex_id = ?');
    params.push(input.plex_id);
  }
  if (input.sonarr_id !== undefined) {
    updates.push('sonarr_id = ?');
    params.push(input.sonarr_id);
  }
  if (input.radarr_id !== undefined) {
    updates.push('radarr_id = ?');
    params.push(input.radarr_id);
  }
  if (input.tmdb_id !== undefined) {
    updates.push('tmdb_id = ?');
    params.push(input.tmdb_id);
  }
  if (input.imdb_id !== undefined) {
    updates.push('imdb_id = ?');
    params.push(input.imdb_id);
  }
  if (input.tvdb_id !== undefined) {
    updates.push('tvdb_id = ?');
    params.push(input.tvdb_id);
  }
  if (input.year !== undefined) {
    updates.push('year = ?');
    params.push(input.year);
  }
  if (input.poster_url !== undefined) {
    updates.push('poster_url = ?');
    params.push(input.poster_url);
  }
  if (input.file_path !== undefined) {
    updates.push('file_path = ?');
    params.push(input.file_path);
  }
  if (input.file_size !== undefined) {
    updates.push('file_size = ?');
    params.push(input.file_size);
  }
  if (input.resolution !== undefined) {
    updates.push('resolution = ?');
    params.push(input.resolution);
  }
  if (input.codec !== undefined) {
    updates.push('codec = ?');
    params.push(input.codec);
  }
  if (input.added_at !== undefined) {
    updates.push('added_at = ?');
    params.push(input.added_at);
  }
  if (input.last_watched_at !== undefined) {
    updates.push('last_watched_at = ?');
    params.push(input.last_watched_at);
  }
  if (input.play_count !== undefined) {
    updates.push('play_count = ?');
    params.push(input.play_count);
  }
  if (input.watched_by !== undefined) {
    updates.push('watched_by = ?');
    params.push(JSON.stringify(input.watched_by));
  }
  if (input.status !== undefined) {
    updates.push('status = ?');
    params.push(input.status);
  }
  if (input.marked_at !== undefined) {
    updates.push('marked_at = ?');
    params.push(input.marked_at);
  }
  if (input.delete_after !== undefined) {
    updates.push('delete_after = ?');
    params.push(input.delete_after);
  }
  if (input.is_protected !== undefined) {
    updates.push('is_protected = ?');
    params.push(input.is_protected ? 1 : 0);
  }
  if (input.protection_reason !== undefined) {
    updates.push('protection_reason = ?');
    params.push(input.protection_reason);
  }
  if ((input as any).deletion_action !== undefined) {
    updates.push('deletion_action = ?');
    params.push((input as any).deletion_action);
  }
  if ((input as any).reset_overseerr !== undefined) {
    updates.push('reset_overseerr = ?');
    params.push((input as any).reset_overseerr);
  }
  if ((input as any).matched_rule_id !== undefined) {
    updates.push('matched_rule_id = ?');
    params.push((input as any).matched_rule_id);
  }
  if ((input as any).overseerr_reset_at !== undefined) {
    updates.push('overseerr_reset_at = ?');
    params.push((input as any).overseerr_reset_at);
  }

  if (updates.length === 0) {
    return existing;
  }

  updates.push('updated_at = ?');
  params.push(now);
  params.push(id);

  const stmt = db.prepare(`UPDATE media_items SET ${updates.join(', ')} WHERE id = ?`);
  stmt.run(...params);

  logger.debug(`Updated media item: ${id}`);
  return getMediaItemById(id);
}

export function deleteMediaItem(id: number): boolean {
  const db = getDatabase();
  const stmt = db.prepare('DELETE FROM media_items WHERE id = ?');
  const result = stmt.run(id);
  logger.debug(`Deleted media item: ${id}, affected: ${result.changes}`);
  return result.changes > 0;
}

export function updateMediaItemStatus(id: number, status: MediaStatus, markedAt?: string): MediaItem | null {
  return updateMediaItem(id, {
    status,
    marked_at: markedAt ?? (status === 'flagged' ? new Date().toISOString() : undefined),
  });
}

export function protectMediaItem(id: number, reason: string): MediaItem | null {
  return updateMediaItem(id, {
    is_protected: true,
    protection_reason: reason,
    status: 'protected',
  });
}

export function unprotectMediaItem(id: number): MediaItem | null {
  return updateMediaItem(id, {
    is_protected: false,
    protection_reason: undefined,
    status: 'monitored',
  });
}

export function getMediaItemsByStatus(status: MediaStatus): MediaItem[] {
  const db = getDatabase();
  const stmt = db.prepare<[string], MediaItemRow>(
    'SELECT * FROM media_items WHERE status = ? ORDER BY updated_at DESC'
  );
  const rows = stmt.all(status);
  return rows.map(rowToMediaItem);
}

export function getFlaggedMediaItems(): MediaItem[] {
  return getMediaItemsByStatus('flagged');
}

export function getProtectedMediaItems(): MediaItem[] {
  return getMediaItemsByStatus('protected');
}

export function getPendingDeletionItems(): MediaItem[] {
  return getMediaItemsByStatus('pending_deletion');
}

export function getMediaItemsOlderThan(days: number): MediaItem[] {
  const db = getDatabase();
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - days);

  const stmt = db.prepare<[string, string], MediaItemRow>(
    'SELECT * FROM media_items WHERE added_at < ? AND status = ? ORDER BY added_at ASC'
  );
  const rows = stmt.all(cutoffDate.toISOString(), 'monitored');
  return rows.map(rowToMediaItem);
}

export function getUnwatchedMediaItems(days: number): MediaItem[] {
  const db = getDatabase();
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - days);

  // Items are considered "unwatched" if:
  // 1. Never watched: play_count = 0 AND last_watched_at IS NULL
  // 2. Not watched recently: last_watched_at < cutoffDate (regardless of play_count)
  // But exclude items with play_count > 0 and no last_watched_at (data inconsistency - they were watched)
  const stmt = db.prepare<[string, string], MediaItemRow>(`
    SELECT * FROM media_items
    WHERE (
      (play_count = 0 OR play_count IS NULL) AND last_watched_at IS NULL
      OR last_watched_at < ?
    )
    AND status = ?
    ORDER BY last_watched_at ASC
  `);
  const rows = stmt.all(cutoffDate.toISOString(), 'monitored');
  return rows.map(rowToMediaItem);
}

export function getMediaStats(): { total: number; byType: Record<string, number>; byStatus: Record<string, number>; totalSize: number } {
  const db = getDatabase();

  const totalStmt = db.prepare<[], { count: number }>('SELECT COUNT(*) as count FROM media_items');
  const total = totalStmt.get()?.count ?? 0;

  const byTypeStmt = db.prepare<[], { type: string; count: number }>(
    'SELECT type, COUNT(*) as count FROM media_items GROUP BY type'
  );
  const byTypeRows = byTypeStmt.all();
  const byType: Record<string, number> = {};
  for (const row of byTypeRows) {
    byType[row.type] = row.count;
  }

  const byStatusStmt = db.prepare<[], { status: string; count: number }>(
    'SELECT status, COUNT(*) as count FROM media_items GROUP BY status'
  );
  const byStatusRows = byStatusStmt.all();
  const byStatus: Record<string, number> = {};
  for (const row of byStatusRows) {
    byStatus[row.status] = row.count;
  }

  const sizeStmt = db.prepare<[], { total_size: number | null }>(
    'SELECT SUM(file_size) as total_size FROM media_items'
  );
  const totalSize = sizeStmt.get()?.total_size ?? 0;

  return { total, byType, byStatus, totalSize };
}

export default {
  getAll: getAllMediaItems,
  getById: getMediaItemById,
  getByPlexId: getMediaItemByPlexId,
  getBySonarrId: getMediaItemBySonarrId,
  getByRadarrId: getMediaItemByRadarrId,
  create: createMediaItem,
  update: updateMediaItem,
  delete: deleteMediaItem,
  updateStatus: updateMediaItemStatus,
  protect: protectMediaItem,
  unprotect: unprotectMediaItem,
  getByStatus: getMediaItemsByStatus,
  getFlagged: getFlaggedMediaItems,
  getProtected: getProtectedMediaItems,
  getPendingDeletion: getPendingDeletionItems,
  getOlderThan: getMediaItemsOlderThan,
  getUnwatched: getUnwatchedMediaItems,
  getStats: getMediaStats,
};
