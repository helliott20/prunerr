import { describe, it, expect, vi } from 'vitest';

vi.mock('../../utils/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('../init', () => ({ getSonarrService: () => null }));
vi.mock('../../db/repositories/episodeDeletions', () => ({
  default: {
    createMany: vi.fn(() => []),
    markCompleted: vi.fn(),
    markFailed: vi.fn(),
    getAllPending: vi.fn(() => []),
    getDue: vi.fn(() => []),
  },
}));
vi.mock('../../db/repositories/mediaItems', () => ({ default: { getById: vi.fn(), update: vi.fn() } }));
vi.mock('../../db/repositories/historyRepo', () => ({ default: { create: vi.fn() } }));
vi.mock('../../db/repositories/activity', () => ({ logActivity: vi.fn() }));

import {
  actionDeletesFiles,
  actionUnmonitors,
  deleteAfterFor,
  episodeLabel,
  isEpisodeDeletionAction,
  resolveTargets,
} from '../episodeDeletions';
import type { SonarrEpisode, SonarrEpisodeFile } from '../types';

function episode(overrides: Partial<SonarrEpisode> & Pick<SonarrEpisode, 'id'>): SonarrEpisode {
  return {
    seriesId: 7,
    tvdbId: 0,
    episodeFileId: 0,
    seasonNumber: 1,
    episodeNumber: 1,
    title: 'Episode',
    hasFile: false,
    monitored: true,
    unverifiedSceneNumbering: false,
    grabbed: false,
    ...overrides,
  };
}

function file(id: number, size = 1_000): SonarrEpisodeFile {
  return {
    id,
    seriesId: 7,
    seasonNumber: 1,
    relativePath: `file-${id}.mkv`,
    path: `/tv/file-${id}.mkv`,
    size,
    dateAdded: '2026-01-01T00:00:00Z',
    quality: {
      quality: { id: 4, name: 'WEBDL-1080p', source: 'web', resolution: 1080 },
      revision: { version: 1, real: 0, isRepack: false },
    },
    qualityCutoffNotMet: false,
  };
}

const episodes: SonarrEpisode[] = [
  episode({ id: 1, seasonNumber: 1, episodeNumber: 1, episodeFileId: 101, hasFile: true }),
  episode({ id: 2, seasonNumber: 1, episodeNumber: 2 }),
  episode({ id: 3, seasonNumber: 2, episodeNumber: 1, episodeFileId: 102, hasFile: true }),
  episode({ id: 4, seasonNumber: 2, episodeNumber: 2, monitored: false }),
];
const files = [file(101), file(102, 2_000)];

describe('resolveTargets', () => {
  it('expands a season into its episodes', () => {
    const targets = resolveTargets({ episodes, files, seasonNumbers: [2], action: 'unmonitor_and_delete' });
    expect(targets.map((t) => t.episode.id)).toEqual([3, 4]);
  });

  it('attaches the matching episode file', () => {
    const [target] = resolveTargets({ episodes, files, episodeIds: [3], action: 'delete_files_only' });
    expect(target!.file?.id).toBe(102);
    expect(target!.file?.size).toBe(2_000);
  });

  it('skips file-less episodes when the action only deletes files', () => {
    const targets = resolveTargets({ episodes, files, seasonNumbers: [1, 2], action: 'delete_files_only' });
    expect(targets.map((t) => t.episode.id)).toEqual([1, 3]);
  });

  it('skips already-unmonitored episodes when the action only unmonitors', () => {
    const targets = resolveTargets({ episodes, files, seasonNumbers: [2], action: 'unmonitor_only' });
    expect(targets.map((t) => t.episode.id)).toEqual([3]);
  });

  it('keeps a file-less episode when the action also unmonitors', () => {
    const targets = resolveTargets({ episodes, files, episodeIds: [2], action: 'unmonitor_and_delete' });
    expect(targets.map((t) => t.episode.id)).toEqual([2]);
    expect(targets[0]!.file).toBeUndefined();
  });

  it('does not duplicate an episode named both directly and through its season', () => {
    const targets = resolveTargets({
      episodes,
      files,
      episodeIds: [3],
      seasonNumbers: [2],
      action: 'unmonitor_and_delete',
    });
    expect(targets.map((t) => t.episode.id)).toEqual([3, 4]);
  });

  it('returns targets in season then episode order', () => {
    const targets = resolveTargets({
      episodes: [...episodes].reverse(),
      files,
      seasonNumbers: [1, 2],
      action: 'unmonitor_and_delete',
    });
    expect(targets.map((t) => t.episode.id)).toEqual([1, 2, 3, 4]);
  });

  it('returns nothing when the selection matches no episode', () => {
    expect(resolveTargets({ episodes, files, episodeIds: [999], action: 'unmonitor_and_delete' })).toEqual([]);
  });
});

describe('deletion action helpers', () => {
  it('classifies the three episode actions', () => {
    expect(actionDeletesFiles('delete_files_only')).toBe(true);
    expect(actionDeletesFiles('unmonitor_and_delete')).toBe(true);
    expect(actionDeletesFiles('unmonitor_only')).toBe(false);
    expect(actionUnmonitors('unmonitor_only')).toBe(true);
    expect(actionUnmonitors('unmonitor_and_delete')).toBe(true);
    expect(actionUnmonitors('delete_files_only')).toBe(false);
  });

  it('rejects actions that only make sense for a whole series', () => {
    expect(isEpisodeDeletionAction('unmonitor_and_delete')).toBe(true);
    expect(isEpisodeDeletionAction('full_removal')).toBe(false);
    expect(isEpisodeDeletionAction('nonsense')).toBe(false);
  });
});

describe('deleteAfterFor', () => {
  it('adds the grace period to now', () => {
    const now = new Date('2026-03-01T12:00:00Z');
    expect(deleteAfterFor(7, now)).toBe(new Date('2026-03-08T12:00:00Z').toISOString());
  });

  it('is due immediately with a zero or negative grace period', () => {
    const now = new Date('2026-03-01T12:00:00Z');
    expect(deleteAfterFor(0, now)).toBe(now.toISOString());
    expect(deleteAfterFor(-5, now)).toBe(now.toISOString());
  });
});

describe('episodeLabel', () => {
  it('pads season and episode numbers', () => {
    expect(episodeLabel('Severance', 2, 3, 'Who Is Alive?')).toBe('Severance · S02E03 · Who Is Alive?');
    expect(episodeLabel('Show', 0, 12, 'Special')).toBe('Show · S00E12 · Special');
  });
});
