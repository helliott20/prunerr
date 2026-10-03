import { describe, it, expect, vi, beforeEach } from 'vitest';

// A show queued for deletion that someone starts watching during its grace
// period must be taken back out of the queue, not deleted.

const logActivitySpy = vi.fn();
const settings = new Map<string, string>();

vi.mock('../../db/repositories/activity', () => ({
  logActivity: (...args: unknown[]) => logActivitySpy(...args),
}));

vi.mock('../../db/repositories/settings', () => ({
  default: {
    getBoolean: (key: string, fallback: boolean) =>
      settings.has(key) ? settings.get(key) === 'true' : fallback,
    getNumber: (key: string, fallback: number) => (settings.has(key) ? Number(settings.get(key)) : fallback),
  },
}));

vi.mock('../../utils/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { DeletionService } from '../deletion';

const yesterday = new Date(Date.now() - 86_400_000).toISOString();

const watchingShow = {
  id: 7,
  title: 'Severance',
  type: 'show',
  status: 'pending_deletion',
  delete_after: yesterday,
  marked_at: yesterday,
  episode_count: 19,
  watched_episode_count: 4,
  last_watched_at: yesterday,
  sonarr_id: 12,
  file_size: 5_000,
};

function buildService() {
  const repo = {
    getById: vi.fn(async () => watchingShow),
    update: vi.fn(async () => undefined),
    delete: vi.fn(async () => undefined),
    getByStatus: vi.fn(async () => [watchingShow]),
  };
  const sonarr = {
    unmonitorSeries: vi.fn(async () => undefined),
    deleteSeriesFiles: vi.fn(async () => undefined),
    deleteEpisodeFilesBySeriesId: vi.fn(async () => true),
    removeSeries: vi.fn(async () => undefined),
  };
  const service = new DeletionService({
    mediaItemRepository: repo,
    sonarrService: sonarr,
    deletionHistoryRepository: { create: vi.fn(async () => ({})) },
    ruleRepository: { getById: vi.fn(async () => null) },
  } as never);
  return { service, repo, sonarr };
}

describe('processPendingDeletions and in-progress shows', () => {
  beforeEach(() => {
    logActivitySpy.mockClear();
    settings.clear();
  });

  it('takes an in-progress show out of the queue instead of deleting it', async () => {
    const { service, repo } = buildService();
    const executeDelete = vi.spyOn(service, 'executeDelete');

    const results = await service.processPendingDeletions(false);

    expect(results).toEqual([]);
    expect(executeDelete).not.toHaveBeenCalled();
    expect(repo.update).toHaveBeenCalledWith(7, { status: 'monitored', marked_at: null, delete_after: null });
    expect(logActivitySpy).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'protection', action: 'in_progress_kept', targetId: 7 })
    );
  });

  it('leaves the queue alone on a dry run', async () => {
    const { service, repo } = buildService();
    await service.processPendingDeletions(true);
    expect(repo.update).not.toHaveBeenCalled();
    expect(logActivitySpy).not.toHaveBeenCalled();
  });

  it('deletes as normal when the safety setting is off', async () => {
    settings.set('inProgress_protect', 'false');
    const { service } = buildService();
    const executeDelete = vi
      .spyOn(service, 'executeDelete')
      .mockResolvedValue({ success: true, itemId: 7, title: 'Severance', action: 'delete' as never });

    const results = await service.processPendingDeletions(false);

    expect(executeDelete).toHaveBeenCalledTimes(1);
    expect(results).toHaveLength(1);
  });
});
