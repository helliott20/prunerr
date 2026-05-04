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

  it('records deletion history before deleting the media_items row on FULL_REMOVAL', async () => {
    // Regression: prior to this fix, fullRemoval() called mediaItemRepository.delete()
    // which removed the media_items row. The subsequent deletion_history insert then
    // failed with FOREIGN KEY constraint failed because media_item_id no longer existed.
    const events: string[] = [];
    const historyCreate = vi.fn(async () => {
      events.push('history');
      return {} as never;
    });
    const itemDelete = vi.fn(async () => {
      events.push('delete-row');
    });

    const svc = buildService({
      mediaItemRepository: {
        getById: async () => sampleItem,
        update: vi.fn(async () => undefined),
        delete: itemDelete,
        getByStatus: async () => [],
      },
      deletionHistoryRepository: { create: historyCreate },
    });

    const result = await svc.executeDelete(sampleItem, DeletionAction.FULL_REMOVAL, { ruleId: 7 });

    expect(result.success).toBe(true);
    expect(events).toEqual(['history', 'delete-row']);
    expect(historyCreate).toHaveBeenCalledTimes(1);
    expect(itemDelete).toHaveBeenCalledWith((sampleItem as { id: number }).id);
  });
});
