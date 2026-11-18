import { describe, it, expect, vi } from 'vitest';

vi.mock('../../utils/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { isValidAdditionalId, parseAdditionalInstances, removedInstanceIds } from '../arrInstances';
import { instanceIdForItem, arrTypeForItem } from '../arrInstanceIds';
import { resolveArrLink, withoutStaleLink } from '../arrLink';
import { evaluateArrInstance } from '../../rules/conditions';
import type { MediaItem } from '../../types';

const movie = (over: Partial<MediaItem> = {}) =>
  ({ id: 1, title: 'Inception', type: 'movie', sonarr_id: null, radarr_id: 1, tmdb_id: 27205, imdb_id: null, tvdb_id: null, ...over }) as MediaItem;
const show = (over: Partial<MediaItem> = {}) =>
  ({ id: 2, title: 'Cowboy Bebop', type: 'show', sonarr_id: 1, radarr_id: null, tmdb_id: null, imdb_id: null, tvdb_id: 76885, ...over }) as MediaItem;

describe('additional instance settings', () => {
  it('keeps valid entries and drops bad ids, wrong-app ids and duplicates', () => {
    const parsed = parseAdditionalInstances(
      JSON.stringify([
        { id: 'radarr-4k', name: ' Radarr 4K ', url: ' http://r4k:7878 ', apiKey: 'k1' },
        { id: 'radarr-4k', name: 'dupe', url: 'x', apiKey: 'y' },
        { id: 'sonarr-anime', name: 'wrong app', url: 'x', apiKey: 'y' },
        { id: 'radarr', name: 'primary id', url: 'x', apiKey: 'y' },
        { id: 'bad id!', name: 'x', url: 'x', apiKey: 'y' },
        { id: 'radarr-old', name: 'Old', url: 'http://old', apiKey: 'k2', enabled: false },
        'nonsense',
      ]),
      'radarr'
    );
    expect(parsed).toEqual([
      { id: 'radarr-4k', name: 'Radarr 4K', url: 'http://r4k:7878', apiKey: 'k1' },
      { id: 'radarr-old', name: 'Old', url: 'http://old', apiKey: 'k2', enabled: false },
    ]);
  });

  it('treats unreadable or empty settings as no instances', () => {
    expect(parseAdditionalInstances('not json', 'sonarr')).toEqual([]);
    expect(parseAdditionalInstances('', 'sonarr')).toEqual([]);
    expect(parseAdditionalInstances(null, 'sonarr')).toEqual([]);
  });

  it('only accepts <type>-<suffix> ids', () => {
    expect(isValidAdditionalId('sonarr', 'sonarr-anime')).toBe(true);
    expect(isValidAdditionalId('sonarr', 'sonarr')).toBe(false);
    expect(isValidAdditionalId('sonarr', 'radarr-x')).toBe(false);
    expect(isValidAdditionalId('sonarr', 'sonarr-')).toBe(false);
  });

  it('reports which instances were removed', () => {
    const a = { id: 'radarr-a', name: '', url: '', apiKey: '' };
    const b = { id: 'radarr-b', name: '', url: '', apiKey: '' };
    expect(removedInstanceIds([a, b], [b])).toEqual(['radarr-a']);
  });
});

describe('which instance an item belongs to', () => {
  it('is the primary when linked without an instance (every item before multiple instances)', () => {
    expect(instanceIdForItem(movie())).toBe('radarr');
    expect(instanceIdForItem(show())).toBe('sonarr');
  });

  it('is the recorded instance when there is one', () => {
    expect(instanceIdForItem(movie({ arr_instance: 'radarr-4k' }))).toBe('radarr-4k');
  });

  it('is none for an unlinked item', () => {
    expect(instanceIdForItem(movie({ radarr_id: null, arr_instance: 'radarr-4k' }))).toBeNull();
    expect(instanceIdForItem(show({ sonarr_id: null }))).toBeNull();
  });

  it('follows the item type: movies are Radarr, everything else Sonarr', () => {
    expect(arrTypeForItem({ type: 'movie' })).toBe('radarr');
    expect(arrTypeForItem({ type: 'episode' })).toBe('sonarr');
  });
});

describe('the Sonarr/Radarr instance rule condition', () => {
  const inHd = movie({ radarr_id: 3 });
  const in4k = movie({ radarr_id: 3, arr_instance: 'radarr-4k' });

  it('matches the named instance', () => {
    expect(evaluateArrInstance(in4k, 'equals', 'radarr-4k')).toBe(true);
    expect(evaluateArrInstance(inHd, 'equals', 'radarr-4k')).toBe(false);
    expect(evaluateArrInstance(inHd, 'equals', 'radarr')).toBe(true);
  });

  it('"not in" only covers the same app, not every show', () => {
    expect(evaluateArrInstance(inHd, 'not_equals', 'radarr-4k')).toBe(true);
    expect(evaluateArrInstance(in4k, 'not_equals', 'radarr-4k')).toBe(false);
    expect(evaluateArrInstance(show(), 'not_equals', 'radarr-4k')).toBe(false);
  });

  it('never matches unlinked items or an empty value', () => {
    expect(evaluateArrInstance(movie({ radarr_id: null }), 'not_equals', 'radarr-4k')).toBe(false);
    expect(evaluateArrInstance(inHd, 'not_equals', '')).toBe(false);
    expect(evaluateArrInstance(inHd, 'equals', '')).toBe(false);
  });
});

describe('linking at delete time across instances', () => {
  const none = async () => null;

  it('asks each instance in order and records the one that has it', async () => {
    const link = await resolveArrLink(movie({ radarr_id: null }), {
      radarr: [
        { instanceId: 'radarr', getMovieByTmdbId: none, getMovieByImdbId: none },
        { instanceId: 'radarr-4k', getMovieByTmdbId: async () => ({ id: 9 }), getMovieByImdbId: none },
      ],
    });
    expect(link).toEqual({ radarr_id: 9, arr_instance: 'radarr-4k' });
  });

  it('keeps asking when one instance fails', async () => {
    const link = await resolveArrLink(show({ sonarr_id: null }), {
      sonarr: [
        {
          instanceId: 'sonarr',
          getSeriesByTvdbId: async () => {
            throw new Error('down');
          },
          getSeriesByImdbId: none,
        },
        { instanceId: 'sonarr-anime', getSeriesByTvdbId: async () => ({ id: 4 }), getSeriesByImdbId: none },
      ],
    });
    expect(link).toEqual({ sonarr_id: 4, arr_instance: 'sonarr-anime' });
  });

  it('still takes a single client, recording no instance', async () => {
    const link = await resolveArrLink(movie({ radarr_id: null }), {
      radarr: { getMovieByTmdbId: async () => ({ id: 5 }), getMovieByImdbId: none },
    });
    expect(link).toEqual({ radarr_id: 5 });
  });

  it('drops a link to a removed instance, but not to a known (even disabled) one', () => {
    const linked = movie({ arr_instance: 'radarr-gone' });
    expect(withoutStaleLink(linked, new Set(['radarr', 'radarr-4k']), 'radarr-gone')).toMatchObject({
      radarr_id: null,
      arr_instance: null,
    });
    const known = movie({ arr_instance: 'radarr-4k' });
    expect(withoutStaleLink(known, new Set(['radarr', 'radarr-4k']), 'radarr-4k')).toBe(known);
  });
});
