import { describe, it, expect, vi, beforeEach } from 'vitest';

// Regression (issue #93): service URLs and API keys set as environment
// variables were ignored by everything except the library scan. By default
// they fill in settings that were never saved; CONFIG_FROM_ENV=true makes them
// the source of truth on every start.

const store = new Map<string, string>();

vi.mock('../../db/repositories/settings', () => ({
  default: {
    getByKey: (key: string) => (store.has(key) ? { key, value: store.get(key) } : null),
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

const compose = {
  PLEX_URL: 'http://192.168.1.7:32400',
  PLEX_TOKEN: 'plex-token',
  SONARR_URL: 'http://sonarr:8989',
  SONARR_API_KEY: 'sonarr-key',
};

describe('applyEnvSettings', () => {
  beforeEach(() => store.clear());

  it('stores connections given only as environment variables', () => {
    expect(applyEnvSettings(compose)).toEqual(['plex_url', 'plex_token', 'sonarr_url', 'sonarr_apiKey']);
    expect(store.get('plex_token')).toBe('plex-token');
    expect(store.get('sonarr_apiKey')).toBe('sonarr-key');
  });

  it('never overwrites a stored setting by default, even an empty one', () => {
    store.set('sonarr_url', 'http://saved-in-ui:8989');
    store.set('sonarr_apiKey', '');

    expect(applyEnvSettings({ SONARR_URL: 'http://sonarr:8989', SONARR_API_KEY: 'sonarr-key' })).toEqual([]);
    expect(store.get('sonarr_url')).toBe('http://saved-in-ui:8989');
    expect(store.get('sonarr_apiKey')).toBe('');
  });

  it('replaces stored values when CONFIG_FROM_ENV is on', () => {
    store.set('sonarr_url', 'http://saved-in-ui:8989');
    store.set('sonarr_apiKey', 'sonarr-key');

    const changed = applyEnvSettings({ ...compose, CONFIG_FROM_ENV: 'true' });

    expect(changed).toEqual(['plex_url', 'plex_token', 'sonarr_url']);
    expect(store.get('sonarr_url')).toBe('http://sonarr:8989');
  });

  it('leaves connections without a variable to the UI', () => {
    store.set('radarr_url', 'http://radarr:7878');

    expect(applyEnvSettings({ RADARR_URL: '  ', RADARR_API_KEY: '', CONFIG_FROM_ENV: 'true' })).toEqual([]);
    expect(store.get('radarr_url')).toBe('http://radarr:7878');
  });
});

describe('getEnvManagedKeys', () => {
  it('locks nothing unless CONFIG_FROM_ENV is on', () => {
    expect(getEnvManagedKeys(compose)).toEqual([]);
    expect(getEnvManagedKeys({ ...compose, CONFIG_FROM_ENV: 'false' })).toEqual([]);
  });

  it('lists only the fields with a non-blank variable', () => {
    const env = { SONARR_URL: 'http://sonarr:8989', SONARR_API_KEY: ' ', PLEX_TOKEN: 'tok', CONFIG_FROM_ENV: '1' };
    expect(getEnvManagedKeys(env)).toEqual(['plex_token', 'sonarr_url']);
    expect(isEnvManaged('sonarr_url', env)).toBe(true);
    expect(isEnvManaged('sonarr_apiKey', env)).toBe(false);
  });
});
