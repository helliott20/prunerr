import { describe, it, expect, vi, beforeEach } from 'vitest';

// Regression (issue #93): service URLs and API keys set as environment
// variables were ignored by everything except the library scan, so a
// compose-only install opened to empty Settings and no connections.

const store = new Map<string, string>();

vi.mock('../../db/repositories/settings', () => ({
  default: {
    getByKey: (key: string) => (store.has(key) ? { key, value: store.get(key) } : null),
    set: ({ key, value }: { key: string; value: string }) => {
      store.set(key, value);
      return { key, value };
    },
  },
}));

vi.mock('../../utils/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { seedSettingsFromEnv } from '../envSettings';

describe('seedSettingsFromEnv', () => {
  beforeEach(() => store.clear());

  it('stores connections given only as environment variables', () => {
    const seeded = seedSettingsFromEnv({
      PLEX_URL: 'http://192.168.1.7:32400',
      PLEX_TOKEN: 'plex-token',
      SONARR_URL: 'http://sonarr:8989',
      SONARR_API_KEY: 'sonarr-key',
      OVERSEERR_URL: 'http://seerr:5055',
      OVERSEERR_API_KEY: 'seerr-key',
    });

    expect(seeded).toEqual([
      'plex_url',
      'plex_token',
      'sonarr_url',
      'sonarr_apiKey',
      'overseerr_url',
      'overseerr_apiKey',
    ]);
    expect(store.get('plex_token')).toBe('plex-token');
    expect(store.get('sonarr_apiKey')).toBe('sonarr-key');
  });

  it('never overwrites a stored setting, even an empty one', () => {
    store.set('sonarr_url', 'http://saved-in-ui:8989');
    store.set('sonarr_apiKey', '');

    const seeded = seedSettingsFromEnv({
      SONARR_URL: 'http://sonarr:8989',
      SONARR_API_KEY: 'sonarr-key',
    });

    expect(seeded).toEqual([]);
    expect(store.get('sonarr_url')).toBe('http://saved-in-ui:8989');
    expect(store.get('sonarr_apiKey')).toBe('');
  });

  it('ignores blank variables', () => {
    expect(seedSettingsFromEnv({ RADARR_URL: '  ', RADARR_API_KEY: '' })).toEqual([]);
    expect(store.size).toBe(0);
  });
});
