import { describe, it, expect } from 'vitest';

import { filterSeasons, summariseSelection } from '../sonarrPanelUtils';
import type { SonarrEpisodeSummary, SonarrSeasonSummary } from '@/types';

function episode(
  episodeNumber: number,
  state: SonarrEpisodeSummary['state'],
  cutoffNotMet = false
): SonarrEpisodeSummary {
  const base: SonarrEpisodeSummary = {
    id: episodeNumber,
    seasonNumber: 1,
    episodeNumber,
    title: `Episode ${episodeNumber}`,
    monitored: true,
    hasFile: state === 'downloaded',
    state,
  };
  if (state === 'downloaded') {
    base.file = { id: episodeNumber, size: 1_000, qualityCutoffNotMet: cutoffNotMet };
  }
  return base;
}

const season: SonarrSeasonSummary = {
  seasonNumber: 1,
  monitored: true,
  episodeCount: 4,
  airedCount: 4,
  episodeFileCount: 2,
  sizeOnDisk: 2_000,
  missingCount: 1,
  downloadingCount: 1,
  cutoffUnmetCount: 1,
  queuedCount: 0,
  percentComplete: 50,
  episodes: [
    episode(1, 'downloaded'),
    episode(2, 'missing'),
    episode(3, 'downloading'),
    episode(4, 'downloaded', true),
  ],
};

const emptySeason: SonarrSeasonSummary = { ...season, seasonNumber: 2, episodes: [] };

describe('filterSeasons', () => {
  it('passes every season through untouched when no filter is active', () => {
    const result = filterSeasons([season, emptySeason], 'all');
    expect(result).toHaveLength(2);
    expect(result[0]!.episodes).toHaveLength(4);
    expect(result[1]!.episodes).toHaveLength(0);
  });

  it('lists only matching episodes but keeps the full season for the header', () => {
    const [visible] = filterSeasons([season], 'missing');
    expect(visible!.episodes.map((e) => e.episodeNumber)).toEqual([2]);
    // The header/strip must still describe the whole season, not the filtered slice.
    expect(visible!.season.episodes).toHaveLength(4);
    expect(visible!.season.episodeFileCount).toBe(2);
  });

  it('filters downloading episodes', () => {
    const [visible] = filterSeasons([season], 'downloading');
    expect(visible!.episodes.map((e) => e.episodeNumber)).toEqual([3]);
  });

  it('filters episodes whose file is below the quality cutoff', () => {
    const [visible] = filterSeasons([season], 'upgradable');
    expect(visible!.episodes.map((e) => e.episodeNumber)).toEqual([4]);
  });

  it('drops seasons with no matching episodes', () => {
    expect(filterSeasons([emptySeason], 'missing')).toEqual([]);
  });
});

describe('filterSeasons (queued)', () => {
  it('lists only episodes sitting in the deletion queue', () => {
    const queuedSeason: SonarrSeasonSummary = {
      ...season,
      queuedCount: 1,
      episodes: season.episodes.map((e) =>
        e.episodeNumber === 2
          ? { ...e, queued: { id: 9, action: 'unmonitor_and_delete', markedAt: 'x', deleteAfter: 'y' } }
          : e
      ),
    };

    const [visible] = filterSeasons([queuedSeason], 'queued');
    expect(visible!.episodes.map((e) => e.episodeNumber)).toEqual([2]);
  });
});

describe('summariseSelection', () => {
  it('totals the size of the selected episodes and flags queued ones', () => {
    const queuedSeason: SonarrSeasonSummary = {
      ...season,
      episodes: season.episodes.map((e) =>
        e.episodeNumber === 4
          ? { ...e, queued: { id: 9, action: 'unmonitor_and_delete', markedAt: 'x', deleteAfter: 'y' } }
          : e
      ),
    };

    const summary = summariseSelection([queuedSeason], new Set([1, 4]));
    expect(summary.episodeIds).toEqual([1, 4]);
    expect(summary.totalSize).toBe(2_000);
    expect(summary.queuedIds).toEqual([4]);
  });

  it('ignores selected ids that are no longer in the tree', () => {
    expect(summariseSelection([season], new Set([999]))).toEqual({
      episodeIds: [],
      totalSize: 0,
      queuedIds: [],
    });
  });
});
