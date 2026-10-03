import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import fs from 'fs';

const { tmpDbPath } = vi.hoisted(() => {
  const osMod = require('os');
  const pathMod = require('path');
  return { tmpDbPath: pathMod.join(osMod.tmpdir(), `prunerr-storage-test-${process.pid}-${Date.now()}.db`) };
});

vi.mock('../../config', async (importOriginal) => {
  const actual = (await importOriginal()) as { default: Record<string, unknown> };
  return { default: { ...actual.default, dbPath: tmpDbPath, nodeEnv: 'test' } };
});
vi.mock('../../utils/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const TB = 1024 ** 4;
const sonarr = {
  getDiskSpace: vi.fn(async () => [
    { path: '/', label: '', totalSpace: 100 * 1024 ** 3, freeSpace: 40 * 1024 ** 3 },
    { path: '/tv', label: '', totalSpace: 20 * TB, freeSpace: 5 * TB },
  ]),
  getRootFolders: vi.fn(async () => [{ id: 1, path: '/tv', accessible: true, freeSpace: 5 * TB }]),
};
let sonarrConfigured = true;
vi.mock('../init', () => ({
  getSonarrService: () => (sonarrConfigured ? sonarr : null),
  getRadarrService: () => null,
}));

import { initializeDatabase, getDatabase, closeDatabase } from '../../db/index';
import settingsRepo from '../../db/repositories/settings';
import unraidSnapshotsRepo from '../../db/repositories/unraidSnapshots';
import { clearArrStorageCache } from '../arrStorage';
import { getPressureUsages, getStorageStats, resolveStorageSource } from '../storage';

describe('resolveStorageSource', () => {
  it('uses the saved choice when it is connected, else whichever is', () => {
    const both = { unraid: true, arr: true };
    expect(resolveStorageSource('auto', both)).toBe('unraid');
    expect(resolveStorageSource('arr', both)).toBe('arr');
    expect(resolveStorageSource('unraid', { unraid: false, arr: true })).toBe('arr');
    expect(resolveStorageSource('auto', { unraid: false, arr: false })).toBeNull();
  });
});

describe('getStorageStats with Sonarr/Radarr', () => {
  beforeAll(() => initializeDatabase());
  afterAll(() => {
    closeDatabase();
    for (const s of ['', '-wal', '-shm']) {
      try { fs.unlinkSync(tmpDbPath + s); } catch { /* ignore */ }
    }
  });
  beforeEach(() => {
    getDatabase().prepare('DELETE FROM unraid_capacity_snapshots').run();
    getDatabase().prepare("DELETE FROM settings WHERE key LIKE 'unraid_%' OR key = 'storage_source'").run();
    clearArrStorageCache();
    sonarrConfigured = true;
  });

  it('reports the media drives, not the container’s own disk', async () => {
    const stats = await getStorageStats();
    expect(stats).toMatchObject({
      configured: true,
      source: 'arr',
      preference: 'auto',
      available: { unraid: false, arr: true },
      totalCapacity: 20 * TB,
      freeCapacity: 5 * TB,
      usedCapacity: 15 * TB,
      usedPercent: 75,
    });
    expect(stats.disks).toEqual([
      expect.objectContaining({ device: '/tv', type: 'drive', rootFolders: ['/tv'], apps: ['sonarr'] }),
    ]);
  });

  it('records one snapshot a day, kept apart from Unraid’s', async () => {
    unraidSnapshotsRepo.capture({ total: 1, used: 1, free: 0 }, 'unraid');
    await getStorageStats();
    clearArrStorageCache();
    await getStorageStats();

    const rows = getDatabase()
      .prepare('SELECT source, COUNT(*) n FROM unraid_capacity_snapshots GROUP BY source ORDER BY source')
      .all();
    expect(rows).toEqual([
      { source: 'arr', n: 1 },
      { source: 'unraid', n: 1 },
    ]);
    expect(unraidSnapshotsRepo.getMonthlyTrend(12, 'arr').map((m) => m.usedBytes)).toEqual([15 * TB]);
  });

  it('falls back to Sonarr/Radarr when Unraid is chosen but not connected', async () => {
    settingsRepo.set({ key: 'storage_source', value: 'unraid' });
    const stats = await getStorageStats();
    expect(stats.preference).toBe('unraid');
    expect(stats.source).toBe('arr');
  });

  it('is unconfigured with no source connected', async () => {
    sonarrConfigured = false;
    const stats = await getStorageStats();
    expect(stats).toMatchObject({ configured: false, source: null, available: { unraid: false, arr: false } });
  });

  it('gives disk pressure each Sonarr/Radarr drive when no paths are typed in', async () => {
    const { usages, source } = await getPressureUsages([]);
    expect(source).toBe('arr');
    expect(usages).toEqual([
      expect.objectContaining({
        path: '/tv',
        totalBytes: 20 * TB,
        freeBytes: 5 * TB,
        pathPrefixes: ['/tv'],
        apps: ['sonarr'],
        source: 'arr',
      }),
    ]);
  });

  it('lets typed-in paths win over the storage source', async () => {
    const { source } = await getPressureUsages(['/definitely/not/a/real/path']);
    expect(source).toBe('paths');
  });
});
