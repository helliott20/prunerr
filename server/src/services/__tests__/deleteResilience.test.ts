import { describe, it, expect, vi, beforeEach } from 'vitest';

// Verifies executeDelete is resilient to failures in post-deletion bookkeeping
// (history write, rule lookup, status update). The Sonarr/Radarr delete has
// already succeeded at that point — the file is gone — so a downstream error
// must not cascade into "success: false" or skip the activity log.

const logActivitySpy = vi.fn();

vi.mock('../../db/repositories/activity', () => ({
  logActivity: (...args: unknown[]) => logActivitySpy(...args),
}));

vi.mock('../../utils/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { DeletionService } from '../deletion';
import { DeletionAction } from '../../rules/types';

const sampleItem = {
  id: 99,
  title: 'Test Movie',
  type: 'movie',
  file_size: 1_000_000_000,
  radarr_id: 42,
  sonarr_id: null,
  tmdb_id: null,
} as never;

function buildService(deps: Partial<ConstructorParameters<typeof DeletionService>[0]> = {}): DeletionService {
  const base = {
    mediaItemRepository: {
      getById: async () => sampleItem,
      update: vi.fn(async () => undefined),
      delete: vi.fn(async () => undefined),
      getByStatus: async () => [],
    },
    radarrService: {
      unmonitorMovie: vi.fn(async () => undefined),
      deleteMovieFile: vi.fn(async () => undefined),
      deleteMovieFilesByMovieId: vi.fn(async () => true),
      removeMovie: vi.fn(async () => undefined),
    },
    deletionHistoryRepository: {
      create: vi.fn(async () => ({}) as never),
    },
    ruleRepository: {
      getById: vi.fn(async (id: number) => ({ id, name: 'Stale movies' })),
    },
  };
  return new DeletionService({ ...base, ...deps } as never);
}

describe('executeDelete post-step resilience', () => {
  beforeEach(() => {
    logActivitySpy.mockClear();
  });

  it('logs activity even when deletion history write throws', async () => {
    const svc = buildService({
      deletionHistoryRepository: {
        create: vi.fn(async () => {
          throw new Error('history table locked');
        }),
      },
    });

    const result = await svc.executeDelete(sampleItem, DeletionAction.UNMONITOR_AND_DELETE, { ruleId: 7 });

    expect(result.success).toBe(true);
    expect(logActivitySpy).toHaveBeenCalledTimes(1);
    const entry = logActivitySpy.mock.calls[0]![0];
    expect(entry).toMatchObject({
      eventType: 'deletion',
      action: 'deleted',
      actorType: 'rule',
      actorId: '7',
    });
  });

  it('logs activity even when rule name lookup throws', async () => {
    const svc = buildService({
      ruleRepository: {
        getById: vi.fn(async () => {
          throw new Error('rules table missing');
        }),
      },
    });

    const result = await svc.executeDelete(sampleItem, DeletionAction.UNMONITOR_AND_DELETE, { ruleId: 7 });

    expect(result.success).toBe(true);
    expect(logActivitySpy).toHaveBeenCalledTimes(1);
    const entry = logActivitySpy.mock.calls[0]![0];
    // Rule lookup failed but actor type still attributed to rule, with a
    // sensible fallback name so the Activity Log "Rule" filter catches it.
    expect(entry.actorType).toBe('rule');
    expect(entry.actorName).toBe('Rule #7');
  });

  it('returns success when item status update throws (file is already gone)', async () => {
    const svc = buildService({
      mediaItemRepository: {
        getById: async () => sampleItem,
        update: vi.fn(async () => {
          throw new Error('db locked');
        }),
        delete: vi.fn(async () => undefined),
        getByStatus: async () => [],
      },
    });

    const result = await svc.executeDelete(sampleItem, DeletionAction.UNMONITOR_AND_DELETE, { ruleId: 7 });

    expect(result.success).toBe(true);
    expect(logActivitySpy).toHaveBeenCalledTimes(1);
  });

  it('keeps a "deleted" tombstone row on FULL_REMOVAL instead of removing it', async () => {
    // Regression (issue #28): FULL_REMOVAL used to hard-delete the media_items
    // row. Plex keeps a movie's metadata entry for a while after its file is
    // gone, so the next library sync re-imported it as a fresh `monitored`
    // item and rules immediately re-queued it — an endless delete/re-queue
    // loop. The row is now kept as a `deleted` tombstone so the sync can
    // recognise it and leave it alone.
    const itemUpdate = vi.fn(async () => undefined);
    const itemDelete = vi.fn(async () => undefined);
    const historyCreate = vi.fn(async () => ({}) as never);

    const svc = buildService({
      mediaItemRepository: {
        getById: async () => sampleItem,
        update: itemUpdate,
        delete: itemDelete,
        getByStatus: async () => [],
      },
      deletionHistoryRepository: { create: historyCreate },
    });

    const result = await svc.executeDelete(sampleItem, DeletionAction.FULL_REMOVAL, { ruleId: 7 });

    expect(result.success).toBe(true);
    expect(historyCreate).toHaveBeenCalledTimes(1);
    // The row must NOT be hard-deleted...
    expect(itemDelete).not.toHaveBeenCalled();
    // ...it's tombstoned with status 'deleted' and a deleted_at timestamp.
    expect(itemUpdate).toHaveBeenCalledWith(
      (sampleItem as { id: number }).id,
      expect.objectContaining({ status: 'deleted', deleted_at: expect.any(String) })
    );
  });
});
