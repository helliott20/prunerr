import { describe, it, expect } from 'vitest';

import { buildSonarrSeriesDetail } from '../sonarrSeriesDetail';
import type {
  SonarrEpisode,
  SonarrEpisodeFile,
  SonarrQueueRecord,
  SonarrSeries,
} from '../types';

const NOW = new Date('2026-03-01T00:00:00Z');

function makeSeries(overrides: Partial<SonarrSeries> = {}): SonarrSeries {
  return {
    id: 7,
    title: 'Example Show',
    sortTitle: 'example show',
    status: 'continuing',
    ended: false,
    images: [],
    seasons: [
      { seasonNumber: 0, monitored: false },
      { seasonNumber: 1, monitored: true },
      { seasonNumber: 2, monitored: true },
    ],
    year: 2020,
    path: '/tv/Example Show',
    qualityProfileId: 4,
    languageProfileId: 1,
    seasonFolder: true,
    monitored: true,
    useSceneNumbering: false,
    runtime: 45,
    tvdbId: 1234,
    tvRageId: 0,
    tvMazeId: 0,
    seriesType: 'standard',
    cleanTitle: 'exampleshow',
    titleSlug: 'example-show',
    genres: ['Drama'],
    tags: [1, 2],
    added: '2024-01-01T00:00:00Z',
    ratings: { votes: 10, value: 8 },
    statistics: {
      seasonCount: 2,
      episodeFileCount: 2,
      episodeCount: 3,
      totalEpisodeCount: 4,
      sizeOnDisk: 999,
      percentOfEpisodes: 66,
    },
    ...overrides,
  };
}

function makeEpisode(overrides: Partial<SonarrEpisode> & Pick<SonarrEpisode, 'id'>): SonarrEpisode {
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

function makeFile(overrides: Partial<SonarrEpisodeFile> & Pick<SonarrEpisodeFile, 'id'>): SonarrEpisodeFile {
  return {
    seriesId: 7,
    seasonNumber: 1,
    relativePath: 'Season 01/example.mkv',
    path: '/tv/Example Show/Season 01/example.mkv',
    size: 1_000,
    dateAdded: '2025-01-01T00:00:00Z',
    quality: {
      quality: { id: 4, name: 'WEBDL-1080p', source: 'web', resolution: 1080 },
      revision: { version: 1, real: 0, isRepack: false },
    },
    qualityCutoffNotMet: false,
    ...overrides,
  };
}

describe('buildSonarrSeriesDetail', () => {
  it('derives per-episode state from file, queue, air date and monitoring', () => {
    const episodes: SonarrEpisode[] = [
      makeEpisode({ id: 1, episodeNumber: 1, episodeFileId: 101, hasFile: true, airDateUtc: '2026-01-01T00:00:00Z' }),
      makeEpisode({ id: 2, episodeNumber: 2, airDateUtc: '2026-01-08T00:00:00Z' }),
      makeEpisode({ id: 3, episodeNumber: 3, airDateUtc: '2026-01-15T00:00:00Z', monitored: false }),
      makeEpisode({ id: 4, episodeNumber: 4, airDateUtc: '2026-06-01T00:00:00Z' }),
      makeEpisode({ id: 5, episodeNumber: 5, airDateUtc: '2026-02-01T00:00:00Z' }),
    ];
    const queue: SonarrQueueRecord[] = [
      { id: 900, seriesId: 7, episodeId: 5, size: 1_000, sizeleft: 250, status: 'downloading', trackedDownloadState: 'downloading' },
    ];

    const detail = buildSonarrSeriesDetail({
      series: makeSeries(),
      episodes,
      files: [makeFile({ id: 101 })],
      queue,
      now: NOW,
    });

    const season1 = detail.seasons.find((s) => s.seasonNumber === 1)!;
    expect(season1.episodes.map((e) => e.state)).toEqual([
      'downloaded',
      'missing',
      'unmonitored',
      'unaired',
      'downloading',
    ]);
    expect(season1.episodes[4]!.download).toMatchObject({ progress: 75, sizeleft: 250 });
  });

  it('aggregates season and series totals over aired episodes only', () => {
    const detail = buildSonarrSeriesDetail({
      series: makeSeries(),
      episodes: [
        makeEpisode({ id: 1, episodeNumber: 1, episodeFileId: 101, hasFile: true, airDateUtc: '2026-01-01T00:00:00Z' }),
        makeEpisode({ id: 2, episodeNumber: 2, airDateUtc: '2026-01-08T00:00:00Z' }),
        makeEpisode({ id: 3, episodeNumber: 3, airDateUtc: '2026-12-01T00:00:00Z' }),
        makeEpisode({ id: 4, seasonNumber: 2, episodeNumber: 1, episodeFileId: 102, hasFile: true, airDateUtc: '2026-02-01T00:00:00Z' }),
      ],
      files: [makeFile({ id: 101, size: 1_500 }), makeFile({ id: 102, seasonNumber: 2, size: 2_500, qualityCutoffNotMet: true })],
      now: NOW,
    });

    const season1 = detail.seasons.find((s) => s.seasonNumber === 1)!;
    expect(season1).toMatchObject({
      episodeCount: 3,
      airedCount: 2,
      episodeFileCount: 1,
      missingCount: 1,
      sizeOnDisk: 1_500,
      percentComplete: 50,
    });

    expect(detail.totals).toMatchObject({
      seasonCount: 2,
      episodeCount: 4,
      airedCount: 3,
      episodeFileCount: 2,
      sizeOnDisk: 4_000,
      missingCount: 1,
      cutoffUnmetCount: 1,
      percentComplete: 67,
    });
  });

  it('orders seasons ascending with specials last and episodes ascending', () => {
    const detail = buildSonarrSeriesDetail({
      series: makeSeries(),
      episodes: [
        makeEpisode({ id: 1, seasonNumber: 2, episodeNumber: 2 }),
        makeEpisode({ id: 2, seasonNumber: 0, episodeNumber: 1 }),
        makeEpisode({ id: 3, seasonNumber: 2, episodeNumber: 1 }),
        makeEpisode({ id: 4, seasonNumber: 1, episodeNumber: 1 }),
      ],
      files: [],
      now: NOW,
    });

    expect(detail.seasons.map((s) => s.seasonNumber)).toEqual([1, 2, 0]);
    const season2 = detail.seasons.find((s) => s.seasonNumber === 2)!;
    expect(season2.episodes.map((e) => e.episodeNumber)).toEqual([1, 2]);
  });

  it('keeps seasons Sonarr knows about even when they have no episodes yet', () => {
    const detail = buildSonarrSeriesDetail({
      series: makeSeries({ seasons: [{ seasonNumber: 1, monitored: true }, { seasonNumber: 3, monitored: true }] }),
      episodes: [makeEpisode({ id: 1, seasonNumber: 1, episodeNumber: 1 })],
      files: [],
      now: NOW,
    });

    expect(detail.seasons.map((s) => s.seasonNumber)).toEqual([1, 3]);
    expect(detail.seasons[1]).toMatchObject({ episodeCount: 0, percentComplete: 0, monitored: true });
  });

  it('summarises file media info, release flags and languages', () => {
    const detail = buildSonarrSeriesDetail({
      series: makeSeries(),
      episodes: [makeEpisode({ id: 1, episodeFileId: 101, hasFile: true, airDateUtc: '2026-01-01T00:00:00Z' })],
      files: [
        makeFile({
          id: 101,
          releaseGroup: 'GROUP',
          qualityCutoffNotMet: true,
          quality: {
            quality: { id: 4, name: 'WEBDL-1080p', source: 'web', resolution: 1080 },
            revision: { version: 2, real: 0, isRepack: false },
          },
          languages: [{ id: 1, name: 'English' }, { id: 2, name: 'Japanese' }],
          mediaInfo: {
            audioBitrate: 640_000,
            audioChannels: 5.1,
            audioCodec: 'EAC3',
            audioLanguages: 'eng',
            audioStreamCount: 1,
            videoBitDepth: 8,
            videoBitrate: 4_000_000,
            videoCodec: 'h264',
            videoFps: 23.976,
            resolution: '1920x1080',
            runTime: '45:12',
            scanType: 'progressive',
            subtitles: 'eng/spa',
          },
        }),
      ],
      now: NOW,
    });

    expect(detail.seasons[0]!.episodes[0]!.file).toMatchObject({
      quality: 'WEBDL-1080p',
      qualityRevision: 'PROPER',
      qualityCutoffNotMet: true,
      releaseGroup: 'GROUP',
      languages: ['English', 'Japanese'],
      resolution: '1920x1080',
      videoCodec: 'h264',
      audioCodec: 'EAC3',
      audioChannels: 5.1,
      subtitles: ['eng', 'spa'],
      runTime: '45:12',
    });
  });

  it('resolves tag labels, quality profile name and the next airing', () => {
    const detail = buildSonarrSeriesDetail({
      series: makeSeries(),
      episodes: [
        makeEpisode({ id: 1, episodeNumber: 1, airDateUtc: '2026-01-01T00:00:00Z' }),
        makeEpisode({ id: 2, episodeNumber: 2, airDateUtc: '2026-05-01T00:00:00Z' }),
        makeEpisode({ id: 3, episodeNumber: 3, airDateUtc: '2026-04-01T00:00:00Z' }),
      ],
      files: [],
      qualityProfileName: 'HD-1080p',
      tagLabels: new Map([[1, 'kids'], [3, 'ignored']]),
      now: NOW,
    });

    expect(detail.series).toMatchObject({
      qualityProfileName: 'HD-1080p',
      tags: ['kids'],
      nextAiring: '2026-04-01T00:00:00Z',
    });
  });

  it('ignores queue records belonging to other series', () => {
    const detail = buildSonarrSeriesDetail({
      series: makeSeries(),
      episodes: [makeEpisode({ id: 1, airDateUtc: '2026-01-01T00:00:00Z' })],
      files: [],
      queue: [{ id: 1, seriesId: 99, episodeId: 1, size: 100, sizeleft: 50, status: 'downloading' }],
      now: NOW,
    });

    expect(detail.seasons[0]!.episodes[0]!.state).toBe('missing');
  });

  it('marks queued episodes and counts them per season and overall', () => {
    const detail = buildSonarrSeriesDetail({
      series: makeSeries(),
      episodes: [
        makeEpisode({ id: 1, episodeNumber: 1, episodeFileId: 101, hasFile: true, airDateUtc: '2026-01-01T00:00:00Z' }),
        makeEpisode({ id: 2, episodeNumber: 2, airDateUtc: '2026-01-08T00:00:00Z' }),
        makeEpisode({ id: 3, seasonNumber: 2, episodeNumber: 1, airDateUtc: '2026-01-15T00:00:00Z' }),
      ],
      files: [makeFile({ id: 101 })],
      queuedByEpisodeId: new Map([
        [1, { id: 55, action: 'unmonitor_and_delete', markedAt: '2026-02-01T00:00:00Z', deleteAfter: '2026-02-08T00:00:00Z' }],
      ]),
      now: NOW,
    });

    const season1 = detail.seasons.find((s) => s.seasonNumber === 1)!;
    expect(season1.episodes[0]!.queued).toMatchObject({ id: 55, deleteAfter: '2026-02-08T00:00:00Z' });
    expect(season1.episodes[1]!.queued).toBeUndefined();
    expect(season1.queuedCount).toBe(1);
    expect(detail.totals.queuedCount).toBe(1);
  });

  it('falls back to Sonarr statistics for size when no files are present', () => {
    const detail = buildSonarrSeriesDetail({
      series: makeSeries(),
      episodes: [makeEpisode({ id: 1 })],
      files: [],
      now: NOW,
    });

    expect(detail.totals.sizeOnDisk).toBe(999);
  });
});
