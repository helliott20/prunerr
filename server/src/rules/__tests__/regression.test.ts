import { describe, it, expect } from 'vitest';
import { upgradeToV2 } from '../migration';
import { evaluateNode } from '../conditions';
import type { MediaItem } from '../../types';

function item(overrides: Partial<MediaItem> = {}): MediaItem {
  const daysAgo = (d: number) => new Date(Date.now() - d * 86400000).toISOString();
  return {
    id: 1,
    type: 'movie',
    title: 'Sample',
    plex_id: null,
    sonarr_id: null,
    radarr_id: null,
    tmdb_id: null,
    imdb_id: null,
    tvdb_id: null,
    year: 2015,
    poster_url: null,
    file_path: null,
    file_size: 10 * 1024 * 1024 * 1024,
    resolution: '1080p',
    codec: 'h264',
    added_at: daysAgo(60),
    last_watched_at: null,
    play_count: 0,
    watched_by: null,
    status: 'monitored',
    marked_at: null,
    delete_after: null,
    is_protected: false,
    protection_reason: null,
    genres: null,
    tags: null,
    studio: null,
    audio_codec: null,
    video_codec: null,
    hdr: null,
    bitrate: null,
    runtime_minutes: null,
    season_count: null,
    episode_count: null,
    series_status: null,
    rating_imdb: null,
    rating_tmdb: null,
    rating_rt: null,
    content_rating: null,
    original_language: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

/**
 * Legacy flat AND evaluator — mimics the v1 code path in scheduler/tasks.ts.
 */
function legacyEvaluate(
  i: MediaItem,
  conditions: Array<{ field: string; operator: string; value: any }>
): boolean {
  if (conditions.length === 0) return false;
  for (const c of conditions) {
    const fv = legacyField(i, c.field);
    let m = false;
    switch (c.operator) {
      case 'equals':
        m = fv === c.value;
        break;
      case 'not_equals':
        m = fv !== c.value;
        break;
      case 'greater_than':
        m = typeof fv === 'number' && fv > c.value;
        break;
      case 'less_than':
        m = typeof fv === 'number' && fv < c.value;
        break;
    }
    if (!m) return false;
  }
  return true;
}

function legacyField(i: MediaItem, field: string): unknown {
  if (field === 'days_since_added')
    return i.added_at
      ? Math.floor((Date.now() - new Date(i.added_at).getTime()) / 86400000)
      : null;
  if (field === 'days_since_watched')
    return i.last_watched_at
      ? Math.floor((Date.now() - new Date(i.last_watched_at).getTime()) / 86400000)
      : null;
  if (field === 'size_gb') return i.file_size ? i.file_size / (1024 ** 3) : null;
  return (i as any)[field];
}

describe('v1 → v2 regression: legacy rules evaluate identically after upgrade', () => {
  const items = [
    item({ id: 1, play_count: 0, year: 2010 }),
    item({ id: 2, play_count: 5, year: 1995 }),
    item({ id: 3, play_count: 0, year: 2023 }),
    item({ id: 4, play_count: 2, year: 2008, file_size: 20 * 1024 ** 3 }),
  ];

  const samples = [
    {
      name: 'never watched + old',
      conditions: [
        { field: 'play_count', operator: 'equals', value: 0 },
        { field: 'days_since_added', operator: 'greater_than', value: 30 },
      ],
    },
    {
      name: 'large + old year',
      conditions: [
        { field: 'size_gb', operator: 'greater_than', value: 15 },
        { field: 'year', operator: 'less_than', value: 2020 },
      ],
    },
    {
      name: 'single condition',
      conditions: [{ field: 'year', operator: 'less_than', value: 2000 }],
    },
  ];

  for (const sample of samples) {
    it(`matches legacy behavior for: ${sample.name}`, () => {
      const v2 = upgradeToV2(sample.conditions);
      for (const it of items) {
        const legacyMatch = legacyEvaluate(it, sample.conditions);
        const v2Match = evaluateNode(v2.root, it);
        expect(v2Match).toBe(legacyMatch);
      }
    });
  }
});
