import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import fs from 'fs';

// Real on-disk SQLite (better-sqlite3 needs a file for WAL). Point config at a
// temp DB before the db module reads it, and silence the logger. Computed via
// vi.hoisted so it's available inside the hoisted vi.mock factory below.
const { tmpDbPath } = vi.hoisted(() => {
  const osMod = require('os');
  const pathMod = require('path');
  return {
    tmpDbPath: pathMod.join(osMod.tmpdir(), `prunerr-libkey-test-${process.pid}-${Date.now()}.db`),
  };
});

vi.mock('../../../config', () => ({
  default: { dbPath: tmpDbPath, nodeEnv: 'test' },
}));

vi.mock('../../../utils/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { initializeDatabase, getDatabase, closeDatabase } from '../../index';
import { createMediaItem, updateMediaItem, getMediaItemById } from '../mediaItems';

describe('updateMediaItem library_key', () => {
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

  it('backfills library_key on rows created without one (pre-migration items)', () => {
    // Rows created before the library_key column existed have NULL — a sync
    // update must be able to fill it in, or library-targeted rules can never
    // match older content.
    const item = createMediaItem({ type: 'movie', title: 'Old Movie', plex_id: 'rk-old' });
    expect(getMediaItemById(item.id)?.library_key ?? null).toBeNull();

    updateMediaItem(item.id, { title: 'Old Movie', library_key: '1' });

    expect(getMediaItemById(item.id)?.library_key).toBe('1');
  });

  it('updates library_key when an item moves between Plex libraries', () => {
    const item = createMediaItem({ type: 'movie', title: 'Mover', plex_id: 'rk-mover', library_key: '1' });

    updateMediaItem(item.id, { library_key: '4' });

    expect(getMediaItemById(item.id)?.library_key).toBe('4');
  });

  it('leaves library_key untouched when the update omits it', () => {
    const item = createMediaItem({ type: 'movie', title: 'Keeper', plex_id: 'rk-keeper', library_key: '2' });

    updateMediaItem(item.id, { title: 'Keeper (renamed)' });

    expect(getMediaItemById(item.id)?.library_key).toBe('2');
  });
});
