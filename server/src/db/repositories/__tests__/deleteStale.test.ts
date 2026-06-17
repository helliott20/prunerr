import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import fs from 'fs';

// Real on-disk SQLite (better-sqlite3 needs a file for WAL). Point config at a
// temp DB before the db module reads it, and silence the logger. Computed via
// vi.hoisted so it's available inside the hoisted vi.mock factory below.
const { tmpDbPath } = vi.hoisted(() => {
  const osMod = require('os');
  const pathMod = require('path');
  return {
    tmpDbPath: pathMod.join(osMod.tmpdir(), `prunerr-stale-test-${process.pid}-${Date.now()}.db`),
  };
});

vi.mock('../../../config', () => ({
  default: { dbPath: tmpDbPath, nodeEnv: 'test' },
}));

vi.mock('../../../utils/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { initializeDatabase, getDatabase, closeDatabase } from '../../index';
import { createMediaItem, deleteStaleByLibraryKey, getAllMediaItems } from '../mediaItems';

describe('deleteStaleByLibraryKey', () => {
  beforeAll(() => {
    initializeDatabase();
  });

  afterAll(() => {
    closeDatabase();
    for (const suffix of ['', '-wal', '-shm']) {
      try { fs.unlinkSync(tmpDbPath + suffix); } catch { /* ignore */ }
    }
  });

  beforeEach(() => {
    getDatabase().prepare('DELETE FROM media_items').run();
  });

  it('removes only rows whose plex_id is missing from the current Plex listing', () => {
    // Two distinct movies plus a stale duplicate of the first — the kind of
    // leftover a Radarr upgrade produces when Plex assigns a new ratingKey.
    createMediaItem({ type: 'movie', title: 'Alien', plex_id: 'rk-alien-new', library_key: '1' });
    createMediaItem({ type: 'movie', title: 'Alien', plex_id: 'rk-alien-old', library_key: '1' });
    createMediaItem({ type: 'movie', title: 'Aliens', plex_id: 'rk-aliens', library_key: '1' });

    const removed = deleteStaleByLibraryKey('1', ['rk-alien-new', 'rk-aliens']);
    expect(removed).toBe(1);

    const remaining = getAllMediaItems({ limit: 100 }).data.map((i) => i.plex_id).sort();
    expect(remaining).toEqual(['rk-alien-new', 'rk-aliens']);
  });

  it('never touches rows from another library', () => {
    createMediaItem({ type: 'movie', title: 'A', plex_id: 'lib1-a', library_key: '1' });
    createMediaItem({ type: 'show', title: 'B', plex_id: 'lib2-b', library_key: '2' });

    // Scanning library 1 with an empty seen set must not delete library 2's row.
    const removed = deleteStaleByLibraryKey('1', []);
    expect(removed).toBe(1);

    const remaining = getAllMediaItems({ limit: 100 }).data.map((i) => i.plex_id);
    expect(remaining).toEqual(['lib2-b']);
  });

  it('preserves soft-deleted tombstones so re-add detection keeps working', () => {
    const tombstone = createMediaItem({ type: 'movie', title: 'Gone', plex_id: 'rk-gone', library_key: '1' });
    getDatabase()
      .prepare("UPDATE media_items SET status = 'deleted', deleted_at = ? WHERE id = ?")
      .run(new Date().toISOString(), tombstone.id);

    // 'rk-gone' is absent from the listing but must survive as a tombstone.
    const removed = deleteStaleByLibraryKey('1', []);
    expect(removed).toBe(0);
  });
});
