import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import fs from 'fs';

// A sync has to carry a show's episode count and per-person progress from the
// watch history provider all the way to the row it writes. These fields were
// once dropped in between, which silently disabled per-person protection.

const { tmpDbPath } = vi.hoisted(() => {
  const osMod = require('os');
  const pathMod = require('path');
  return { tmpDbPath: pathMod.join(osMod.tmpdir(), `prunerr-scanner-test-${process.pid}-${Date.now()}.db`) };
});

vi.mock('../../config', async (importOriginal) => {
  const actual = (await importOriginal()) as { default: Record<string, unknown> };
  return { default: { ...actual.default, dbPath: tmpDbPath, nodeEnv: 'test' } };
});
vi.mock('../../utils/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { initializeDatabase, closeDatabase } from '../../db/index';
import { ScannerService } from '../scanner';

describe('scanner: watch data reaches the stored item', () => {
  beforeAll(() => initializeDatabase());
  afterAll(() => {
    closeDatabase();
    for (const s of ['', '-wal', '-shm']) {
      try { fs.unlinkSync(tmpDbPath + s); } catch { /* ignore */ }
    }
  });

  it('stores episodes watched and per-person progress for a show', async () => {
    const progress = {
      ben: { watched: 9, lastWatched: '2026-09-29T20:00:00.000Z' },
      harry: { watched: 26, lastWatched: '2026-09-01T20:00:00.000Z' },
    };
    const provider = {
      testConnection: async () => true,
      getItemWatchedStatus: vi.fn(),
      getShowWatchedStatus: vi.fn(async () => ({
        playCount: 40,
        lastWatched: new Date('2026-09-29T20:00:00.000Z'),
        watchedBy: ['ben', 'harry'],
        episodesWatched: 26,
        episodeProgress: progress,
      })),
      clearCache: () => undefined,
    };

    const scanner = new ScannerService() as unknown as {
      watchHistoryProvider: unknown;
      plex: unknown;
      processPlexItem: (item: unknown, libraryType: string) => Promise<unknown>;
      convertToMediaItemInput: (data: unknown) => Record<string, unknown>;
    };
    scanner.watchHistoryProvider = provider;
    scanner.plex = null;

    const synced = await scanner.processPlexItem(
      {
        ratingKey: 'show-1',
        title: 'The Summer I Turned Pretty',
        type: 'show',
        guids: [{ id: 'tvdb://1' }],
        leafCount: 26,
        viewedLeafCount: 3,
      },
      'show'
    );
    const input = scanner.convertToMediaItemInput(synced);

    expect(provider.getShowWatchedStatus).toHaveBeenCalledWith('show-1', 'The Summer I Turned Pretty');
    // The history saw more than Plex's own (owner-only) count.
    expect(input['watched_episode_count']).toBe(26);
    expect(JSON.parse(String(input['episode_progress']))).toEqual(progress);
  });
});
