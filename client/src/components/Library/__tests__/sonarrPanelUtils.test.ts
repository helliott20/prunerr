import { describe, it, expect } from 'vitest';

import { filterSeasons } from '../sonarrPanelUtils';
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
