import { describe, it, expect } from 'vitest';
import { evaluateNode } from '../conditions';
import type { ConditionNode } from '../types';
import type { MediaItem } from '../../types';

function makeItem(overrides: Partial<MediaItem> = {}): MediaItem {
  return {
    id: 1,
    type: 'movie',
    title: 'Test Movie',
    plex_id: 'rk-1',
    sonarr_id: null,
    radarr_id: null,
    tmdb_id: null,
    imdb_id: null,
    tvdb_id: null,
    year: 2015,
    poster_url: null,
    file_path: '/mnt/media/movie.mkv',
    file_size: 5 * 1024 * 1024 * 1024, // 5 GB
    resolution: '1080p',
    codec: 'h264',
    added_at: new Date(Date.now() - 100 * 24 * 60 * 60 * 1000).toISOString(),
    last_watched_at: null,
    play_count: 0,
    watched_by: null,
    status: 'monitored',
    marked_at: null,
    delete_after: null,
    is_protected: false,
    protection_reason: null,
    genres: ['Drama', 'Thriller'],
    tags: ['favorite'],
    studio: 'A24',
    audio_codec: 'DTS',
    video_codec: 'h264',
    hdr: null,
    bitrate: 5000,
    runtime_minutes: 120,
    season_count: null,
    episode_count: null,
    series_status: null,
    rating_imdb: 7.5,
    rating_tmdb: 7.2,
    rating_rt: 85,
    content_rating: 'R',
    original_language: 'en',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

describe('evaluateNode — tree walker', () => {
  it('evaluates a single leaf condition', () => {
    const node: ConditionNode = {
      kind: 'condition',
      field: 'play_count',
      operator: 'equals',
      value: 0,
    };
    expect(evaluateNode(node, makeItem())).toBe(true);
    expect(evaluateNode(node, makeItem({ play_count: 3 }))).toBe(false);
  });

  it('AND group short-circuits on first false', () => {
    const node: ConditionNode = {
      kind: 'group',
      logic: 'AND',
      children: [
        { kind: 'condition', field: 'play_count', operator: 'equals', value: 0 },
        { kind: 'condition', field: 'year', operator: 'less_than', value: 2000 },
      ],
    };
    expect(evaluateNode(node, makeItem())).toBe(false);
    expect(evaluateNode(node, makeItem({ year: 1999 }))).toBe(true);
  });

  it('OR group returns true if any child matches', () => {
    const node: ConditionNode = {
      kind: 'group',
      logic: 'OR',
      children: [
        { kind: 'condition', field: 'play_count', operator: 'greater_than', value: 10 },
        { kind: 'condition', field: 'year', operator: 'less_than', value: 2020 },
      ],
    };
    expect(evaluateNode(node, makeItem())).toBe(true);
  });

  it('NOT group negates conjunction', () => {
    const node: ConditionNode = {
      kind: 'group',
      logic: 'NOT',
      children: [
        { kind: 'condition', field: 'play_count', operator: 'equals', value: 0 },
      ],
    };
    expect(evaluateNode(node, makeItem())).toBe(false);
    expect(evaluateNode(node, makeItem({ play_count: 5 }))).toBe(true);
  });

  it('handles nested AND/OR/NOT', () => {
    const node: ConditionNode = {
      kind: 'group',
      logic: 'AND',
      children: [
        { kind: 'condition', field: 'type', operator: 'equals', value: 'movie' },
        {
          kind: 'group',
          logic: 'OR',
          children: [
            { kind: 'condition', field: 'year', operator: 'less_than', value: 1990 },
            {
              kind: 'group',
              logic: 'NOT',
              children: [
                { kind: 'condition', field: 'play_count', operator: 'greater_than', value: 0 },
              ],
            },
          ],
        },
      ],
    };
    expect(evaluateNode(node, makeItem())).toBe(true); // movie, never watched → NOT(play_count > 0) true
    expect(evaluateNode(node, makeItem({ play_count: 2, year: 2020 }))).toBe(false);
    expect(evaluateNode(node, makeItem({ play_count: 2, year: 1985 }))).toBe(true);
  });

  it('empty group: AND is true, OR is false', () => {
    expect(evaluateNode({ kind: 'group', logic: 'AND', children: [] }, makeItem())).toBe(true);
    expect(evaluateNode({ kind: 'group', logic: 'OR', children: [] }, makeItem())).toBe(false);
  });
});

describe('new operators', () => {
  const item = makeItem();

  it('in / not_in', () => {
    const inNode: ConditionNode = {
      kind: 'condition',
      field: 'type',
      operator: 'in',
      value: ['movie', 'show'],
    };
    expect(evaluateNode(inNode, item)).toBe(true);
    const notInNode: ConditionNode = { ...inNode, operator: 'not_in', value: ['episode'] };
    expect(evaluateNode(notInNode, item)).toBe(true);
  });

  it('between', () => {
    const node: ConditionNode = {
      kind: 'condition',
      field: 'year',
      operator: 'between',
      value: [2000, 2020],
    };
    expect(evaluateNode(node, item)).toBe(true); // 2015
    expect(evaluateNode(node, makeItem({ year: 1999 }))).toBe(false);
  });

  it('regex_match', () => {
    const node: ConditionNode = {
      kind: 'condition',
      field: 'title',
      operator: 'regex_match',
      value: '^test',
    };
    expect(evaluateNode(node, item)).toBe(true);
    expect(evaluateNode(node, makeItem({ title: 'Other' }))).toBe(false);
  });

  it('is_null / is_not_null', () => {
    const isNull: ConditionNode = {
      kind: 'condition',
      field: 'last_watched_at',
      operator: 'is_null',
      value: null,
    };
    expect(evaluateNode(isNull, item)).toBe(true);
    const isNotNull: ConditionNode = { ...isNull, operator: 'is_not_null' };
    expect(evaluateNode(isNotNull, item)).toBe(false);
  });

  it('contains_any / contains_all on array fields', () => {
    const anyNode: ConditionNode = {
      kind: 'condition',
      field: 'genres',
      operator: 'contains_any',
      value: ['Action', 'Thriller'],
    };
    expect(evaluateNode(anyNode, item)).toBe(true);

    const allNode: ConditionNode = {
      kind: 'condition',
      field: 'genres',
      operator: 'contains_all',
      value: ['Drama', 'Thriller'],
    };
    expect(evaluateNode(allNode, item)).toBe(true);

    const allFail: ConditionNode = { ...allNode, value: ['Drama', 'Horror'] };
    expect(evaluateNode(allFail, item)).toBe(false);
  });

  it('matches_any / matches_all aliases', () => {
    const node: ConditionNode = {
      kind: 'condition',
      field: 'tags',
      operator: 'matches_any',
      value: ['favorite', 'watchlist'],
    };
    expect(evaluateNode(node, item)).toBe(true);
  });

  it('not_contains on arrays', () => {
    const node: ConditionNode = {
      kind: 'condition',
      field: 'genres',
      operator: 'not_contains',
      value: 'Horror',
    };
    expect(evaluateNode(node, item)).toBe(true);
  });
});

describe('new field evaluators (wave 1 metadata)', () => {
  const item = makeItem();

  it('studio equals', () => {
    const node: ConditionNode = {
      kind: 'condition',
      field: 'studio',
      operator: 'equals',
      value: 'A24',
    };
    expect(evaluateNode(node, item)).toBe(true);
  });

  it('audio_codec contains', () => {
    const node: ConditionNode = {
      kind: 'condition',
      field: 'audio_codec',
      operator: 'contains',
      value: 'dts',
    };
    expect(evaluateNode(node, item)).toBe(true);
  });

  it('hdr is_null', () => {
    const node: ConditionNode = {
      kind: 'condition',
      field: 'hdr',
      operator: 'is_null',
      value: null,
    };
    expect(evaluateNode(node, item)).toBe(true);
  });

  it('rating_imdb greater_than', () => {
    const node: ConditionNode = {
      kind: 'condition',
      field: 'rating_imdb',
      operator: 'greater_than',
      value: 7,
    };
    expect(evaluateNode(node, item)).toBe(true);
  });

  it('content_rating in', () => {
    const node: ConditionNode = {
      kind: 'condition',
      field: 'content_rating',
      operator: 'in',
      value: ['PG', 'PG-13', 'R'],
    };
    expect(evaluateNode(node, item)).toBe(true);
  });

  it('runtime_minutes between', () => {
    const node: ConditionNode = {
      kind: 'condition',
      field: 'runtime_minutes',
      operator: 'between',
      value: [90, 180],
    };
    expect(evaluateNode(node, item)).toBe(true);
  });
});

describe('collection_membership', () => {
  const item = makeItem();

  it('in_any_protected: returns true when item is in a protected collection', () => {
    const repo = {
      findProtectedContainingItem: (_id: number) => [{ id: 99 }],
      getMediaItemIds: (_cid: number) => [],
    };
    const node: ConditionNode = {
      kind: 'condition',
      field: 'collection_membership',
      operator: 'in_any_protected',
      value: null,
    };
    expect(evaluateNode(node, item, { collectionsRepo: repo })).toBe(true);
  });

  it('not_in_any_protected: returns true when no protected collections contain item', () => {
    const repo = {
      findProtectedContainingItem: (_id: number) => [],
      getMediaItemIds: (_cid: number) => [],
    };
    const node: ConditionNode = {
      kind: 'condition',
      field: 'collection_membership',
      operator: 'not_in_any_protected',
      value: null,
    };
    expect(evaluateNode(node, item, { collectionsRepo: repo })).toBe(true);
  });

  it('in_collection_id: checks membership of a specific collection', () => {
    const repo = {
      findProtectedContainingItem: (_id: number) => [],
      getMediaItemIds: (cid: number) => (cid === 7 ? [1, 2, 3] : []),
    };
    const node: ConditionNode = {
      kind: 'condition',
      field: 'collection_membership',
      operator: 'in_collection_id',
      value: 7,
    };
    expect(evaluateNode(node, item, { collectionsRepo: repo })).toBe(true);
    expect(evaluateNode({ ...node, value: 8 }, item, { collectionsRepo: repo })).toBe(false);
  });
});

describe('watched_by_user', () => {
  const item = makeItem({ plex_id: 'rk-42' });
  const now = new Date('2026-04-05T00:00:00.000Z');
  const watched10DaysAgo = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000);

  const watchLookup = new Map([
    ['rk-42', new Map([['alice', watched10DaysAgo]])],
  ]);

  it('ever_watched true when user has watched', () => {
    const node: ConditionNode = {
      kind: 'condition',
      field: 'watched_by_user',
      operator: 'ever_watched',
      value: null,
      params: { username: 'alice' },
    };
    expect(evaluateNode(node, item, { watchLookup, now })).toBe(true);
  });

  it('never_watched true for a user not in lookup', () => {
    const node: ConditionNode = {
      kind: 'condition',
      field: 'watched_by_user',
      operator: 'never_watched',
      value: null,
      params: { username: 'bob' },
    };
    expect(evaluateNode(node, item, { watchLookup, now })).toBe(true);
  });

  it('watched_since true if watched within N days', () => {
    const node: ConditionNode = {
      kind: 'condition',
      field: 'watched_by_user',
      operator: 'watched_since',
      value: null,
      params: { username: 'alice', days: 30 },
    };
    expect(evaluateNode(node, item, { watchLookup, now })).toBe(true);
  });

  it('not_watched_since true if last watched older than N days', () => {
    const node: ConditionNode = {
      kind: 'condition',
      field: 'watched_by_user',
      operator: 'not_watched_since',
      value: null,
      params: { username: 'alice', days: 5 },
    };
    expect(evaluateNode(node, item, { watchLookup, now })).toBe(true);
  });

  it('not_watched_since true when never watched by that user', () => {
    const node: ConditionNode = {
      kind: 'condition',
      field: 'watched_by_user',
      operator: 'not_watched_since',
      value: null,
      params: { username: 'bob', days: 5 },
    };
    expect(evaluateNode(node, item, { watchLookup, now })).toBe(true);
  });
});
