import { describe, it, expect } from 'vitest';
import { normaliseResolution, summariseEpisodeFiles } from '../mediaSummary';
import type { SonarrEpisodeFile, SonarrMediaInfo } from '../types';

const file = (info: Partial<SonarrMediaInfo> | null, id = Math.random()): SonarrEpisodeFile =>
  ({
    id,
    seriesId: 1,
    seasonNumber: 1,
    relativePath: 'S01/x.mkv',
    path: '/tv/x.mkv',
    size: 1,
    dateAdded: '2026-01-01T00:00:00Z',
    quality: { quality: { id: 1, name: 'WEBDL-1080p' }, revision: { version: 1, real: 0 } },
    qualityCutoffNotMet: false,
    ...(info ? { mediaInfo: info as SonarrMediaInfo } : {}),
  }) as SonarrEpisodeFile;

describe('normaliseResolution', () => {
  it('takes the height from Sonarr WxH strings', () => {
    expect(normaliseResolution('1920x1080')).toBe('1080');
    expect(normaliseResolution('3840x2160')).toBe('2160');
    expect(normaliseResolution('1280x720')).toBe('720');
  });

  it('maps a cinematic crop to the standard it is sold under', () => {
    // 2.39:1 at 1080p is 1920x800 — not "800p".
    expect(normaliseResolution('1920x800')).toBe('1080');
    expect(normaliseResolution('3840x1600')).toBe('2160');
  });

  it('accepts the labels and bare numbers Plex uses', () => {
    expect(normaliseResolution('4k')).toBe('2160');
    expect(normaliseResolution('1080p')).toBe('1080');
    expect(normaliseResolution('1080')).toBe('1080');
    expect(normaliseResolution('sd')).toBe('480');
  });

  it('returns nothing it cannot read', () => {
    expect(normaliseResolution(undefined)).toBeUndefined();
    expect(normaliseResolution('')).toBeUndefined();
    expect(normaliseResolution('who knows')).toBeUndefined();
  });
});

describe('summariseEpisodeFiles', () => {
  it('reports what most of the files are, not the best one', () => {
    const summary = summariseEpisodeFiles([
      file({ resolution: '1920x1080', videoCodec: 'h264', audioCodec: 'AC3', videoBitrate: 4_000_000 }),
      file({ resolution: '1920x1080', videoCodec: 'h264', audioCodec: 'AC3', videoBitrate: 4_400_000 }),
      file({ resolution: '3840x2160', videoCodec: 'h265', audioCodec: 'EAC3', videoBitrate: 12_000_000 }),
    ]);
    expect(summary.resolution).toBe('1080');
    expect(summary.videoCodec).toBe('h264');
    expect(summary.audioCodec).toBe('AC3');
  });

  it('averages the bitrate rather than taking one file as typical', () => {
    const summary = summariseEpisodeFiles([
      file({ resolution: '1920x1080', videoCodec: 'h264', videoBitrate: 2_000_000 }),
      file({ resolution: '1920x1080', videoCodec: 'h264', videoBitrate: 4_000_000 }),
    ]);
    expect(summary.bitrate).toBe(3_000_000);
  });

  it('ignores files Sonarr has no media info for', () => {
    const summary = summariseEpisodeFiles([
      file(null),
      file({ resolution: '1280x720', videoCodec: 'h264' }),
    ]);
    expect(summary.resolution).toBe('720');
  });

  it('is empty when nothing carries media info', () => {
    expect(summariseEpisodeFiles([file(null), file(null)])).toEqual({});
    expect(summariseEpisodeFiles([])).toEqual({});
  });
});
