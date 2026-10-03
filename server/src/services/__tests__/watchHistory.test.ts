import { describe, it, expect } from 'vitest';
import { countWatchedEpisodes } from '../watchHistory';

const play = (plex_rating_key: string, media_title: string | null, watched = true) => ({
  plex_rating_key,
  media_title,
  media_type: 'episode',
  watched,
});

describe('countWatchedEpisodes', () => {
  it('counts each watched episode once, however often it was played', () => {
    const entries = [play('ep-1', 'Pilot'), play('ep-1', 'Pilot'), play('ep-2', 'Second')];
    expect(countWatchedEpisodes(entries, 'show-1')).toBe(2);
  });

  it('tells episodes apart by title when every play carries the show key', () => {
    // Tracearr keys an episode's play to the show's artwork.
    const entries = [
      play('show-1', 'The One with the Birth Mother'),
      play('show-1', 'The One with the Late Thanksgiving'),
      play('show-1', 'The One with the Late Thanksgiving'),
      play('season-3', 'The One with the Home Study'),
    ];
    expect(countWatchedEpisodes(entries, 'show-1')).toBe(3);
  });

  it('falls back to the rating key without a title, but never the show key', () => {
    const entries = [play('ep-9', null), play('show-1', null)];
    expect(countWatchedEpisodes(entries, 'show-1')).toBe(1);
  });

  it('ignores unfinished plays', () => {
    expect(countWatchedEpisodes([play('ep-1', 'Pilot', false)], 'show-1')).toBe(0);
  });

  it('is zero with no history', () => {
    expect(countWatchedEpisodes([], 'show-1')).toBe(0);
  });
});
