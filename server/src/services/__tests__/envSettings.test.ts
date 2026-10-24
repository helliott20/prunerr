import { describe, it, expect, vi, beforeEach } from 'vitest';

// Regression (issue #93): service URLs and API keys set as environment
// variables were ignored by everything except the library scan. They are now
// the source of truth for the fields they set, on every start.

const store = new Map<string, string>();

vi.mock('../../db/repositories/settings', () => ({
  default: {
    getValue: (key: string) => store.get(key) ?? null,
    set: ({ key, value }: { key: string; value: string }) => {
      store.set(key, value);
      return { key, value };
    },
  },
}));

vi.mock('../../utils/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { applyEnvSettings, getEnvManagedKeys, isEnvManaged } from '../envSettings';

describe('applyEnvSettings', () => {
  beforeEach(() => store.clear());

  it('stores connections given only as environment variables', () => {
    const changed = applyEnvSettings({
      PLEX_URL: 'http://192.168.1.7:32400',
      PLEX_TOKEN: 'plex-token',
      SONARR_URL: 'http://sonarr:8989',
      SONARR_API_KEY: 'sonarr-key',
      OVERSEERR_URL: 'http://seerr:5055',
      OVERSEERR_API_KEY: 'seerr-key',
    });

    expect(changed).toEqual([
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

  it('replaces a stored value with the environment variable', () => {
    store.set('sonarr_url', 'http://saved-in-ui:8989');
    store.set('sonarr_apiKey', 'sonarr-key');

    const changed = applyEnvSettings({
      SONARR_URL: 'http://sonarr:8989',
      SONARR_API_KEY: 'sonarr-key',
    });

    expect(changed).toEqual(['sonarr_url']);
    expect(store.get('sonarr_url')).toBe('http://sonarr:8989');
  });

  it('leaves connections without a variable to the UI', () => {
    store.set('radarr_url', 'http://radarr:7878');

    expect(applyEnvSettings({ RADARR_URL: '  ', RADARR_API_KEY: '' })).toEqual([]);
    expect(store.get('radarr_url')).toBe('http://radarr:7878');
  });
});

describe('getEnvManagedKeys', () => {
  it('lists only the fields with a non-blank variable', () => {
    const env = { SONARR_URL: 'http://sonarr:8989', SONARR_API_KEY: ' ', PLEX_TOKEN: 'tok' };
    expect(getEnvManagedKeys(env)).toEqual(['plex_token', 'sonarr_url']);
    expect(isEnvManaged('sonarr_url', env)).toBe(true);
    expect(isEnvManaged('sonarr_apiKey', env)).toBe(false);
  });
});
