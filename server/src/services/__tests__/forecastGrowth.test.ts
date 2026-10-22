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

function snapshot(daysAgo: number, usedGb: number, source = 'arr', totalGb = 1000) {
  getDatabase()
    .prepare(
      `INSERT INTO unraid_capacity_snapshots (total_bytes, used_bytes, free_bytes, source, captured_at)
       VALUES (?, ?, ?, ?, datetime('now', ?))`
    )
    .run(totalGb * GB, usedGb * GB, (totalGb - usedGb) * GB, source, `-${daysAgo} days`);
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
  });

  it('measures used space added per day between the oldest and newest snapshot', () => {
    snapshot(100, 500);
    snapshot(50, 520);
    snapshot(0, 600);
    expect(measureGrowth('arr')).toEqual({ bytesPerDay: GB, measuredDays: 100 });
  });

  it('counts only rises, so deletions never inflate or cancel the rate', () => {
    snapshot(100, 500);
    snapshot(60, 560); // +60 downloaded
    snapshot(50, 400); // Prunerr deleted 160
    snapshot(0, 440); // +40 downloaded
    expect(measureGrowth('arr')?.bytesPerDay).toBeCloseTo(GB);
  });

  it('skips steps where the disk changed size or used space leapt', () => {
    snapshot(100, 500);
    snapshot(80, 520); // +20
    snapshot(79, 0, 'arr', 0); // array not mounted
    snapshot(78, 520); // back: not a download
    snapshot(60, 1500, 'arr', 2000); // drive added
    snapshot(0, 1580, 'arr', 2000); // +80
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
