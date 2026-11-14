import { describe, it, expect, vi } from 'vitest';

// Regression (issue #109): a movie Radarr has, but which the last scan didn't
// link (added to Radarr after the scan, Radarr unreachable during it, or an id
// the scan couldn't parse), was refused as "Not managed by Sonarr or Radarr".
// The delete now asks Radarr/Sonarr directly before giving up.

vi.mock('../../db/repositories/activity', () => ({ logActivity: vi.fn() }));
vi.mock('../../utils/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { DeletionService } from '../deletion';
import { DeletionAction } from '../../rules/types';

const unlinkedMovie = {
  id: 12,
  title: 'Maze Runner: The Death Cure',
  type: 'movie',
  file_size: 5_000_000_000,
  sonarr_id: null,
  radarr_id: null,
  file_path: null,
  tmdb_id: 345887,
  imdb_id: 'tt4500922',
  tvdb_id: null,
} as never;

function buildService(radarrMatch: { id: number } | null) {
  const update = vi.fn(async () => undefined);
  const radarr = {
    unmonitorMovie: vi.fn(async () => undefined),
    deleteMovieFile: vi.fn(async () => undefined),
    deleteMovieFilesByMovieId: vi.fn(async () => true),
    removeMovie: vi.fn(async () => undefined),
    getMovieByTmdbId: vi.fn(async () => radarrMatch),
    getMovieByImdbId: vi.fn(async () => null),
  };
  const svc = new DeletionService({
    mediaItemRepository: {
      getById: async () => unlinkedMovie,
      update,
      delete: vi.fn(async () => undefined),
      getByStatus: async () => [],
    },
    radarrService: radarr,
    deletionHistoryRepository: { create: vi.fn(async () => ({}) as never) },
  } as never);
  return { svc, update, radarr };
}

describe('deleting a movie the scan did not link to Radarr', () => {
  it('looks it up in Radarr by TMDB id, saves the link and deletes it', async () => {
    const { svc, update, radarr } = buildService({ id: 77 });

    const result = await svc.executeDelete(unlinkedMovie, DeletionAction.DELETE_FILES_ONLY);

    expect(result.success).toBe(true);
    expect(radarr.getMovieByTmdbId).toHaveBeenCalledWith(345887);
    expect(update).toHaveBeenCalledWith(12, { radarr_id: 77 });
    expect(radarr.deleteMovieFilesByMovieId).toHaveBeenCalledWith(77);
  });

  it('still refuses when Radarr does not have it either', async () => {
    const { svc, radarr } = buildService(null);

    const result = await svc.executeDelete(unlinkedMovie, DeletionAction.DELETE_FILES_ONLY);

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Not managed by Sonarr or Radarr/);
    expect(radarr.getMovieByImdbId).toHaveBeenCalledWith('tt4500922');
    expect(radarr.deleteMovieFilesByMovieId).not.toHaveBeenCalled();
  });
});

import { resolveArrLink } from '../arrLink';

describe('resolveArrLink for shows', () => {
  const show = {
    id: 3, title: 'Game of Thrones', type: 'show',
    sonarr_id: null, radarr_id: null, tmdb_id: 1399, imdb_id: null, tvdb_id: null,
  } as never;

  it('falls back to the TMDB id (legacy Plex TMDB agent)', async () => {
    const sonarr = {
      getSeriesByTvdbId: vi.fn(async () => null),
      getSeriesByImdbId: vi.fn(async () => null),
      getSeriesByTmdbId: vi.fn(async () => ({ id: 9 })),
    };
    expect(await resolveArrLink(show, { sonarr })).toEqual({ sonarr_id: 9 });
    expect(sonarr.getSeriesByTmdbId).toHaveBeenCalledWith(1399);
  });

  it('never uses Radarr for a show', async () => {
    const radarr = { getMovieByTmdbId: vi.fn(async () => ({ id: 1 })), getMovieByImdbId: vi.fn(async () => null) };
    expect(await resolveArrLink(show, { radarr })).toBeNull();
    expect(radarr.getMovieByTmdbId).not.toHaveBeenCalled();
  });

  it('returns null when a lookup throws', async () => {
    const sonarr = {
      getSeriesByTvdbId: vi.fn(async () => null),
      getSeriesByImdbId: vi.fn(async () => null),
      getSeriesByTmdbId: vi.fn(async () => { throw new Error('down'); }),
    };
    expect(await resolveArrLink(show, { sonarr })).toBeNull();
  });
});
