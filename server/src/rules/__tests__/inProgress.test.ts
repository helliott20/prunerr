import { describe, it, expect } from 'vitest';
import { isShowInProgress, isProtectedInProgress, percentWatched, usersInProgress, watchProgress } from '../inProgress';

const NOW = new Date('2026-09-30T12:00:00Z');
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString();

const show = (overrides: Record<string, unknown> = {}) => ({
  type: 'show' as const,
  episode_count: 40,
  watched_episode_count: 3,
  last_watched_at: daysAgo(5),
  ...overrides,
});

describe('isShowInProgress', () => {
  it('is true part-way through and watched recently', () => {
    expect(isShowInProgress(show(), 60, NOW)).toBe(true);
  });

  it('is false once every episode is watched', () => {
    expect(isShowInProgress(show({ watched_episode_count: 40 }), 60, NOW)).toBe(false);
    expect(isShowInProgress(show({ watched_episode_count: 45 }), 60, NOW)).toBe(false);
  });

  it('is false when nothing is watched or the count is unknown', () => {
    expect(isShowInProgress(show({ watched_episode_count: 0 }), 60, NOW)).toBe(false);
    expect(isShowInProgress(show({ watched_episode_count: null }), 60, NOW)).toBe(false);
    expect(isShowInProgress(show({ episode_count: null }), 60, NOW)).toBe(false);
  });

  it('is false when the last episode was watched outside the window', () => {
    expect(isShowInProgress(show({ last_watched_at: daysAgo(61) }), 60, NOW)).toBe(false);
    expect(isShowInProgress(show({ last_watched_at: daysAgo(60) }), 60, NOW)).toBe(true);
    expect(isShowInProgress(show({ last_watched_at: null }), 60, NOW)).toBe(false);
  });

  it('never applies to movies', () => {
    expect(isShowInProgress(show({ type: 'movie' }), 60, NOW)).toBe(false);
  });
});

describe('isProtectedInProgress', () => {
  it('follows the safety toggle', () => {
    expect(isProtectedInProgress(show(), { protect: true, recentDays: 60 }, NOW)).toBe(true);
    expect(isProtectedInProgress(show(), { protect: false, recentDays: 60 }, NOW)).toBe(false);
  });
});

describe('percentWatched', () => {
  it('rounds and caps at 100', () => {
    expect(percentWatched(show())).toBe(8);
    expect(percentWatched(show({ watched_episode_count: 50 }))).toBe(100);
  });

  it('is null when unknown or not a show', () => {
    expect(percentWatched(show({ watched_episode_count: null }))).toBeNull();
    expect(percentWatched(show({ episode_count: 0 }))).toBeNull();
    expect(percentWatched(show({ type: 'movie' }))).toBeNull();
  });
});

describe('per person', () => {
  const perPerson = (progress: Record<string, { watched: number; lastWatched: string | null }>) =>
    show({ episode_progress: JSON.stringify(progress), watched_episode_count: 40 });

  it('is in progress when one person finished and another is half-way', () => {
    // Together they cover all 40 episodes, but Bob is still watching.
    const item = perPerson({
      alice: { watched: 40, lastWatched: daysAgo(30) },
      bob: { watched: 20, lastWatched: daysAgo(2) },
    });
    expect(isShowInProgress(item, 60, NOW)).toBe(true);
    expect(watchProgress(item, 60, NOW)).toBe('in_progress');
    expect(usersInProgress(item, 60, NOW)).toEqual(['bob']);
  });

  it('is not finished when two people each watched half', () => {
    const item = perPerson({
      alice: { watched: 20, lastWatched: daysAgo(200) },
      bob: { watched: 20, lastWatched: daysAgo(300) },
    });
    expect(watchProgress(item, 60, NOW)).toBe('stalled');
    expect(isShowInProgress(item, 60, NOW)).toBe(false);
  });

  it('is finished only when nobody stopped short', () => {
    const item = perPerson({
      alice: { watched: 40, lastWatched: daysAgo(10) },
      bob: { watched: 40, lastWatched: daysAgo(90) },
    });
    expect(watchProgress(item, 60, NOW)).toBe('finished');
    expect(usersInProgress(item, 60, NOW)).toEqual([]);
  });

  it('uses each person’s own last watch for the recent window', () => {
    // Alice watched yesterday but has finished; Bob is part-way but stopped.
    const item = perPerson({
      alice: { watched: 40, lastWatched: daysAgo(1) },
      bob: { watched: 12, lastWatched: daysAgo(120) },
    });
    expect(isShowInProgress(item, 60, NOW)).toBe(false);
    expect(watchProgress(item, 60, NOW)).toBe('stalled');
  });

  it('ignores unreadable progress and falls back to the combined count', () => {
    const item = show({ episode_progress: 'not json' });
    expect(isShowInProgress(item, 60, NOW)).toBe(true);
  });
});
