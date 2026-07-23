import { describe, it, expect } from 'vitest';
import { ruleScopeMatches } from '../scope';
import type { MediaItem, Rule } from '../../types';

function makeRule(overrides: Partial<Rule> = {}): Rule {
  return {
    id: 1,
    name: 'test rule',
    profile_id: null,
    type: 'custom',
    media_type: 'all',
    library_keys: null,
    conditions: '{"version":2,"root":{"kind":"group","logic":"AND","children":[]}}',
    action: 'delete',
    enabled: true,
    grace_period_days: 7,
    deletion_action: 'unmonitor_and_delete',
    reset_overseerr: false,
    priority: 0,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

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
    year: 2020,
    poster_url: null,
    file_path: null,
    file_size: null,
    resolution: null,
    codec: null,
    added_at: null,
    last_watched_at: null,
    play_count: 0,
    watched_by: null,
    status: 'monitored',
    library_key: '1',
    marked_at: null,
    delete_after: null,
    deleted_at: null,
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
    requested_by: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

describe('ruleScopeMatches', () => {
  describe('media type scoping (existing behaviour)', () => {
    it('matches any type when media_type is all', () => {
      const rule = makeRule({ media_type: 'all' });
      expect(ruleScopeMatches(rule, makeItem({ type: 'movie' }))).toBe(true);
      expect(ruleScopeMatches(rule, makeItem({ type: 'show' }))).toBe(true);
    });

    it('restricts to the configured media type', () => {
      const rule = makeRule({ media_type: 'movie' });
      expect(ruleScopeMatches(rule, makeItem({ type: 'movie' }))).toBe(true);
      expect(ruleScopeMatches(rule, makeItem({ type: 'show' }))).toBe(false);
    });
  });

  describe('library scoping', () => {
    it('matches every library when library_keys is null', () => {
      const rule = makeRule({ library_keys: null });
      expect(ruleScopeMatches(rule, makeItem({ library_key: '1' }))).toBe(true);
      expect(ruleScopeMatches(rule, makeItem({ library_key: '99' }))).toBe(true);
      expect(ruleScopeMatches(rule, makeItem({ library_key: null }))).toBe(true);
    });

    it('matches every library when library_keys is empty', () => {
      const rule = makeRule({ library_keys: [] });
      expect(ruleScopeMatches(rule, makeItem({ library_key: '7' }))).toBe(true);
    });

    it('matches only items in a targeted library', () => {
      const rule = makeRule({ library_keys: ['2', '5'] });
      expect(ruleScopeMatches(rule, makeItem({ library_key: '2' }))).toBe(true);
      expect(ruleScopeMatches(rule, makeItem({ library_key: '5' }))).toBe(true);
      expect(ruleScopeMatches(rule, makeItem({ library_key: '1' }))).toBe(false);
    });

    it('excludes items with no library_key from library-restricted rules', () => {
      const rule = makeRule({ library_keys: ['1'] });
      expect(ruleScopeMatches(rule, makeItem({ library_key: null }))).toBe(false);
      expect(ruleScopeMatches(rule, makeItem({ library_key: undefined }))).toBe(false);
    });
  });

  describe('combined scoping', () => {
    it('requires both media type and library to match', () => {
      const rule = makeRule({ media_type: 'movie', library_keys: ['3'] });
      expect(ruleScopeMatches(rule, makeItem({ type: 'movie', library_key: '3' }))).toBe(true);
      expect(ruleScopeMatches(rule, makeItem({ type: 'show', library_key: '3' }))).toBe(false);
      expect(ruleScopeMatches(rule, makeItem({ type: 'movie', library_key: '4' }))).toBe(false);
    });
  });
});
