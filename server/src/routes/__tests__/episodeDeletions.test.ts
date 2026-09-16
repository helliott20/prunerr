import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import fs from 'fs';
import express from 'express';
import type { Server } from 'http';

// Real on-disk SQLite so the episode_deletions migration actually runs; same
// temp-db + hoisting trick as rulesPreview.test.ts.
const { tmpDbPath } = vi.hoisted(() => {
  const osMod = require('os');
  const pathMod = require('path');
  return {
    tmpDbPath: pathMod.join(osMod.tmpdir(), `prunerr-episodes-test-${process.pid}-${Date.now()}.db`),
  };
});

vi.mock('../../config', () => ({ default: { dbPath: tmpDbPath, nodeEnv: 'test' } }));
vi.mock('../../utils/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// Fake Sonarr: one two-episode season, both with files.
const sonarr = {
  getSeriesById: vi.fn(async () => ({
    id: 55,
    title: 'Example Show',
    seasons: [{ seasonNumber: 1, monitored: true }],
    qualityProfileId: 1,
    genres: [],
    tags: [],
    statistics: { sizeOnDisk: 0 },
  })),
  getEpisodes: vi.fn(async () => [
    { id: 1001, seriesId: 55, seasonNumber: 1, episodeNumber: 1, title: 'Pilot', episodeFileId: 9001, hasFile: true, monitored: true, airDateUtc: '2026-01-01T00:00:00Z' },
    { id: 1002, seriesId: 55, seasonNumber: 1, episodeNumber: 2, title: 'Second', episodeFileId: 9002, hasFile: true, monitored: true, airDateUtc: '2026-01-08T00:00:00Z' },
  ]),
  getEpisodeFiles: vi.fn(async () => [
    { id: 9001, seriesId: 55, seasonNumber: 1, size: 1_000, qualityCutoffNotMet: false, relativePath: 'a.mkv', path: '/tv/a.mkv', dateAdded: '2026-01-02T00:00:00Z', quality: { quality: { id: 1, name: 'WEBDL-1080p', source: 'web', resolution: 1080 }, revision: { version: 1, real: 0, isRepack: false } } },
    { id: 9002, seriesId: 55, seasonNumber: 1, size: 2_000, qualityCutoffNotMet: false, relativePath: 'b.mkv', path: '/tv/b.mkv', dateAdded: '2026-01-09T00:00:00Z', quality: { quality: { id: 1, name: 'WEBDL-1080p', source: 'web', resolution: 1080 }, revision: { version: 1, real: 0, isRepack: false } } },
  ]),
  deleteEpisodeFile: vi.fn(async () => undefined),
  unmonitorEpisodes: vi.fn(async () => undefined),
  setSeasonMonitored: vi.fn(async () => undefined),
  getQueue: vi.fn(async () => []),
  getSeriesHistory: vi.fn(async () => [
    { id: 1, episodeId: 1001, date: '2026-02-01T10:00:00Z', eventType: 'downloadFolderImported', sourceTitle: 'Example.S01E01.1080p', quality: { quality: { id: 1, name: 'WEBDL-1080p' } } },
    { id: 2, episodeId: 1002, date: '2026-02-01T10:05:00Z', eventType: 'downloadFolderImported', sourceTitle: 'Example.S01E02.1080p', quality: { quality: { id: 1, name: 'WEBDL-1080p' } } },
    { id: 3, episodeId: 1002, date: '2026-01-20T09:00:00Z', eventType: 'grabbed' },
    { id: 4, episodeId: 1002, date: '2026-01-19T09:00:00Z', eventType: 'episodeFileRenamed' },
  ]),
  getQualityProfiles: vi.fn(async () => new Map([[1, 'HD-1080p']])),
  getTags: vi.fn(async () => new Map()),
  getSeriesByTvdbId: vi.fn(async () => null),
};

vi.mock('../../services/init', () => ({
  getSonarrService: () => sonarr,
  getRadarrService: () => null,
  getOverseerrService: () => null,
  getPlexService: () => null,
}));

vi.mock('../../services/syncCoordinator', () => ({
  isSyncInProgress: () => false,
  runLibrarySync: vi.fn(),
  subscribeToSync: vi.fn(() => () => undefined),
  getSyncProgressLog: () => [],
}));

vi.mock('../../services/deletion', () => ({
  getDeletionService: () => ({ executeDelete: vi.fn() }),
}));

vi.mock('../../notifications', () => ({
  getNotificationService: () => ({ notify: vi.fn(async () => undefined) }),
}));

vi.mock('../../scheduler/tasks', () => ({
  queueItemForDeletion: vi.fn(),
  notifyItemsQueued: vi.fn(),
  setTaskDependencies: vi.fn(),
}));

import { initializeDatabase, getDatabase, closeDatabase } from '../../db/index';
import { createMediaItem, getMediaItemById } from '../../db/repositories/mediaItems';
import libraryRouter from '../library';
import queueRouter from '../queue';

let server: Server;
let baseUrl: string;
let showId: number;

async function post(path: string, body: unknown) {
  const res = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json()) as any };
}

async function get(path: string) {
  const res = await fetch(`${baseUrl}${path}`);
  return { status: res.status, json: (await res.json()) as any };
}

describe('episode and season deletions', () => {
  beforeAll(async () => {
    initializeDatabase();
    const app = express();
    app.use(express.json());
    app.use('/library', libraryRouter);
    app.use('/queue', queueRouter);
    await new Promise<void>((resolve) => {
      server = app.listen(0, () => {
        const addr = server.address();
        baseUrl = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
        resolve();
      });
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    closeDatabase();
    for (const suffix of ['', '-wal', '-shm']) {
      try { fs.unlinkSync(tmpDbPath + suffix); } catch { /* ignore */ }
    }
  });

  beforeEach(() => {
    const db = getDatabase();
    db.prepare('DELETE FROM episode_deletions').run();
    db.prepare('DELETE FROM deletion_history').run();
    db.prepare('DELETE FROM activity_log').run();
    db.prepare('DELETE FROM media_items').run();
    vi.clearAllMocks();

    const item = createMediaItem({
      type: 'show',
      title: 'Example Show',
      sonarr_id: 55,
      file_size: 10_000,
    } as never);
    showId = item.id;
  });

  it('queues a whole season, one row per episode', async () => {
    const { json } = await post(`/library/${showId}/sonarr/deletions`, {
      seasonNumbers: [1],
      deletionAction: 'unmonitor_and_delete',
      gracePeriodDays: 7,
      mode: 'queue',
    });

    expect(json.data).toMatchObject({ queued: 2, deleted: 0 });
    expect(sonarr.deleteEpisodeFile).not.toHaveBeenCalled();
  });

  it('does not queue the same episode twice', async () => {
    const body = { seasonNumbers: [1], gracePeriodDays: 7, mode: 'queue' as const };
    await post(`/library/${showId}/sonarr/deletions`, body);
    const { json } = await post(`/library/${showId}/sonarr/deletions`, body);

    expect(json.data).toMatchObject({ queued: 0, alreadyQueued: 2 });
  });

  it('refuses to touch episodes of a protected show', async () => {
    getDatabase().prepare('UPDATE media_items SET is_protected = 1 WHERE id = ?').run(showId);

    const { status, json } = await post(`/library/${showId}/sonarr/deletions`, {
      episodeIds: [1001],
      mode: 'queue',
    });

    expect(status).toBe(409);
    expect(json.success).toBe(false);
  });

  it('surfaces queued episodes in the Sonarr detail and the deletion queue', async () => {
    await post(`/library/${showId}/sonarr/deletions`, { episodeIds: [1001], gracePeriodDays: 7, mode: 'queue' });

    const detail = await get(`/library/${showId}/sonarr`);
    const season = detail.json.data.seasons[0];
    expect(season.queuedCount).toBe(1);
    expect(season.episodes[0].queued).toBeTruthy();
    expect(season.episodes[1].queued).toBeUndefined();

    const queue = await get('/queue');
    const episodeRows = queue.json.data.filter((row: any) => row.kind === 'episode');
    expect(episodeRows).toHaveLength(1);
    expect(episodeRows[0].title).toBe('Example Show · S01E01 · Pilot');
    expect(episodeRows[0].id).toMatch(/^ep-\d+$/);
  });

  it('exposes Sonarr history as timeline events, newest first', async () => {
    const detail = await get(`/library/${showId}/sonarr`);
    const history = detail.json.data.history;

    // The rename is dropped; the rest are mapped and dated newest first.
    expect(history.map((event: any) => event.eventType)).toEqual(['imported', 'imported', 'grabbed']);
    expect(history[0]).toMatchObject({
      episodeId: 1002,
      seasonNumber: 1,
      episodeNumber: 2,
      episodeTitle: 'Second',
      quality: 'WEBDL-1080p',
    });
  });

  it('logs one grouped activity entry for a batch, not one per episode', async () => {
    await post(`/library/${showId}/sonarr/deletions`, {
      seasonNumbers: [1],
      deletionAction: 'unmonitor_and_delete',
      mode: 'now',
    });

    const entries = getDatabase()
      .prepare("SELECT * FROM activity_log WHERE event_type = 'deletion'")
      .all() as any[];

    expect(entries).toHaveLength(1);
    expect(entries[0].action).toBe('episodes_deleted');
    const meta = JSON.parse(entries[0].metadata);
    expect(meta).toMatchObject({ count: 2, freedBytes: 3_000, seasons: [1] });
    expect(meta.episodes).toEqual([
      { code: 'S01E01', title: 'Pilot', size: 1_000 },
      { code: 'S01E02', title: 'Second', size: 2_000 },
    ]);
  });

  it('cancels queued episodes', async () => {
    await post(`/library/${showId}/sonarr/deletions`, { seasonNumbers: [1], gracePeriodDays: 7, mode: 'queue' });

    const { json } = await post(`/library/${showId}/sonarr/deletions/cancel`, { episodeIds: [1001, 1002] });
    expect(json.data.cancelled).toBe(2);

    const queue = await get('/queue');
    expect(queue.json.data.filter((row: any) => row.kind === 'episode')).toHaveLength(0);
  });

  it('deletes immediately in "now" mode and records what it freed', async () => {
    const { json } = await post(`/library/${showId}/sonarr/deletions`, {
      episodeIds: [1001],
      deletionAction: 'unmonitor_and_delete',
      mode: 'now',
    });

    expect(json.data).toMatchObject({ deleted: 1, failed: 0, freedBytes: 1_000 });
    expect(sonarr.deleteEpisodeFile).toHaveBeenCalledWith(9001);
    expect(sonarr.unmonitorEpisodes).toHaveBeenCalledWith([1001]);

    // The show's recorded size drops by what was freed.
    expect(getMediaItemById(showId)?.file_size).toBe(9_000);

    const history = getDatabase().prepare('SELECT * FROM deletion_history').all() as any[];
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ type: 'episode', file_size: 1_000 });

    // Nothing is left pending afterwards.
    const queue = await get('/queue');
    expect(queue.json.data.filter((row: any) => row.kind === 'episode')).toHaveLength(0);
  });

  it('keeps files when the action only unmonitors', async () => {
    await post(`/library/${showId}/sonarr/deletions`, {
      episodeIds: [1002],
      deletionAction: 'unmonitor_only',
      mode: 'now',
    });

    expect(sonarr.deleteEpisodeFile).not.toHaveBeenCalled();
    expect(sonarr.unmonitorEpisodes).toHaveBeenCalledWith([1002]);
    expect(getMediaItemById(showId)?.file_size).toBe(10_000);
  });

  it('processes queued episodes when the queue is processed', async () => {
    await post(`/library/${showId}/sonarr/deletions`, { seasonNumbers: [1], gracePeriodDays: 30, mode: 'queue' });

    // Not due for 30 days: a normal run leaves them alone.
    const untouched = await post('/queue/process', {});
    expect(untouched.json.data.episodes?.deleted ?? 0).toBe(0);

    // Forcing processes everything pending.
    const { json } = await post('/queue/process?force=true', {});
    expect(json.data.episodes).toMatchObject({ processed: 2, deleted: 2, failed: 0 });
    expect(json.data.freedSpace).toBe(3_000);
    expect(sonarr.deleteEpisodeFile).toHaveBeenCalledTimes(2);
  });

  it('marks a row failed when Sonarr rejects the delete', async () => {
    sonarr.deleteEpisodeFile.mockRejectedValueOnce(new Error('Sonarr says no'));

    const { json } = await post(`/library/${showId}/sonarr/deletions`, {
      episodeIds: [1001],
      mode: 'now',
    });

    expect(json.data).toMatchObject({ deleted: 0, failed: 1 });
    const rows = getDatabase().prepare('SELECT * FROM episode_deletions').all() as any[];
    expect(rows[0]).toMatchObject({ status: 'failed' });
    expect(rows[0].error).toContain('Sonarr says no');
  });
});
