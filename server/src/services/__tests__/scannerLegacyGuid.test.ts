import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import fs from 'fs';

// Issue #109: Plex's legacy TMDB agent reports `com.plexapp.agents.themoviedb://<id>`,
// which the scan didn't recognise, so those movies were never linked to Radarr.

const { tmpDbPath } = vi.hoisted(() => {
  const osMod = require('os');
  const pathMod = require('path');
  return { tmpDbPath: pathMod.join(osMod.tmpdir(), `prunerr-legacyguid-test-${process.pid}-${Date.now()}.db`) };
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

type ScannerInternals = {
  radarrTmdbIndex: Map<number, { id: number; tmdbId: number }>;
  matchPlexToArr: (item: unknown, libraryType?: string) => Promise<{ radarrId?: number } | undefined>;
};

describe('matching Plex movies to Radarr', () => {
  let scanner: ScannerInternals;

  beforeAll(() => {
    initializeDatabase();
    scanner = new ScannerService() as unknown as ScannerInternals;
    scanner.radarrTmdbIndex.set(345887, { id: 77, tmdbId: 345887 });
  });
  afterAll(() => {
    closeDatabase();
    for (const s of ['', '-wal', '-shm']) {
      try { fs.unlinkSync(tmpDbPath + s); } catch { /* ignore */ }
    }
  });

  it.each([
    ['current agent', { guid: 'plex://movie/5d776be17a53e9001e732ab9', guids: [{ id: 'tmdb://345887' }] }],
    ['legacy TMDB agent', { guid: 'com.plexapp.agents.themoviedb://345887?lang=en', guids: [] }],
  ])('links a movie from the %s', async (_label, ids) => {
    const match = await scanner.matchPlexToArr({ ratingKey: '1', title: 'Maze Runner', type: 'movie', ...ids }, 'movie');
    expect(match?.radarrId).toBe(77);
  });
});
