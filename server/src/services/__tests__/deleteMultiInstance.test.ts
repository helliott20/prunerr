import { describe, it, expect, vi } from 'vitest';

// Several Sonarr/Radarr instances number their series/movies independently, so
// id 1 in the 4K Radarr is a different movie from id 1 in the standard one.
// Each item must only ever be acted on through the instance it belongs to.

vi.mock('../../db/repositories/activity', () => ({ logActivity: vi.fn() }));
vi.mock('../../rules/inProgress', () => ({
  loadInProgressConfig: () => ({ protect: false, recentDays: 14 }),
  isProtectedInProgress: () => false,
}));
vi.mock('../../utils/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { DeletionService } from '../deletion';
import { DeletionAction } from '../../rules/types';
import type { MediaItem } from '../../types';

function radarr() {
  return {
    unmonitorMovie: vi.fn(async () => undefined),
    deleteMovieFile: vi.fn(async () => undefined),
    deleteMovieFilesByMovieId: vi.fn(async () => true),
    removeMovie: vi.fn(async () => undefined),
    getMovieByTmdbId: vi.fn(async (): Promise<{ id: number } | null> => null),
    getMovieByImdbId: vi.fn(async (): Promise<{ id: number } | null> => null),
  };
}
function sonarr() {
  return {
    unmonitorSeries: vi.fn(async () => undefined),
    deleteEpisodeFile: vi.fn(async () => undefined),
    deleteAllEpisodeFiles: vi.fn(async () => ({ deleted: 1, failed: 0 })),
    removeSeries: vi.fn(async () => undefined),
    getSeriesByTvdbId: vi.fn(async (): Promise<{ id: number } | null> => null),
    getSeriesByImdbId: vi.fn(async (): Promise<{ id: number } | null> => null),
  };
}

function setup(opts: { known?: string[]; withRadarr4k?: boolean } = {}) {
  const radarrHd = radarr();
  const radarr4k = radarr();
  const sonarrHd = sonarr();
  const sonarrAnime = sonarr();
  const update = vi.fn(async () => undefined);
  const svc = new DeletionService({
    mediaItemRepository: {
      getById: async () => null,
      update,
      delete: vi.fn(async () => undefined),
      getByStatus: async () => [],
    },
    deletionHistoryRepository: { create: vi.fn(async () => ({}) as never) },
    arrInstances: () => ({
      sonarr: [
        { id: 'sonarr', service: sonarrHd },
        { id: 'sonarr-anime', service: sonarrAnime },
      ],
      radarr: [
        { id: 'radarr', service: radarrHd },
        ...(opts.withRadarr4k === false ? [] : [{ id: 'radarr-4k', service: radarr4k }]),
      ],
    }),
    ...(opts.known ? { knownArrInstanceIds: () => opts.known! } : {}),
  } as never);
  return { svc, radarrHd, radarr4k, sonarrHd, sonarrAnime, update };
}

const item = (over: Partial<MediaItem>) =>
  ({
    id: 10,
    title: 'Item',
    type: 'movie',
    sonarr_id: null,
    radarr_id: null,
    tmdb_id: 27205,
    imdb_id: null,
    tvdb_id: null,
    file_size: 1000,
    file_path: null,
    ...over,
  }) as MediaItem;

describe('deleting with several Sonarr/Radarr instances', () => {
  it('deletes a 4K movie through the 4K Radarr only', async () => {
    const { svc, radarrHd, radarr4k } = setup();
    const result = await svc.executeDelete(item({ radarr_id: 1, arr_instance: 'radarr-4k' }), DeletionAction.UNMONITOR_AND_DELETE);
    expect(result.success).toBe(true);
    expect(radarr4k.unmonitorMovie).toHaveBeenCalledWith(1);
    expect(radarr4k.deleteMovieFilesByMovieId).toHaveBeenCalledWith(1);
    expect(radarrHd.unmonitorMovie).not.toHaveBeenCalled();
    expect(radarrHd.deleteMovieFilesByMovieId).not.toHaveBeenCalled();
  });

  it('sends items linked before multiple instances existed to the primary', async () => {
    const { svc, sonarrHd, sonarrAnime } = setup();
    await svc.executeDelete(item({ type: 'show', sonarr_id: 1 }), DeletionAction.FULL_REMOVAL);
    expect(sonarrHd.removeSeries).toHaveBeenCalledWith(1, true);
    expect(sonarrAnime.removeSeries).not.toHaveBeenCalled();
  });

  it('refuses when the item’s instance is disabled, without touching another', async () => {
    const { svc, radarrHd, update } = setup({ withRadarr4k: false, known: ['radarr', 'radarr-4k', 'sonarr', 'sonarr-anime'] });
    radarrHd.getMovieByTmdbId.mockResolvedValue({ id: 1 });
    const result = await svc.executeDelete(item({ radarr_id: 1, arr_instance: 'radarr-4k' }), DeletionAction.UNMONITOR_AND_DELETE);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/disabled or no longer configured/);
    expect(radarrHd.getMovieByTmdbId).not.toHaveBeenCalled();
    expect(radarrHd.deleteMovieFilesByMovieId).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it('looks an item up again when its instance was removed, and saves where it was found', async () => {
    const { svc, radarrHd, radarr4k, update } = setup({ known: ['radarr', 'radarr-4k', 'sonarr', 'sonarr-anime'] });
    radarr4k.getMovieByTmdbId.mockResolvedValue({ id: 7 });
    const result = await svc.executeDelete(item({ radarr_id: 1, arr_instance: 'radarr-gone' }), DeletionAction.DELETE_FILES_ONLY);
    expect(result.success).toBe(true);
    expect(update).toHaveBeenCalledWith(10, { radarr_id: 7, arr_instance: 'radarr-4k' });
    expect(radarr4k.deleteMovieFilesByMovieId).toHaveBeenCalledWith(7);
    expect(radarrHd.deleteMovieFilesByMovieId).not.toHaveBeenCalled();
  });

  it('links an unlinked item to the first instance that has it', async () => {
    const { svc, sonarrHd, sonarrAnime, update } = setup();
    sonarrAnime.getSeriesByTvdbId.mockResolvedValue({ id: 2 });
    await svc.executeDelete(item({ type: 'show', tvdb_id: 267440, tmdb_id: null }), DeletionAction.UNMONITOR_ONLY);
    expect(sonarrHd.getSeriesByTvdbId).toHaveBeenCalledWith(267440);
    expect(update).toHaveBeenCalledWith(10, { sonarr_id: 2, arr_instance: 'sonarr-anime' });
    expect(sonarrAnime.unmonitorSeries).toHaveBeenCalledWith(2);
    expect(sonarrHd.unmonitorSeries).not.toHaveBeenCalled();
  });

  it('clears a stale instance when the item is found in the primary', async () => {
    const { svc, radarrHd, update } = setup({ known: ['radarr', 'sonarr'] });
    radarrHd.getMovieByTmdbId.mockResolvedValue({ id: 4 });
    await svc.executeDelete(item({ radarr_id: 1, arr_instance: 'radarr-gone' }), DeletionAction.UNMONITOR_ONLY);
    expect(update).toHaveBeenCalledWith(10, { radarr_id: 4, arr_instance: 'radarr' });
  });
});
