import { describe, it, expect, vi, beforeEach } from 'vitest';

const settings = new Map<string, string>();

vi.mock('../../db/repositories/settings', () => ({
  default: {
    getValue: (key: string) => settings.get(key) ?? null,
  },
}));

// Mutable so tests can model an install configured purely by environment
// variable, which is how Jellyfin and Emby were first configurable.
const mockConfig = {
  mediaServer: { type: 'plex' },
  plex: { url: '', token: '' },
  jellyfin: { url: '', apiKey: '' },
};

vi.mock('../../config', () => ({
  get default() {
    return mockConfig;
  },
}));

vi.mock('../../utils/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('axios', () => ({
  default: {
    create: () => ({
      get: vi.fn(),
      post: vi.fn(),
      interceptors: { response: { use: vi.fn() } },
      request: vi.fn(),
    }),
  },
}));

import {
  createMediaServer,
  createConfiguredMediaServer,
  createMediaServerUsers,
  getConfiguredServerType,
  getMediaServerCredentials,
} from '../mediaServer';
import { PlexService } from '../plex';
import { JellyfinService } from '../jellyfin';
import { PlexUsersService } from '../plexUsers';

beforeEach(() => {
  settings.clear();
  mockConfig.mediaServer.type = 'plex';
});

describe('getConfiguredServerType', () => {
  it('defaults to plex so existing installs are unaffected', () => {
    expect(getConfiguredServerType()).toBe('plex');
  });

  it('honours a stored type', () => {
    settings.set('media_server_type', 'jellyfin');
    expect(getConfiguredServerType()).toBe('jellyfin');
    settings.set('media_server_type', 'emby');
    expect(getConfiguredServerType()).toBe('emby');
  });

  it('falls back to plex on an unrecognised value rather than throwing', () => {
    settings.set('media_server_type', 'kodi');
    expect(getConfiguredServerType()).toBe('plex');
  });

  it('honours MEDIA_SERVER_TYPE when nothing has been stored', () => {
    // Jellyfin and Emby were configurable by environment variable before the
    // Settings picker existed, and .env.example still documents that route.
    mockConfig.mediaServer.type = 'jellyfin';
    expect(getConfiguredServerType()).toBe('jellyfin');
  });

  it('lets a stored choice win over the environment variable', () => {
    mockConfig.mediaServer.type = 'jellyfin';
    settings.set('media_server_type', 'emby');
    expect(getConfiguredServerType()).toBe('emby');
  });
});

describe('createMediaServer', () => {
  it('builds the right client per type', () => {
    expect(createMediaServer('plex', 'http://p', 't')).toBeInstanceOf(PlexService);
    expect(createMediaServer('jellyfin', 'http://j', 'k')).toBeInstanceOf(JellyfinService);
    expect(createMediaServer('emby', 'http://e', 'k')).toBeInstanceOf(JellyfinService);
  });

  it('tags each client with its own backend type', () => {
    expect(createMediaServer('plex', 'http://p', 't').serverType).toBe('plex');
    expect(createMediaServer('jellyfin', 'http://j', 'k').serverType).toBe('jellyfin');
    expect(createMediaServer('emby', 'http://e', 'k').serverType).toBe('emby');
  });
});

describe('getMediaServerCredentials', () => {
  it('reads the plex namespace when plex is selected', () => {
    settings.set('plex_url', 'http://plex:32400');
    settings.set('plex_token', 'tok');
    expect(getMediaServerCredentials()).toEqual({
      type: 'plex',
      url: 'http://plex:32400',
      credential: 'tok',
    });
  });

  it('reads the shared jellyfin namespace for both jellyfin and emby', () => {
    settings.set('jellyfin_url', 'http://jf:8096');
    settings.set('jellyfin_apiKey', 'key');

    settings.set('media_server_type', 'jellyfin');
    expect(getMediaServerCredentials()).toMatchObject({ type: 'jellyfin', credential: 'key' });

    settings.set('media_server_type', 'emby');
    expect(getMediaServerCredentials()).toMatchObject({ type: 'emby', credential: 'key' });
  });

  it('does not fall back to plex credentials when jellyfin is selected', () => {
    settings.set('media_server_type', 'jellyfin');
    settings.set('plex_url', 'http://plex:32400');
    settings.set('plex_token', 'tok');
    expect(getMediaServerCredentials()).toBeNull();
  });

  it('returns null when only half the credentials are present', () => {
    settings.set('plex_url', 'http://plex:32400');
    expect(getMediaServerCredentials()).toBeNull();
  });
});

describe('createConfiguredMediaServer', () => {
  it('returns null when nothing is configured', () => {
    expect(createConfiguredMediaServer()).toBeNull();
  });

  it('builds the configured backend', () => {
    settings.set('media_server_type', 'jellyfin');
    settings.set('jellyfin_url', 'http://jf:8096');
    settings.set('jellyfin_apiKey', 'key');
    expect(createConfiguredMediaServer()).toBeInstanceOf(JellyfinService);
  });
});

describe('createMediaServerUsers', () => {
  it('gives Plex its own users client, since accounts live on plex.tv', () => {
    const server = createMediaServer('plex', 'http://p', 't');
    expect(createMediaServerUsers(server, 'http://p', 't')).toBeInstanceOf(PlexUsersService);
  });

  it('reuses the Jellyfin client, which serves /Users itself', () => {
    const server = createMediaServer('jellyfin', 'http://j', 'k');
    expect(createMediaServerUsers(server, 'http://j', 'k')).toBe(server);
  });
});
