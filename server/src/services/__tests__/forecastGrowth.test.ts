import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import fs from 'fs';

const { tmpDbPath } = vi.hoisted(() => {
  const osMod = require('os');
  const pathMod = require('path');
  return {
    tmpDbPath: pathMod.join(osMod.tmpdir(), `prunerr-growth-test-${process.pid}-${Date.now()}.db`),
  };
});

vi.mock('../../config', () => ({
  default: { dbPath: tmpDbPath, nodeEnv: 'test' },
}));

vi.mock('../../utils/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { initializeDatabase, getDatabase, closeDatabase } from '../../db/index';
import { measureGrowth } from '../forecast';

const GB = 1024 ** 3;

function snapshot(daysAgo: number, usedGb: number, source = 'arr') {
  getDatabase()
    .prepare(
      `INSERT INTO unraid_capacity_snapshots (total_bytes, used_bytes, free_bytes, source, captured_at)
       VALUES (?, ?, ?, ?, datetime('now', ?))`
    )
    .run(1000 * GB, usedGb * GB, (1000 - usedGb) * GB, source, `-${daysAgo} days`);
}

function deleted(daysAgo: number, sizeGb: number) {
  getDatabase()
    .prepare(
      `INSERT INTO deletion_history (title, type, file_size, deleted_at, deletion_type)
       VALUES ('x', 'movie', ?, datetime('now', ?), 'automatic')`
    )
    .run(sizeGb * GB, `-${daysAgo} days`);
}

describe('measureGrowth', () => {
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
    getDatabase().prepare('DELETE FROM unraid_capacity_snapshots').run();
    getDatabase().prepare('DELETE FROM deletion_history').run();
  });

  it('measures used space added per day between the oldest and newest snapshot', () => {
    snapshot(100, 500);
    snapshot(50, 520);
    snapshot(0, 600);
    expect(measureGrowth('arr')).toEqual({ bytesPerDay: GB, measuredDays: 100 });
  });

  it('adds back what was deleted in the window, so deletions aren’t counted twice', () => {
    snapshot(100, 500);
    snapshot(0, 550);
    deleted(40, 50);
    deleted(200, 999); // before the window
    expect(measureGrowth('arr')?.bytesPerDay).toBeCloseTo(GB);
  });

  it('needs two weeks of history, from the same source', () => {
    snapshot(10, 500);
    snapshot(0, 600);
    expect(measureGrowth('arr')).toBeNull();
    snapshot(60, 400, 'unraid');
    expect(measureGrowth('unraid')).toBeNull();
  });
});
