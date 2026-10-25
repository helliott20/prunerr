import { describe, it, expect, vi, beforeEach } from 'vitest';

// Regression (issue #86): items with no Sonarr/Radarr link (e.g. Plex/Emby DVR
// recordings) used to fall through every delete action as a no-op and still be
// marked `deleted`, so the files stayed on disk while Prunerr said they were gone.

const logActivitySpy = vi.fn();

vi.mock('../../db/repositories/activity', () => ({
  logActivity: (...args: unknown[]) => logActivitySpy(...args),
}));

vi.mock('../../utils/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { DeletionService, getUnactionableReason } from '../deletion';
import { DeletionAction } from '../../rules/types';

const dvrItem = {
  id: 7,
  title: 'Wheel of Fortune',
  type: 'show',
  file_size: 11_000_000_000,
  sonarr_id: null,
  radarr_id: null,
  file_path: null,
  tmdb_id: null,
} as never;

function buildService() {
  const update = vi.fn(async () => undefined);
  const historyCreate = vi.fn(async () => ({}) as never);
  const svc = new DeletionService({
    mediaItemRepository: {
      getById: async () => dvrItem,
      update,
      delete: vi.fn(async () => undefined),
      getByStatus: async () => [],
    },
    sonarrService: {
      unmonitorSeries: vi.fn(async () => undefined),
      deleteEpisodeFile: vi.fn(async () => undefined),
      deleteAllEpisodeFiles: vi.fn(async () => ({ deleted: 0, failed: 0 })),
      removeSeries: vi.fn(async () => undefined),
    },
    deletionHistoryRepository: { create: historyCreate },
  } as never);
  return { svc, update, historyCreate };
}

describe('deleting items Prunerr cannot act on', () => {
  beforeEach(() => {
    logActivitySpy.mockClear();
  });

  it.each([
    DeletionAction.UNMONITOR_ONLY,
    DeletionAction.DELETE_FILES_ONLY,
    DeletionAction.UNMONITOR_AND_DELETE,
    DeletionAction.FULL_REMOVAL,
  ])('fails %s instead of marking the item deleted', async (action) => {
    const { svc, update, historyCreate } = buildService();

    const result = await svc.executeDelete(dvrItem, action);

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Not managed by Sonarr or Radarr/);
    expect(update).not.toHaveBeenCalled();
    expect(historyCreate).not.toHaveBeenCalled();
    expect(logActivitySpy).not.toHaveBeenCalled();
  });

  it('names the missing service when the item is linked but the service is not configured', () => {
    expect(getUnactionableReason({ sonarr_id: 3, radarr_id: null, file_path: null }, {})).toMatch(
      /Sonarr is not configured/
    );
    expect(getUnactionableReason({ sonarr_id: null, radarr_id: 5, file_path: null }, {})).toMatch(
      /Radarr is not configured/
    );
  });

  it('allows items a configured service can act on', () => {
    expect(getUnactionableReason({ sonarr_id: 3, radarr_id: null, file_path: null }, { sonarr: {} })).toBeNull();
    expect(getUnactionableReason({ sonarr_id: null, radarr_id: 5, file_path: null }, { radarr: {} })).toBeNull();
  });
});
