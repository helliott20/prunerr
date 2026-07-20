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

function seedMovie(title: string, status: string, addedDaysAgo: number) {
  const item = createMediaItem({
    type: 'movie',
    title,
    plex_id: `rk-${title}`,
    library_key: '1',
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
});
