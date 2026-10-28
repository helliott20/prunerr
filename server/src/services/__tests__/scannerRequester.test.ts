import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import fs from 'fs';

// "Requested by" has to resolve for every item Seerr knows about, not only
// ones with a TMDB id from the media server that also matched Sonarr/Radarr.
// Plex libraries on the legacy agents carry only an IMDb or TVDB id, which
// once left the requester list empty.

const { tmpDbPath } = vi.hoisted(() => {
  const osMod = require('os');
  const pathMod = require('path');
  return { tmpDbPath: pathMod.join(osMod.tmpdir(), `prunerr-requester-test-${process.pid}-${Date.now()}.db`) };
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
import { OverseerrService } from '../overseerr';

type ScannerInternals = {
  plex: unknown;
  watchHistoryProvider: unknown;
  overseerr: unknown;
  requesterIndex: unknown;
  radarrTmdbIndex: Map<number, unknown>;
  radarrImdbIndex: Map<string, unknown>;
  sonarrTvdbIndex: Map<number, unknown>;
  sonarr: unknown;
  processPlexItem: (item: unknown, libraryType: string) => Promise<unknown>;
  convertToMediaItemInput: (data: unknown) => Record<string, unknown>;
};

// Shapes as Seerr 3.5's GET /api/v1/request returns them (movie media has no imdbId).
const requests = [
  { id: 1, type: 'movie', media: { tmdbId: 550, tvdbId: null, imdbId: null }, requestedBy: { displayName: 'Alice' } },
  { id: 2, type: 'movie', media: { tmdbId: 603, tvdbId: null, imdbId: null }, requestedBy: { displayName: 'bob_jf' } },
  { id: 3, type: 'tv', media: { tmdbId: 1396, tvdbId: 81189, imdbId: null }, requestedBy: { displayName: 'Alice' } },
  // A later request for more seasons keeps the original requester.
  { id: 4, type: 'tv', media: { tmdbId: 1396, tvdbId: 81189, imdbId: null }, requestedBy: { displayName: 'Carol' } },
];

async function buildIndex() {
  const service = new OverseerrService('http://seerr.test', 'key');
  vi.spyOn(service, 'getRequests').mockResolvedValue(requests as never);
  return service.getRequesterIndex();
}

describe('scanner: requester from the Seerr request list', () => {
  let scanner: ScannerInternals;

  beforeAll(async () => {
    initializeDatabase();
    scanner = new ScannerService() as unknown as ScannerInternals;
    scanner.plex = null;
    scanner.watchHistoryProvider = null;
    scanner.sonarr = null;
    scanner.requesterIndex = await buildIndex();
  });
  afterAll(() => {
    closeDatabase();
    for (const s of ['', '-wal', '-shm']) {
      try { fs.unlinkSync(tmpDbPath + s); } catch { /* ignore */ }
    }
  });

  const requestedBy = async (item: Record<string, unknown>, type: string) =>
    scanner.convertToMediaItemInput(await scanner.processPlexItem(item, type))['requested_by'];

  it('matches a legacy-agent movie through the Radarr TMDB id', async () => {
    scanner.radarrImdbIndex.set('tt0137523', { id: 1, tmdbId: 550, imdbId: 'tt0137523' });
    const item = {
      ratingKey: '101',
      title: 'Fight Club',
      type: 'movie',
      guid: 'com.plexapp.agents.imdb://tt0137523?lang=en',
      guids: [{ id: 'imdb://tt0137523' }],
    };
    expect(await requestedBy(item, 'movie')).toBe('Alice');
  });

  it('matches a movie that is not in Radarr', async () => {
    const item = {
      ratingKey: '102',
      title: 'The Matrix',
      type: 'movie',
      guid: 'plex://movie/abc',
      guids: [{ id: 'tmdb://603' }],
    };
    expect(await requestedBy(item, 'movie')).toBe('bob_jf');
  });

  it('matches a legacy-agent show by TVDB id and keeps the first requester', async () => {
    const item = {
      ratingKey: '201',
      title: 'Breaking Bad',
      type: 'show',
      guid: 'com.plexapp.agents.thetvdb://81189?lang=en',
      guids: [{ id: 'tvdb://81189' }],
    };
    expect(await requestedBy(item, 'show')).toBe('Alice');
  });

  it('stores null for an item nobody requested', async () => {
    const item = { ratingKey: '103', title: 'Unrequested', type: 'movie', guids: [{ id: 'tmdb://1' }] };
    expect(await requestedBy(item, 'movie')).toBeNull();
  });

  it('leaves requested_by untouched when the request list could not be loaded', async () => {
    const saved = scanner.requesterIndex;
    scanner.requesterIndex = null;
    try {
      const item = { ratingKey: '102', title: 'The Matrix', type: 'movie', guids: [{ id: 'tmdb://603' }] };
      expect(await requestedBy(item, 'movie')).toBeUndefined();
    } finally {
      scanner.requesterIndex = saved;
    }
  });
});
