import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import fs from 'fs';

const { tmpDbPath } = vi.hoisted(() => {
  const osMod = require('os');
  const pathMod = require('path');
  return {
    tmpDbPath: pathMod.join(osMod.tmpdir(), `prunerr-ctx-test-${process.pid}-${Date.now()}.db`),
  };
});

vi.mock('../../config', () => ({
  default: { dbPath: tmpDbPath, nodeEnv: 'test' },
}));

vi.mock('../../utils/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { initializeDatabase, getDatabase, closeDatabase } from '../../db/index';
import { createMediaItem } from '../../db/repositories/mediaItems';
import { buildEvaluationContext } from '../context';
import { evaluateNode } from '../engine';
import type { ConditionNode } from '../types';
import type { MediaItem } from '../../types';

/** "Nobody has watched this" — the condition that silently matched everything. */
const NEVER_WATCHED_BY_ANYONE: ConditionNode = {
  kind: 'condition',
  field: 'watched_by',
  operator: 'is_empty',
  value: null,
} as ConditionNode;

function seedWatch(ratingKey: string, username: string) {
  getDatabase()
    .prepare(
      `INSERT INTO watch_history_cache (plex_rating_key, username, watched, stopped_at)
       VALUES (?, ?, 1, ?)`
    )
    .run(ratingKey, username, new Date().toISOString());
}

describe('buildEvaluationContext', () => {
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
    getDatabase().prepare('DELETE FROM watch_history_cache').run();
  });

  it('populates watchLookup from the watch history cache', () => {
    seedWatch('rk-1', 'harry');
    seedWatch('rk-1', 'guest');

    const ctx = buildEvaluationContext();

    expect(ctx.watchLookup?.get('rk-1')?.size).toBe(2);
  });

  it('does not report a watched item as unwatched', () => {
    const item = createMediaItem({
      type: 'movie', title: 'Seen It', plex_id: 'rk-seen', library_key: '1',
    } as never) as MediaItem;
    seedWatch('rk-seen', 'harry');

    const ctx = buildEvaluationContext();

    // Without a watchLookup this returned true, so a "delete if nobody watched
    // it" rule matched every item in the library.
    expect(evaluateNode(NEVER_WATCHED_BY_ANYONE, item, ctx)).toBe(false);
  });

  it('still reports a genuinely unwatched item as unwatched', () => {
    const item = createMediaItem({
      type: 'movie', title: 'Untouched', plex_id: 'rk-untouched', library_key: '1',
    } as never) as MediaItem;

    const ctx = buildEvaluationContext();

    expect(evaluateNode(NEVER_WATCHED_BY_ANYONE, item, ctx)).toBe(true);
  });
});
