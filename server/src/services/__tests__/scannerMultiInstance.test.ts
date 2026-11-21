import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import fs from 'fs';

// Scanning with several Sonarr/Radarr instances feeding one media server
// library: each item is linked to the instance that holds it, ids that repeat
// across instances don't collide, and a movie kept in two instances is told
// apart by its file path.

const { tmpDbPath } = vi.hoisted(() => {
  const osMod = require('os');
  const pathMod = require('path');
  return { tmpDbPath: pathMod.join(osMod.tmpdir(), `prunerr-multiarr-test-${process.pid}-${Date.now()}.db`) };
});

vi.mock('../../config', async (importOriginal) => {
  const actual = (await importOriginal()) as { default: Record<string, unknown> };
  return { default: { ...actual.default, dbPath: tmpDbPath, nodeEnv: 'test' } };
});
vi.mock('../../utils/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { initializeDatabase, closeDatabase, getDatabase } from '../../db/index';
import mediaItemsRepo from '../../db/repositories/mediaItems';
import episodeDeletionsRepo from '../../db/repositories/episodeDeletions';
import { ScannerService } from '../scanner';
import { syncRadarrCollections } from '../radarr';
import { buildArrDrives } from '../arrStorage';

interface FakeInstance {
  id: string;
  name: string;
  client: Record<string, unknown>;
}

type ScannerInternals = {
  sonarrInstances: FakeInstance[];
  radarrInstances: FakeInstance[];
  watchHistoryProvider: null;
  overseerr: null;
  buildCaches: () => Promise<void>;
  matchPlexToArr: (item: unknown, libraryType?: string) => Promise<Record<string, unknown> | undefined>;
  convertToMediaItemInput: (data: unknown) => Record<string, unknown>;
  wasArrInstanceRead: (id: string) => boolean;
};

const movie = (id: number, tmdbId: number, title: string, path: string, tags: number[] = []) => ({ id, tmdbId, title, path, tags, year: 2010 });
const series = (id: number, tvdbId: number, title: string, tags: number[] = []) => ({ id, tvdbId, title, path: `/tv/${title}`, tags, year: 2000 });

function plexMovie(ratingKey: string, tmdbId: number, file: string) {
  return { ratingKey, title: 't', type: 'movie', guids: [{ id: `tmdb://${tmdbId}` }], media: [{ parts: [{ file, size: 1 }] }] };
}

beforeAll(() => {
  initializeDatabase();
});

afterAll(() => {
  closeDatabase();
  for (const s of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(tmpDbPath + s); } catch { /* ignore */ }
  }
});

describe('scanning several Sonarr/Radarr instances', () => {
  let scanner: ScannerInternals;

  beforeAll(async () => {
    scanner = new ScannerService() as unknown as ScannerInternals;
    scanner.watchHistoryProvider = null;
    scanner.overseerr = null;
    scanner.sonarrInstances = [
      {
        id: 'sonarr',
        name: 'Sonarr',
        client: { getSeries: async () => [series(1, 81189, 'Breaking Bad', [1])], getTags: async () => new Map([[1, 'keep']]), getEpisodeFiles: async () => [] },
      },
      {
        id: 'sonarr-anime',
        name: 'Sonarr Anime',
        client: { getSeries: async () => [series(1, 76885, 'Cowboy Bebop', [1])], getTags: async () => new Map([[1, 'anime']]), getEpisodeFiles: async () => [] },
      },
    ];
    scanner.radarrInstances = [
      {
        id: 'radarr',
        name: 'Radarr',
        client: {
          getMovies: async () => [movie(1, 550, 'Fight Club', '/movies/Fight Club (1999)'), movie(3, 157336, 'Interstellar', '/movies/Interstellar (2014)')],
          getTags: async () => new Map(),
        },
      },
      {
        id: 'radarr-4k',
        name: 'Radarr 4K',
        client: {
          getMovies: async () => [movie(1, 27205, 'Inception', '/movies4k/Inception (2010)'), movie(3, 157336, 'Interstellar', '/movies4k/Interstellar (2014)')],
          getTags: async () => new Map(),
        },
      },
      {
        id: 'radarr-down',
        name: 'Radarr Down',
        client: { getMovies: async () => { throw new Error('unreachable'); }, getTags: async () => new Map() },
      },
    ];
    await scanner.buildCaches();
  });

  it('links each item to the instance holding it, even when ids repeat', async () => {
    expect(await scanner.matchPlexToArr(plexMovie('a', 550, '/data/movies/Fight Club (1999)/f.mkv'), 'movie')).toMatchObject({ radarrId: 1, arrInstance: 'radarr' });
    expect(await scanner.matchPlexToArr(plexMovie('b', 27205, '/data/movies4k/Inception (2010)/i.mkv'), 'movie')).toMatchObject({ radarrId: 1, arrInstance: 'radarr-4k' });
    const bebop = { ratingKey: 'c', title: 'Cowboy Bebop', type: 'show', guids: [{ id: 'tvdb://76885' }] };
    expect(await scanner.matchPlexToArr(bebop, 'show')).toMatchObject({ sonarrId: 1, arrInstance: 'sonarr-anime' });
  });

  it('tells two copies of one movie apart by the folder its file is in', async () => {
    // The media server mounts the disks under /data, the Radarrs at the root.
    const hd = await scanner.matchPlexToArr(plexMovie('d', 157336, '/data/movies/Interstellar (2014)/x.mkv'), 'movie');
    const uhd = await scanner.matchPlexToArr(plexMovie('e', 157336, '/data/movies4k/Interstellar (2014)/x.mkv'), 'movie');
    expect(hd).toMatchObject({ radarrId: 3, arrInstance: 'radarr' });
    expect(uhd).toMatchObject({ radarrId: 3, arrInstance: 'radarr-4k' });
  });

  it('keeps the first instance’s copy when the path says nothing', async () => {
    const match = await scanner.matchPlexToArr(plexMovie('f', 157336, '/elsewhere/x.mkv'), 'movie');
    expect(match).toMatchObject({ arrInstance: 'radarr' });
  });

  it('resolves tags with the instance’s own tag ids', async () => {
    const bebop = { ratingKey: 'c', title: 'Cowboy Bebop', type: 'show', guids: [{ id: 'tvdb://76885' }] };
    const arrData = await scanner.matchPlexToArr(bebop, 'show');
    const input = scanner.convertToMediaItemInput({ plexItem: bebop, arrData, libraryKey: '2' });
    expect(input['tags']).toEqual(['anime']);
    expect(input['arr_instance']).toBe('sonarr-anime');
  });

  it('leaves links alone for unmatched items, and knows which instances it read', async () => {
    const input = scanner.convertToMediaItemInput({ plexItem: plexMovie('g', 999, '/x.mkv'), libraryKey: '1' });
    expect(input['radarr_id']).toBeUndefined();
    expect(input['arr_instance']).toBeUndefined();
    expect(scanner.wasArrInstanceRead('radarr-4k')).toBe(true);
    expect(scanner.wasArrInstanceRead('radarr-down')).toBe(false);
  });
});

describe('instance bookkeeping in the database', () => {
  it('runs the new migrations', () => {
    const db = getDatabase();
    const cols = (t: string) => (db.prepare(`PRAGMA table_info(${t})`).all() as Array<{ name: string }>).map((c) => c.name);
    expect(cols('media_items')).toContain('arr_instance');
    expect(cols('episode_deletions')).toContain('arr_instance');
    const indexes = (db.prepare("SELECT name FROM sqlite_master WHERE type='index'").all() as Array<{ name: string }>).map((r) => r.name);
    expect(indexes).toContain('idx_media_items_arr_instance');
  });

  it('unlinks items of removed instances and of an instance that changed server', () => {
    const make = (title: string, type: 'movie' | 'show', ids: { radarr_id?: number; sonarr_id?: number }, arr_instance: string | null) =>
      mediaItemsRepo.create({ type, title, plex_id: `p-${title}`, ...ids, arr_instance }).id;
    const legacy = make('Legacy', 'movie', { radarr_id: 1 }, null);
    const primary = make('Primary', 'movie', { radarr_id: 2 }, 'radarr');
    const uhd = make('UHD', 'movie', { radarr_id: 1 }, 'radarr-4k');
    const gone = make('Gone', 'movie', { radarr_id: 5 }, 'radarr-gone');
    const tv = make('TV', 'show', { sonarr_id: 1 }, null);

    mediaItemsRepo.clearUnknownArrInstanceLinks(['sonarr', 'radarr', 'radarr-4k']);
    expect(mediaItemsRepo.getById(gone)).toMatchObject({ radarr_id: null, arr_instance: null });
    expect(mediaItemsRepo.getById(uhd)).toMatchObject({ radarr_id: 1, arr_instance: 'radarr-4k' });

    // The primary Radarr now points at another server: its items (with or
    // without an explicit instance) are unlinked; Sonarr's and the 4K's stay.
    mediaItemsRepo.clearArrInstanceLinksFor('radarr', 'radarr', true);
    expect(mediaItemsRepo.getById(legacy)).toMatchObject({ radarr_id: null });
    expect(mediaItemsRepo.getById(primary)).toMatchObject({ radarr_id: null });
    expect(mediaItemsRepo.getById(uhd)).toMatchObject({ radarr_id: 1 });
    expect(mediaItemsRepo.getById(tv)).toMatchObject({ sonarr_id: 1 });
  });

  it('queues the same episode id for shows in different instances', () => {
    const a = mediaItemsRepo.create({ type: 'show', title: 'A', plex_id: 'ep-a', sonarr_id: 1, arr_instance: 'sonarr' }).id;
    const b = mediaItemsRepo.create({ type: 'show', title: 'B', plex_id: 'ep-b', sonarr_id: 1, arr_instance: 'sonarr-anime' }).id;
    const row = (media_item_id: number, arr_instance: string) => ({
      media_item_id, series_id: 1, arr_instance, season_number: 1, episode_number: 1, episode_id: 100,
      series_title: 'x', episode_title: 'y', deletion_action: 'delete_files_only', delete_after: new Date().toISOString(),
    });
    const created = episodeDeletionsRepo.createMany([row(a, 'sonarr'), row(b, 'sonarr-anime')]);
    expect(created).toHaveLength(2);
    expect(created.map((r) => r.arr_instance).sort()).toEqual(['sonarr', 'sonarr-anime']);
    // The same episode of the same show is still only queued once.
    expect(episodeDeletionsRepo.createMany([row(a, 'sonarr')])).toHaveLength(0);
  });

  it('merges a collection that two Radarrs both have', async () => {
    const m1 = mediaItemsRepo.create({ type: 'movie', title: 'Dark Knight', plex_id: 'c1', tmdb_id: 155 }).id;
    const m2 = mediaItemsRepo.create({ type: 'movie', title: 'Dark Knight Rises', plex_id: 'c2', tmdb_id: 49026 }).id;
    const collection = (movies: number[]) => ({
      tmdbId: 263, title: 'The Dark Knight Collection', images: [],
      movies: movies.map((tmdbId) => ({ tmdbId, isExisting: true })),
    });
    const result = await syncRadarrCollections([
      { getCollections: async () => [collection([155])] },
      { getCollections: async () => [collection([49026])] },
      { getCollections: async () => { throw new Error('down'); } },
    ] as never);
    expect(result).toEqual({ collectionsSynced: 1, itemsMatched: 2 });
    const members = getDatabase()
      .prepare('SELECT media_item_id FROM collection_items ORDER BY media_item_id')
      .all() as Array<{ media_item_id: number }>;
    expect(members.map((r) => r.media_item_id)).toEqual([m1, m2]);
  });
});

describe('drives per instance', () => {
  it('records which instances keep media on each drive', () => {
    const disk = (path: string, total: number) => ({ path, label: '', totalSpace: total, freeSpace: total / 2 });
    const drives = buildArrDrives([
      { app: 'radarr', instanceId: 'radarr', diskSpace: [disk('/movies', 1000)], rootFolders: [{ id: 1, path: '/movies', accessible: true, freeSpace: 500 }] },
      { app: 'radarr', instanceId: 'radarr-4k', diskSpace: [disk('/movies4k', 4000)], rootFolders: [{ id: 1, path: '/movies4k', accessible: true, freeSpace: 2000 }] },
      { app: 'sonarr', instanceId: 'sonarr', diskSpace: [disk('/tv', 1000)], rootFolders: [{ id: 1, path: '/tv', accessible: true, freeSpace: 500 }] },
    ] as never);
    const byTotal = Object.fromEntries(drives.map((d) => [d.totalBytes, d.instances]));
    expect(byTotal[4000]).toEqual(['radarr-4k']);
    // Same size and free space: treated as one drive shared by two instances.
    expect(byTotal[1000]).toEqual(['radarr', 'sonarr']);
  });
});
