import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import fs from 'fs';
import express from 'express';
import type { Server } from 'http';

// Real on-disk SQLite (better-sqlite3 needs a file for WAL). Point config at a
// temp DB before the db module reads it, and silence the logger. Same hoisting
// trick as deleteStale.test.ts.
const { tmpDbPath } = vi.hoisted(() => {
  const osMod = require('os');
  const pathMod = require('path');
  return {
    tmpDbPath: pathMod.join(osMod.tmpdir(), `prunerr-preview-test-${process.pid}-${Date.now()}.db`),
  };
});

vi.mock('../../config', () => ({
  default: { dbPath: tmpDbPath, nodeEnv: 'test' },
}));

vi.mock('../../utils/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// The scheduler module spins up timers on import; the preview route never calls
// into it, so stub the surface rules.ts imports.
vi.mock('../../scheduler/tasks', () => ({
  queueItemForDeletion: vi.fn(),
  notifyItemsQueued: vi.fn(),
}));

import { initializeDatabase, getDatabase, closeDatabase } from '../../db/index';
import { createMediaItem } from '../../db/repositories/mediaItems';
import rulesRouter from '../rules';

let server: Server;
let baseUrl: string;

/** The rule from the bug report: never-watched movies added over 180 days ago. */
const NEVER_WATCHED_180D = {
  mediaType: 'movie',
  logic: 'AND' as const,
  conditions: [
    { field: 'play_count', operator: 'equals', value: 0 },
    { field: 'days_since_added', operator: 'greater_than', value: 180 },
  ],
};

function daysAgo(n: number): string {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString();
}

function seedMovie(title: string, status: string, addedDaysAgo: number, libraryKey: string | null = '1') {
  const item = createMediaItem({
    type: 'movie',
    title,
    plex_id: `rk-${title}`,
    ...(libraryKey !== null ? { library_key: libraryKey } : {}),
    play_count: 0,
    added_at: daysAgo(addedDaysAgo),
  } as never);
  getDatabase().prepare('UPDATE media_items SET status = ? WHERE id = ?').run(status, item.id);
  return item;
}

interface PreviewData {
  totalMatches: number;
  wouldQueue: number;
  wouldSkipProtected: number;
  alreadyPending: number;
  samples: Array<{ id: number; title: string; size: number; isProtected: boolean }>;
  sampleTotal: number;
  totalSize: number;
  wouldSkipInProgress: number;
}

async function preview(body: unknown): Promise<PreviewData> {
  const res = await fetch(`${baseUrl}/preview`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as { success: boolean; data: PreviewData };
  expect(json.success).toBe(true);
  return json.data;
}

describe('POST /api/rules/preview', () => {
  beforeAll(async () => {
    initializeDatabase();
    const app = express();
    app.use(express.json());
    app.use(rulesRouter);
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
    getDatabase().prepare('DELETE FROM media_items').run();
  });

  it('does not count soft-deleted tombstones the rule already acted on', async () => {
    // Mirrors the reported prod state: the rule has already deleted most of the
    // library, so only the tombstones still satisfy its conditions.
    seedMovie('already-gone-1', 'deleted', 400);
    seedMovie('already-gone-2', 'deleted', 400);
    seedMovie('still-here', 'monitored', 400);

    const data = await preview(NEVER_WATCHED_180D);

    // Only the live monitored movie is new work.
    expect(data.totalMatches).toBe(1);
  });

  it('reports already-queued items separately rather than as new matches', async () => {
    seedMovie('queued-1', 'pending_deletion', 400);
    seedMovie('fresh-1', 'monitored', 400);
    seedMovie('fresh-2', 'monitored', 400);

    const data = await preview(NEVER_WATCHED_180D);

    expect(data.totalMatches).toBe(2);
    expect(data.alreadyPending).toBe(1);
  });

  it('still counts monitored items that match', async () => {
    seedMovie('a', 'monitored', 400);
    seedMovie('b', 'monitored', 400);

    const data = await preview(NEVER_WATCHED_180D);

    expect(data.totalMatches).toBe(2);
    expect(data.alreadyPending).toBe(0);
  });

  it('excludes items inside the added-date window', async () => {
    seedMovie('recent', 'monitored', 10);
    seedMovie('old', 'monitored', 400);

    const data = await preview(NEVER_WATCHED_180D);

    expect(data.totalMatches).toBe(1);
  });

  it('restricts matches to the targeted libraries when libraryKeys is set', async () => {
    seedMovie('anime-1', 'monitored', 400, '2');
    seedMovie('anime-2', 'monitored', 400, '2');
    seedMovie('regular-1', 'monitored', 400, '1');
    seedMovie('no-library', 'monitored', 400, null);

    const data = await preview({ ...NEVER_WATCHED_180D, libraryKeys: ['2'] });

    // Only the two items in library 2 count; the legacy item without a
    // library_key is excluded from a library-restricted preview.
    expect(data.totalMatches).toBe(2);
  });

  it('matches all libraries when libraryKeys is empty or omitted', async () => {
    seedMovie('lib1', 'monitored', 400, '1');
    seedMovie('lib2', 'monitored', 400, '2');
    seedMovie('unkeyed', 'monitored', 400, null);

    const omitted = await preview(NEVER_WATCHED_180D);
    expect(omitted.totalMatches).toBe(3);

    const empty = await preview({ ...NEVER_WATCHED_180D, libraryKeys: [] });
    expect(empty.totalMatches).toBe(3);
  });

  it('pages through samples largest first and can leave protected items out', async () => {
    const db = getDatabase();
    const setSizeAndProtection = db.prepare('UPDATE media_items SET file_size = ?, is_protected = ? WHERE id = ?');
    for (let i = 0; i < 12; i++) {
      const item = seedMovie(`protected-${i}`, 'monitored', 400);
      setSizeAndProtection.run(1_000_000 + i, 1, item.id);
    }
    for (let i = 0; i < 15; i++) {
      const item = seedMovie(`free-${i}`, 'monitored', 400);
      setSizeAndProtection.run(1_000 + i, 0, item.id);
    }

    // Default: every match, protected ones flagged, first page of ten.
    const all = await preview(NEVER_WATCHED_180D);
    expect(all.sampleTotal).toBe(27);
    expect(all.samples).toHaveLength(10);
    expect(all.samples.every((s) => s.isProtected)).toBe(true);
    const sizes = all.samples.map((s) => s.size);
    expect(sizes).toEqual([...sizes].sort((a, b) => b - a));

    // Protected left out, second page holds the remaining five.
    const unprotected = await preview({
      ...NEVER_WATCHED_180D,
      includeProtectedSamples: false,
      sampleOffset: 10,
      sampleLimit: 10,
    });
    expect(unprotected.sampleTotal).toBe(15);
    expect(unprotected.samples).toHaveLength(5);
    expect(unprotected.samples.every((s) => !s.isProtected && s.title.startsWith('free-'))).toBe(true);

    // Headline counts are unaffected by the sample filter.
    expect(unprotected.totalMatches).toBe(27);
    expect(unprotected.wouldSkipProtected).toBe(12);
  });

  it('counts only unprotected matches as reclaimable', async () => {
    const db = getDatabase();
    const setSizeAndProtection = db.prepare('UPDATE media_items SET file_size = ?, is_protected = ? WHERE id = ?');
    setSizeAndProtection.run(5_000, 1, seedMovie('kept', 'monitored', 400).id);
    setSizeAndProtection.run(300, 0, seedMovie('gone-1', 'monitored', 400).id);
    setSizeAndProtection.run(200, 0, seedMovie('gone-2', 'monitored', 400).id);

    const data = await preview(NEVER_WATCHED_180D);

    expect(data.totalMatches).toBe(3);
    expect(data.totalSize).toBe(500);
  });

  it('skips shows someone is part-way through', async () => {
    const db = getDatabase();
    const setShow = db.prepare(
      `UPDATE media_items SET type = 'show', file_size = ?, episode_count = ?,
         watched_episode_count = ?, last_watched_at = ? WHERE id = ?`
    );
    // Watching now: 3 of 10 episodes, last one yesterday.
    setShow.run(1_000, 10, 3, daysAgo(1), seedMovie('watching', 'monitored', 400).id);
    // Finished, and one abandoned long ago: both fair game.
    setShow.run(200, 10, 10, daysAgo(1), seedMovie('finished', 'monitored', 400).id);
    setShow.run(100, 10, 3, daysAgo(300), seedMovie('abandoned', 'monitored', 400).id);

    const OLD_ITEMS = {
      mediaType: 'all',
      logic: 'AND' as const,
      conditions: [{ field: 'days_since_added', operator: 'greater_than', value: 180 }],
    };

    const data = await preview({ ...OLD_ITEMS, includeProtectedSamples: false });

    expect(data.totalMatches).toBe(3);
    expect(data.wouldSkipInProgress).toBe(1);
    expect(data.wouldQueue).toBe(2);
    expect(data.totalSize).toBe(300);
    expect(data.samples.map((s) => s.title).sort()).toEqual(['abandoned', 'finished']);

    // Turning the safety setting off lets the rule reach it.
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('inProgress_protect', 'false')").run();
    try {
      const unprotected = await preview(OLD_ITEMS);
      expect(unprotected.wouldSkipInProgress).toBe(0);
      expect(unprotected.wouldQueue).toBe(3);
    } finally {
      db.prepare("DELETE FROM settings WHERE key = 'inProgress_protect'").run();
    }
  });

  describe('GET /api/rules/suggestions', () => {
    beforeEach(() => {
      getDatabase().prepare('DELETE FROM media_items').run();
    });

    it('leaves protected items out of the counts and sizes', async () => {
      const setSizeAndProtection = getDatabase().prepare(
        'UPDATE media_items SET file_size = ?, is_protected = ? WHERE id = ?'
      );
      setSizeAndProtection.run(5_000, 1, seedMovie('kept', 'monitored', 400).id);
      setSizeAndProtection.run(300, 0, seedMovie('gone-1', 'monitored', 400).id);
      setSizeAndProtection.run(200, 0, seedMovie('gone-2', 'monitored', 400).id);

      const res = await fetch(`${baseUrl}/suggestions`);
      const json = (await res.json()) as {
        success: boolean;
        data: { suggestions: Array<{ id: string; matchCount: number; totalSize: number }> };
      };
      expect(json.success).toBe(true);

      const neverWatched = json.data.suggestions.find((s) => s.id === 'never-watched');
      expect(neverWatched).toMatchObject({ matchCount: 2, totalSize: 500 });
    });
  });
});
