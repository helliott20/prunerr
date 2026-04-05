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
  genres: string | null;
  tags: string | null;
  studio: string | null;
  audio_codec: string | null;
  video_codec: string | null;
  hdr: string | null;
  bitrate: number | null;
  runtime_minutes: number | null;
  season_count: number | null;
  episode_count: number | null;
  series_status: string | null;
  rating_imdb: number | null;
  rating_tmdb: number | null;
  rating_rt: number | null;
  content_rating: string | null;
  original_language: string | null;
  created_at: string;
  updated_at: string;
}

function parseJsonArray(value: string | null): string[] | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function rowToMediaItem(row: MediaItemRow): MediaItem {
  return {
    ...row,
    type: row.type as MediaType,
    status: row.status as MediaStatus,
    is_protected: Boolean(row.is_protected),
    genres: parseJsonArray(row.genres),
    tags: parseJsonArray(row.tags),
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
      play_count, watched_by, status, library_key,
      genres, tags, studio, audio_codec, video_codec, hdr, bitrate,
      runtime_minutes, season_count, episode_count, series_status,
      rating_imdb, rating_tmdb, rating_rt, content_rating, original_language,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
    input.library_key ?? null,
    input.genres && input.genres.length > 0 ? JSON.stringify(input.genres) : null,
    input.tags && input.tags.length > 0 ? JSON.stringify(input.tags) : null,
    input.studio ?? null,
    input.audio_codec ?? null,
    input.video_codec ?? null,
    input.hdr ?? null,
    input.bitrate ?? null,
    input.runtime_minutes ?? null,
    input.season_count ?? null,
    input.episode_count ?? null,
    input.series_status ?? null,
    input.rating_imdb ?? null,
    input.rating_tmdb ?? null,
    input.rating_rt ?? null,
    input.content_rating ?? null,
    input.original_language ?? null,
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
  if (input.genres !== undefined) {
    updates.push('genres = ?');
    params.push(input.genres && input.genres.length > 0 ? JSON.stringify(input.genres) : null);
  }
  if (input.tags !== undefined) {
    updates.push('tags = ?');
    params.push(input.tags && input.tags.length > 0 ? JSON.stringify(input.tags) : null);
  }
  if (input.studio !== undefined) {
    updates.push('studio = ?');
    params.push(input.studio);
  }
  if (input.audio_codec !== undefined) {
    updates.push('audio_codec = ?');
    params.push(input.audio_codec);
  }
  if (input.video_codec !== undefined) {
    updates.push('video_codec = ?');
    params.push(input.video_codec);
  }
  if (input.hdr !== undefined) {
    updates.push('hdr = ?');
    params.push(input.hdr);
  }
  if (input.bitrate !== undefined) {
    updates.push('bitrate = ?');
    params.push(input.bitrate);
  }
  if (input.runtime_minutes !== undefined) {
    updates.push('runtime_minutes = ?');
    params.push(input.runtime_minutes);
  }
  if (input.season_count !== undefined) {
    updates.push('season_count = ?');
    params.push(input.season_count);
  }
  if (input.episode_count !== undefined) {
    updates.push('episode_count = ?');
    params.push(input.episode_count);
  }
  if (input.series_status !== undefined) {
    updates.push('series_status = ?');
    params.push(input.series_status);
  }
  if (input.rating_imdb !== undefined) {
    updates.push('rating_imdb = ?');
    params.push(input.rating_imdb);
  }
  if (input.rating_tmdb !== undefined) {
    updates.push('rating_tmdb = ?');
    params.push(input.rating_tmdb);
  }
  if (input.rating_rt !== undefined) {
    updates.push('rating_rt = ?');
    params.push(input.rating_rt);
  }
  if (input.content_rating !== undefined) {
    updates.push('content_rating = ?');
    params.push(input.content_rating);
  }
  if (input.original_language !== undefined) {
    updates.push('original_language = ?');
    params.push(input.original_language);
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

export function deleteByLibraryKey(libraryKey: string): number {
  const db = getDatabase();
  const stmt = db.prepare('DELETE FROM media_items WHERE library_key = ?');
  const result = stmt.run(libraryKey);
  logger.info(`Deleted ${result.changes} media items from library ${libraryKey}`);
  return result.changes;
}

export function deleteByPlexIds(plexIds: string[]): number {
  if (plexIds.length === 0) return 0;
  const db = getDatabase();
  let totalChanges = 0;
  const CHUNK = 500;
  for (let i = 0; i < plexIds.length; i += CHUNK) {
    const chunk = plexIds.slice(i, i + CHUNK);
    const placeholders = chunk.map(() => '?').join(',');
    const stmt = db.prepare(`DELETE FROM media_items WHERE plex_id IN (${placeholders})`);
    totalChanges += stmt.run(...chunk).changes;
  }
  if (totalChanges > 0) logger.info(`Deleted ${totalChanges} media items by plex_id`);
  return totalChanges;
}

export function deleteByTitles(titles: string[]): number {
  if (titles.length === 0) return 0;
  const db = getDatabase();
  let totalChanges = 0;
  const CHUNK = 500;
  for (let i = 0; i < titles.length; i += CHUNK) {
    const chunk = titles.slice(i, i + CHUNK);
    const placeholders = chunk.map(() => '?').join(',');
    const stmt = db.prepare(`DELETE FROM media_items WHERE title IN (${placeholders})`);
    totalChanges += stmt.run(...chunk).changes;
  }
  if (totalChanges > 0) logger.info(`Deleted ${totalChanges} media items by title match`);
  return totalChanges;
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
  deleteByLibraryKey,
  deleteByPlexIds,
  deleteByTitles,
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
