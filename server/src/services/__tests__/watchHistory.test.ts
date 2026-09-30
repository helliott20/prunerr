import { describe, it, expect } from 'vitest';
import { countWatchedEpisodes } from '../watchHistory';

describe('countWatchedEpisodes', () => {
  it('counts each watched episode once, however often it was played', () => {
    const entries = [
      { plex_rating_key: 'ep-1', watched: true },
      { plex_rating_key: 'ep-1', watched: true },
      { plex_rating_key: 'ep-2', watched: true },
    ];
    expect(countWatchedEpisodes(entries, 'show-1')).toBe(2);
  });

  it('ignores unfinished plays and entries keyed to the show itself', () => {
    const entries = [
      { plex_rating_key: 'ep-1', watched: false },
      { plex_rating_key: 'show-1', watched: true },
      { plex_rating_key: 'ep-3', watched: true },
    ];
    expect(countWatchedEpisodes(entries, 'show-1')).toBe(1);
  });

  it('is zero with no history', () => {
    expect(countWatchedEpisodes([], 'show-1')).toBe(0);
  });
});
