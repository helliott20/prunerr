import { describe, it, expect } from 'vitest';

import {
  activityTargetPath,
  collectionPath,
  libraryItemPath,
  rulePath,
  serviceHomeUrl,
} from '../links';
import type { Settings } from '@/types';

describe('libraryItemPath', () => {
  it('builds a detail path from a numeric or string id', () => {
    expect(libraryItemPath(42)).toBe('/library/42');
    expect(libraryItemPath('42')).toBe('/library/42');
  });

  it('returns null when there is no id to link to', () => {
    expect(libraryItemPath(null)).toBeNull();
    expect(libraryItemPath(undefined)).toBeNull();
    expect(libraryItemPath('')).toBeNull();
  });

  it('treats id 0 as a real id rather than a missing one', () => {
    expect(libraryItemPath(0)).toBe('/library/0');
  });
});

describe('collectionPath', () => {
  it('builds a collection path', () => {
    expect(collectionPath(7)).toBe('/collections/7');
  });

  it('returns null without an id', () => {
    expect(collectionPath(null)).toBeNull();
  });
});

describe('rulePath', () => {
  it('deep links to a rule on the rules page', () => {
    expect(rulePath(3)).toBe('/rules?rule=3');
  });

  it('escapes ids so they survive the query string', () => {
    expect(rulePath('a b&c')).toBe('/rules?rule=a%20b%26c');
  });

  it('returns null without an id', () => {
    expect(rulePath(undefined)).toBeNull();
  });
});

describe('activityTargetPath', () => {
  it('links media items and collections to their detail pages', () => {
    expect(activityTargetPath('media_item', 5)).toBe('/library/5');
    expect(activityTargetPath('collection', 5)).toBe('/collections/5');
  });

  it('does not link target types that have no detail page', () => {
    // A scan entry's targetId is a scan run — linking it to /library would
    // open an unrelated (or missing) media item.
    expect(activityTargetPath('scan', 5)).toBeNull();
    expect(activityTargetPath('something_new', 5)).toBeNull();
    expect(activityTargetPath(null, 5)).toBeNull();
  });

  it('returns null when the entry has no target', () => {
    expect(activityTargetPath('media_item', null)).toBeNull();
  });
});

describe('serviceHomeUrl', () => {
  const settings = (services: Settings['services']): Settings => ({ services });

  it('links Plex to its web app rather than the API root', () => {
    expect(serviceHomeUrl(settings({ plex: { url: 'http://nas:32400' } }), 'plex')).toBe(
      'http://nas:32400/web'
    );
  });

  it('falls back to the Jellyfin connection for the media server row', () => {
    // Health always reports the media server as `plex`, whichever backend runs.
    expect(serviceHomeUrl(settings({ jellyfin: { url: 'http://nas:8096/' } }), 'plex')).toBe(
      'http://nas:8096'
    );
  });

  it('uses the configured base URL for the other services', () => {
    const s = settings({
      sonarr: { url: 'http://nas:8989/' },
      overseerr: { url: 'http://nas:5055' },
    });
    expect(serviceHomeUrl(s, 'sonarr')).toBe('http://nas:8989');
    expect(serviceHomeUrl(s, 'overseerr')).toBe('http://nas:5055');
  });

  it('returns null for services with nothing configured', () => {
    expect(serviceHomeUrl(settings({}), 'radarr')).toBeNull();
    expect(serviceHomeUrl(settings({ radarr: { apiKey: 'k' } }), 'radarr')).toBeNull();
    expect(serviceHomeUrl(null, 'radarr')).toBeNull();
    expect(serviceHomeUrl(settings({}), 'not-a-service')).toBeNull();
  });
});
