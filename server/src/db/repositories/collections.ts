import { getDatabase } from '../index';
import logger from '../../utils/logger';

export interface Collection {
  id: number;
  tmdb_id: number | null;
  title: string;
  overview: string | null;
  poster_url: string | null;
  item_count: number;
  is_protected: boolean;
  protection_reason: string | null;
  protected_at: string | null;
  last_synced_at: string | null;
  created_at: string;
  updated_at: string;
}

interface CollectionRow {
  id: number;
  tmdb_id: number | null;
  title: string;
  overview: string | null;
  poster_url: string | null;
  item_count: number;
  is_protected: number;
  protection_reason: string | null;
  protected_at: string | null;
  last_synced_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CollectionUpsertInput {
  tmdb_id: number;
  title: string;
  overview?: string | null;
  poster_url?: string | null;
  item_count?: number;
}

function rowToCollection(row: CollectionRow): Collection {
  return {
    ...row,
    is_protected: Boolean(row.is_protected),
  };
}

export function findAll(): Collection[] {
  const db = getDatabase();
  const stmt = db.prepare<[], CollectionRow>(
    'SELECT * FROM collections ORDER BY title ASC'
  );
  return stmt.all().map(rowToCollection);
}

export function findById(id: number): Collection | null {
  const db = getDatabase();
  const stmt = db.prepare<[number], CollectionRow>(
    'SELECT * FROM collections WHERE id = ?'
  );
  const row = stmt.get(id);
  return row ? rowToCollection(row) : null;
}

export function findByTmdbId(tmdbId: number): Collection | null {
  const db = getDatabase();
  const stmt = db.prepare<[number], CollectionRow>(
    'SELECT * FROM collections WHERE tmdb_id = ?'
  );
  const row = stmt.get(tmdbId);
  return row ? rowToCollection(row) : null;
}

export function upsert(input: CollectionUpsertInput): Collection {
  const db = getDatabase();
  const now = new Date().toISOString();

  const existing = findByTmdbId(input.tmdb_id);
  if (existing) {
    const updateStmt = db.prepare<[string, string | null, string | null, number, string, string, number]>(
      `UPDATE collections
       SET title = ?, overview = ?, poster_url = ?, item_count = ?, last_synced_at = ?, updated_at = ?
       WHERE id = ?`
    );
    updateStmt.run(
      input.title,
      input.overview ?? null,
      input.poster_url ?? null,
      input.item_count ?? 0,
      now,
      now,
      existing.id
    );
    const updated = findById(existing.id);
    if (!updated) throw new Error(`Failed to retrieve collection after update: ${existing.id}`);
    return updated;
  }

  const insertStmt = db.prepare<[number, string, string | null, string | null, number, string, string, string]>(
    `INSERT INTO collections (tmdb_id, title, overview, poster_url, item_count, last_synced_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const result = insertStmt.run(
    input.tmdb_id,
    input.title,
    input.overview ?? null,
    input.poster_url ?? null,
    input.item_count ?? 0,
    now,
    now,
    now
  );
  const created = findById(Number(result.lastInsertRowid));
  if (!created) throw new Error('Failed to retrieve collection after insert');
  return created;
}

/**
 * Replace the full set of media items associated with a collection.
 * Runs in a transaction: deletes old membership rows, then inserts the new set.
 */
export function setMembership(collectionId: number, mediaItemIds: number[]): void {
  const db = getDatabase();

  const tx = db.transaction((ids: number[]) => {
    const deleteStmt = db.prepare<[number]>(
      'DELETE FROM collection_items WHERE collection_id = ?'
    );
    deleteStmt.run(collectionId);

    if (ids.length === 0) return;

    const insertStmt = db.prepare<[number, number]>(
      'INSERT OR IGNORE INTO collection_items (collection_id, media_item_id) VALUES (?, ?)'
    );
    for (const mediaItemId of ids) {
      insertStmt.run(collectionId, mediaItemId);
    }
  });

  tx(mediaItemIds);
  logger.debug(`Set ${mediaItemIds.length} membership rows for collection ${collectionId}`);
}

/**
 * Find all collections that a given media item belongs to.
 */
export function findByMediaItem(mediaItemId: number): Collection[] {
  const db = getDatabase();
  const stmt = db.prepare<[number], CollectionRow>(
    `SELECT c.* FROM collections c
     INNER JOIN collection_items ci ON ci.collection_id = c.id
     WHERE ci.media_item_id = ?
     ORDER BY c.title ASC`
  );
  return stmt.all(mediaItemId).map(rowToCollection);
}

/**
 * Set (or clear) protection on a collection.
 */
export function setProtection(
  id: number,
  isProtected: boolean,
  reason?: string | null
): Collection | null {
  const db = getDatabase();
  const now = new Date().toISOString();

  const stmt = db.prepare<[number, string | null, string | null, string, number]>(
    `UPDATE collections
     SET is_protected = ?, protection_reason = ?, protected_at = ?, updated_at = ?
     WHERE id = ?`
  );
  stmt.run(
    isProtected ? 1 : 0,
    isProtected ? (reason ?? 'Protected collection') : null,
    isProtected ? now : null,
    now,
    id
  );
  return findById(id);
}

/**
 * Find protected collections that contain a given media item.
 * Used by the deletion engine to prevent deleting items in protected collections.
 */
export function findProtectedContainingItem(mediaItemId: number): Collection[] {
  const db = getDatabase();
  const stmt = db.prepare<[number], CollectionRow>(
    `SELECT c.* FROM collections c
     INNER JOIN collection_items ci ON ci.collection_id = c.id
     WHERE ci.media_item_id = ? AND c.is_protected = 1
     ORDER BY c.title ASC`
  );
  return stmt.all(mediaItemId).map(rowToCollection);
}

/**
 * Get all media item IDs that belong to a given collection.
 */
export function getMediaItemIds(collectionId: number): number[] {
  const db = getDatabase();
  const stmt = db.prepare<[number], { media_item_id: number }>(
    'SELECT media_item_id FROM collection_items WHERE collection_id = ? ORDER BY added_at ASC'
  );
  return stmt.all(collectionId).map((r) => r.media_item_id);
}

export default {
  findAll,
  findById,
  findByTmdbId,
  upsert,
  setMembership,
  findByMediaItem,
  setProtection,
  findProtectedContainingItem,
  getMediaItemIds,
};
