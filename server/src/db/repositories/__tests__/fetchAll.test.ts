import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import fs from 'fs';

const { tmpDbPath } = vi.hoisted(() => {
  const osMod = require('os');
  const pathMod = require('path');
  return {
    tmpDbPath: pathMod.join(osMod.tmpdir(), `prunerr-fetchall-test-${process.pid}-${Date.now()}.db`),
  };
});

vi.mock('../../../config', () => ({
  default: { dbPath: tmpDbPath, nodeEnv: 'test' },
}));

vi.mock('../../../utils/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { initializeDatabase, getDatabase, closeDatabase } from '../../index';
import { createMediaItem, fetchAllMediaItems } from '../mediaItems';

describe('fetchAllMediaItems', () => {
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

  function seed(n: number, type = 'movie') {
    for (let i = 0; i < n; i++) {
      createMediaItem({
        type, title: `${type}-${i}`, plex_id: `rk-${type}-${i}`, library_key: '1',
      } as never);
    }
  }

  it('returns every row even when the count exceeds one page', () => {
    seed(25);

    // batchSize forces multiple round trips without seeding 10k rows.
    const items = fetchAllMediaItems({}, 10);

    expect(items).toHaveLength(25);
    expect(new Set(items.map((i) => i.id)).size).toBe(25);
  });

  it('applies filters across all pages', () => {
    seed(12, 'movie');
    seed(8, 'show');

    const items = fetchAllMediaItems({ type: 'movie' }, 5);

    expect(items).toHaveLength(12);
    expect(items.every((i) => i.type === 'movie')).toBe(true);
  });

  it('excludes tombstones when asked, across pages', () => {
    seed(20);
    getDatabase()
      .prepare("UPDATE media_items SET status = 'deleted' WHERE title LIKE 'movie-1%'")
      .run();

    const items = fetchAllMediaItems({ excludeDeleted: true }, 6);

    // movie-1 and movie-10..19 => 11 tombstoned, 9 left.
    expect(items).toHaveLength(9);
    expect(items.every((i) => i.status !== 'deleted')).toBe(true);
  });

  it('handles an empty table', () => {
    expect(fetchAllMediaItems({}, 10)).toEqual([]);
  });
});
