import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import fs from 'fs';

const { tmpDbPath } = vi.hoisted(() => {
  const osMod = require('os');
  const pathMod = require('path');
  return { tmpDbPath: pathMod.join(osMod.tmpdir(), `prunerr-viewers-test-${process.pid}-${Date.now()}.db`) };
});

vi.mock('../../config', () => ({ default: { dbPath: tmpDbPath, nodeEnv: 'test' } }));
vi.mock('../../utils/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { initializeDatabase, getDatabase, closeDatabase } from '../../db/index';
import { createMediaItem } from '../../db/repositories/mediaItems';
import { viewersFor } from '../viewers';
import type { MediaItem } from '../../types';

const NOW = new Date('2026-09-30T12:00:00Z');
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString();

function play(key: string, user: string, title: string, watched: boolean, at: string, show: string | null) {
  getDatabase()
    .prepare(
      `INSERT INTO watch_history_cache (plex_rating_key, username, watched, stopped_at, session_id, media_title, media_type, show_title)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(key, user, watched ? 1 : 0, at, `${user}-${title}-${at}`, title, show ? 'episode' : 'movie', show);
}

describe('viewersFor', () => {
  beforeAll(() => initializeDatabase());
  afterAll(() => {
    closeDatabase();
    for (const s of ['', '-wal', '-shm']) {
      try { fs.unlinkSync(tmpDbPath + s); } catch { /* ignore */ }
    }
  });
  beforeEach(() => {
    getDatabase().prepare('DELETE FROM media_items').run();
    getDatabase().prepare('DELETE FROM watch_history_cache').run();
  });

  it('lists each person through a show from stored progress, most recent first', () => {
    const show = createMediaItem({
      type: 'show', title: 'Severance', plex_id: 'show-1', episode_count: 10,
      episode_progress: JSON.stringify({
        harry: { watched: 10, lastWatched: daysAgo(20) },
        dan: { watched: 4, lastWatched: daysAgo(2) },
      }),
    } as never) as MediaItem;

    expect(viewersFor(show, 60, NOW)).toEqual([
      { user: 'dan', episodesWatched: 4, lastWatched: daysAgo(2), status: 'in_progress' },
      { user: 'harry', episodesWatched: 10, lastWatched: daysAgo(20), status: 'finished' },
    ]);
  });

  it('works a show out from watch history before the next sync', () => {
    const show = createMediaItem({ type: 'show', title: 'Severance', plex_id: 'show-1', episode_count: 10 } as never) as MediaItem;
    play('show-1', 'dan', 'Good News About Hell', true, daysAgo(5), 'Severance');
    play('show-1', 'dan', 'Half Loop', true, daysAgo(3), 'Severance');

    expect(viewersFor(show, 60, NOW)).toEqual([
      { user: 'dan', episodesWatched: 2, lastWatched: daysAgo(3), status: 'in_progress' },
    ]);
  });

  it('says who finished a movie and who only started it', () => {
    const movie = createMediaItem({ type: 'movie', title: 'Heat', plex_id: 'movie-1' } as never) as MediaItem;
    play('movie-1', 'harry', 'Heat', true, daysAgo(10), null);
    play('movie-1', 'dan', 'Heat', false, daysAgo(1), null);

    expect(viewersFor(movie, 60, NOW)).toEqual([
      { user: 'dan', episodesWatched: null, lastWatched: daysAgo(1), status: 'started' },
      { user: 'harry', episodesWatched: null, lastWatched: daysAgo(10), status: 'watched' },
    ]);
  });

  it('falls back to the names recorded at sync', () => {
    const movie = createMediaItem({
      type: 'movie', title: 'Heat', plex_id: 'movie-2', watched_by: ['harry'],
    } as never) as MediaItem;
    expect(viewersFor(movie, 60, NOW)).toEqual([
      { user: 'harry', episodesWatched: null, lastWatched: null, status: null },
    ]);
  });
});
