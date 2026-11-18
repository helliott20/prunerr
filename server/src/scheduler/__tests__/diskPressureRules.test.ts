import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import fs from 'fs';

const { tmpDbPath, usages, markSpy } = vi.hoisted(() => {
  const osMod = require('os');
  const pathMod = require('path');
  return {
    tmpDbPath: pathMod.join(osMod.tmpdir(), `prunerr-dp-rules-test-${process.pid}-${Date.now()}.db`),
    usages: { current: [] as unknown[] },
    markSpy: vi.fn(),
  };
});

vi.mock('../../config', () => ({
  default: { dbPath: tmpDbPath, nodeEnv: 'test' },
}));

vi.mock('../../utils/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../notifications', () => ({
  getNotificationService: () => ({ notify: vi.fn().mockResolvedValue(undefined) }),
}));

vi.mock('../../services/deletion', () => ({
  getDeletionService: () => ({
    markForDeletion: markSpy,
    processPendingDeletions: vi.fn().mockResolvedValue([]),
  }),
}));

vi.mock('../../services/storage', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../services/storage')>()),
  getPressureUsages: async () => ({ usages: usages.current, source: 'arr' }),
}));

import { initializeDatabase, getDatabase, closeDatabase } from '../../db/index';
import { createMediaItem, getMediaItemById } from '../../db/repositories/mediaItems';
import rulesRepo from '../../db/repositories/rules';
import settingsRepo from '../../db/repositories/settings';
import { monitorDiskPressure, scanLibraries } from '../tasks';
import type { MediaItem } from '../../types';

const GiB = 1024 ** 3;
const TB = 1000 * GiB;

/** One 10 TB drive with `freeGb` free. The default soft target is 10%, critical 5%. */
function drive(freeGb: number, extra: Record<string, unknown> = {}) {
  return {
    path: '/data',
    key: 'arr:/data',
    totalBytes: 10 * TB,
    freeBytes: freeGb * GiB,
    usedBytes: 10 * TB - freeGb * GiB,
    source: 'arr',
    ...extra,
  };
}

function seedItem(fields: Partial<MediaItem> & { title: string }): MediaItem {
  return createMediaItem({
    type: 'movie',
    plex_id: `rk-${fields.title}`,
    library_key: '1',
    file_size: 40 * GiB,
    play_count: 0,
    ...fields,
  } as never) as MediaItem;
}

function pressureRule(
  conditions: unknown[],
  extra: { library_keys?: string[]; gracePeriodDays?: number; deletionAction?: string; priority?: number; name?: string } = {}
) {
  return rulesRepo.rules.create({
    name: extra.name ?? 'Low space: Movies',
    type: 'custom',
    action: 'delete',
    library_keys: extra.library_keys ?? null,
    gracePeriodDays: extra.gracePeriodDays ?? 3,
    deletionAction: extra.deletionAction ?? 'delete_files_only',
    priority: extra.priority ?? 0,
    conditions: {
      version: 2,
      root: {
        kind: 'group',
        logic: 'AND',
        children: [{ kind: 'condition', field: 'disk_pressure', operator: 'equals', value: 'low' }, ...conditions],
      },
    } as never,
  });
}

const PLAY_COUNT_ZERO = { kind: 'condition', field: 'play_count', operator: 'equals', value: 0 };

function queuedIds(): number[] {
  return markSpy.mock.calls.map(([id]) => id as number);
}

describe('disk pressure rules', () => {
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
    const db = getDatabase();
    db.prepare('DELETE FROM media_items').run();
    db.prepare('DELETE FROM rules').run();
    db.prepare('DELETE FROM scan_history').run();
    markSpy.mockReset();
    markSpy.mockResolvedValue(undefined);
    settingsRepo.set({ key: 'diskPressure_enabled', value: 'true' });
    settingsRepo.set({ key: 'diskPressure_observeOnly', value: 'false' });
    settingsRepo.set({ key: 'diskPressure_bufferGb', value: '0' });
    usages.current = [drive(900)]; // 9% free: soft pressure, 100 GB short
  });

  it('picks only from what the rule matches, in its libraries', async () => {
    pressureRule([PLAY_COUNT_ZERO], { library_keys: ['1'] });
    const unwatchedMovie = seedItem({ title: 'Unwatched movie' });
    seedItem({ title: 'Watched movie', play_count: 3, last_watched_at: '2020-01-01T00:00:00.000Z' });
    seedItem({ title: 'Other library', library_key: '2' });

    await monitorDiskPressure();

    expect(queuedIds()).toEqual([unwatchedMovie.id]);
  });

  it("uses the rule's deletion action and grace period, and records the rule", async () => {
    const rule = pressureRule([PLAY_COUNT_ZERO], { gracePeriodDays: 3, deletionAction: 'delete_files_only' });
    seedItem({ title: 'Unwatched movie' });

    await monitorDiskPressure();

    expect(markSpy).toHaveBeenCalledWith(expect.any(Number), {
      gracePeriodDays: 3,
      deletionAction: 'delete_files_only',
      skipNotification: true,
      ruleId: rule.id,
      resetOverseerr: false,
    });
  });

  it('only takes enough to get back under target', async () => {
    pressureRule([PLAY_COUNT_ZERO]);
    for (let i = 0; i < 6; i++) seedItem({ title: `Movie ${i}` });

    await monitorDiskPressure();

    // 100 GB short and 40 GB each: three items cover it, the other three stay.
    expect(markSpy).toHaveBeenCalledTimes(3);
  });

  it('ignores the built-in unwatched pick once a rule uses disk pressure', async () => {
    settingsRepo.set({ key: 'diskPressure_unwatchedDays', value: '1' });
    pressureRule([{ kind: 'condition', field: 'title', operator: 'equals', value: 'Nothing matches this' }]);
    seedItem({ title: 'Never watched' });

    await monitorDiskPressure();

    expect(markSpy).not.toHaveBeenCalled();
  });

  it('falls back to the built-in pick when no rule uses disk pressure', async () => {
    settingsRepo.set({ key: 'diskPressure_unwatchedDays', value: '1' });
    const item = seedItem({ title: 'Never watched' });

    await monitorDiskPressure();

    expect(queuedIds()).toEqual([item.id]);
    expect(markSpy.mock.calls[0]![1]).not.toHaveProperty('ruleId');
  });

  it('a critical-only rule waits for critical pressure', async () => {
    rulesRepo.rules.create({
      name: 'Critical only',
      type: 'custom',
      action: 'delete',
      conditions: {
        version: 2,
        root: { kind: 'condition', field: 'disk_pressure', operator: 'equals', value: 'critical' },
      } as never,
    });
    seedItem({ title: 'Unwatched movie' });

    await monitorDiskPressure();
    expect(markSpy).not.toHaveBeenCalled();

    usages.current = [drive(300)]; // 3% free: critical
    await monitorDiskPressure();
    expect(markSpy).toHaveBeenCalledTimes(1);
    // Critical pressure uses the critical grace period (0 by default).
    expect(markSpy.mock.calls[0]![1]).toMatchObject({ gracePeriodDays: 0 });
  });

  it('with several drives, only matches items on the one that is low', async () => {
    usages.current = [
      drive(900, { path: '/movies', key: 'arr:/movies', pathPrefixes: ['/movies'], apps: ['radarr'] }),
      drive(5000, { path: '/tv', key: 'arr:/tv', pathPrefixes: ['/tv'], apps: ['sonarr'] }),
    ];
    pressureRule([]);
    const movie = seedItem({ title: 'Movie', file_path: '/movies/Movie (2020)/movie.mkv' });
    seedItem({ title: 'Show', type: 'show', file_path: '/tv/Show' });

    await monitorDiskPressure();

    expect(queuedIds()).toEqual([movie.id]);
  });

  it('observe-only queues nothing', async () => {
    settingsRepo.set({ key: 'diskPressure_observeOnly', value: 'true' });
    pressureRule([PLAY_COUNT_ZERO]);
    seedItem({ title: 'Unwatched movie' });

    const result = await monitorDiskPressure();

    expect(markSpy).not.toHaveBeenCalled();
    expect(result.message).toMatch(/Observe-only: 1 item/);
  });

  it("counts what's already queued, so the next check doesn't queue another batch", async () => {
    pressureRule([PLAY_COUNT_ZERO]);
    for (let i = 0; i < 6; i++) seedItem({ title: `Movie ${i}` });
    // Three 40 GB items already waiting out their grace period cover the 100 GB.
    getDatabase()
      .prepare(
        `UPDATE media_items SET status = 'pending_deletion', deletion_action = 'delete_files_only',
         marked_at = ?, delete_after = ? WHERE title IN ('Movie 0', 'Movie 1', 'Movie 2')`
      )
      .run(new Date().toISOString(), new Date(Date.now() + 5 * 86_400_000).toISOString());

    const result = await monitorDiskPressure();

    expect(markSpy).not.toHaveBeenCalled();
    expect(result.message).toMatch(/already queued/);
  });

  it('under critical pressure, only counts what goes within the critical grace period', async () => {
    pressureRule([PLAY_COUNT_ZERO]);
    for (let i = 0; i < 9; i++) seedItem({ title: `Movie ${i}` });
    getDatabase()
      .prepare(
        `UPDATE media_items SET status = 'pending_deletion', deletion_action = 'delete_files_only',
         marked_at = ?, delete_after = ? WHERE title IN ('Movie 0', 'Movie 1', 'Movie 2')`
      )
      .run(new Date().toISOString(), new Date(Date.now() + 5 * 86_400_000).toISOString());
    usages.current = [drive(300)]; // 3% free: critical, 700 GB short of the soft target

    await monitorDiskPressure();

    // The three waiting five days don't help now, so new items are queued.
    expect(markSpy.mock.calls.length).toBeGreaterThan(0);
  });

  it('the nightly scan leaves disk pressure rules alone', async () => {
    pressureRule([PLAY_COUNT_ZERO]);
    const item = seedItem({ title: 'Unwatched movie' });

    await scanLibraries();

    expect(getMediaItemById(item.id)?.status).toBe('monitored');
  });
});
