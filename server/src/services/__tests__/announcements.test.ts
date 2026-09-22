import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => {
  const state = {
    store: {} as Record<string, string>,
    telemetryConfig: { endpoint: 'https://telemetry.example/v1/ping', enabled: true },
    announcementsConfig: { endpoint: 'https://telemetry.example/v1/announcements' },
    getMock: vi.fn(),
    version: '1.8.0',
  };

  const settingsMock = {
    getValue: (key: string, fallback?: string) => state.store[key] ?? fallback ?? null,
    set: ({ key, value }: { key: string; value: string }) => {
      state.store[key] = value;
      return { key, value };
    },
    delete: (key: string) => {
      const had = key in state.store;
      delete state.store[key];
      return had;
    },
    getBoolean: (key: string, fallback = false) => {
      const raw = state.store[key];
      if (raw === undefined) return fallback;
      return raw.toLowerCase() === 'true' || raw === '1';
    },
  };

  return { state, settingsMock };
});

const { state } = h;

vi.mock('../../db/repositories/settings', () => ({ default: h.settingsMock }));

vi.mock('../../config', () => ({
  default: {
    get telemetry() {
      return h.state.telemetryConfig;
    },
    get announcements() {
      return h.state.announcementsConfig;
    },
  },
}));

vi.mock('../../utils/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('axios', () => ({
  default: { get: (...args: unknown[]) => h.state.getMock(...args), post: vi.fn() },
}));

vi.mock('../../utils/version', () => ({
  getAppVersion: () => h.state.version,
}));

vi.mock('../../changelog', () => ({
  CHANGELOG: [
    { version: '1.8.0', date: '2026-09-22', title: 'Current release', body: 'notes' },
    { version: '1.7.0', date: '2026-09-16', title: 'Older release', body: 'notes' },
  ],
}));

import {
  getAnnouncementsState,
  refreshAnnouncements,
  clearAnnouncementsCache,
  appliesToVersion,
  parseVersion,
  compareVersions,
  ANNOUNCEMENTS_CACHE_KEY,
  ANNOUNCEMENTS_FETCHED_AT_KEY,
  ANNOUNCEMENTS_LAST_ERROR_KEY,
} from '../announcements';

const remote = (overrides: Record<string, unknown> = {}) => ({
  id: 'smart-rules',
  type: 'feature',
  title: 'Smart rules',
  body: 'Rules can now match on anything.',
  publishedAt: '2026-09-21T00:00:00.000Z',
  ...overrides,
});

function feedResponse(announcements: unknown[]) {
  state.getMock.mockResolvedValueOnce({ data: { announcements, updatedAt: '2026-09-21T00:00:00Z' } });
}

beforeEach(() => {
  state.store = {};
  state.telemetryConfig = { endpoint: 'https://telemetry.example/v1/ping', enabled: true };
  state.announcementsConfig = { endpoint: 'https://telemetry.example/v1/announcements' };
  state.version = '1.8.0';
  state.getMock.mockReset();
});

describe('version comparison', () => {
  it('parses and orders semver, with prereleases below their release', () => {
    const a = parseVersion('1.8.0')!;
    const b = parseVersion('v1.10.0')!;
    const pre = parseVersion('1.8.0-beta.1')!;
    expect(compareVersions(a, b)).toBeLessThan(0);
    expect(compareVersions(b, a)).toBeGreaterThan(0);
    expect(compareVersions(pre, a)).toBeLessThan(0);
    expect(parseVersion('beta-abc123')).toBeNull();
  });

  it('applies min and max bounds', () => {
    expect(appliesToVersion({ minVersion: '1.8.0' }, '1.8.0')).toBe(true);
    expect(appliesToVersion({ minVersion: '1.8.1' }, '1.8.0')).toBe(false);
    expect(appliesToVersion({ maxVersion: '1.7.9' }, '1.8.0')).toBe(false);
    expect(appliesToVersion({ minVersion: '1.7.0', maxVersion: '1.9.0' }, '1.8.0')).toBe(true);
  });

  it('shows everything to a build whose version is not semver', () => {
    expect(appliesToVersion({ minVersion: '9.0.0' }, 'beta-abc123')).toBe(true);
  });
});

describe('getAnnouncementsState', () => {
  it('serves the built-in changelog alone when nothing is cached', () => {
    const s = getAnnouncementsState();
    expect(s.version).toBe('1.8.0');
    expect(s.items.map((i) => i.id)).toEqual(['release-1.8.0', 'release-1.7.0']);
    expect(s.items[0]?.source).toBe('changelog');
    expect(s.items[0]?.version).toBe('1.8.0');
    expect(s.remote.enabled).toBe(true);
  });

  it('merges cached remote items newest first, pinned on top', () => {
    state.store[ANNOUNCEMENTS_CACHE_KEY] = JSON.stringify({
      announcements: [
        remote({ id: 'old-note', publishedAt: '2026-01-01T00:00:00.000Z' }),
        remote({ id: 'feedback', type: 'feedback', pinned: true, publishedAt: '2026-05-01T00:00:00.000Z' }),
        remote({ id: 'fresh', publishedAt: '2026-09-23T00:00:00.000Z' }),
      ],
    });

    const ids = getAnnouncementsState().items.map((i) => i.id);
    expect(ids).toEqual(['remote-feedback', 'remote-fresh', 'release-1.8.0', 'release-1.7.0', 'remote-old-note']);
  });

  it('drops remote items outside the version window or past expiry', () => {
    state.store[ANNOUNCEMENTS_CACHE_KEY] = JSON.stringify({
      announcements: [
        remote({ id: 'too-new', minVersion: '2.0.0' }),
        remote({ id: 'expired', expiresAt: '2026-01-01T00:00:00.000Z' }),
        remote({ id: 'fine' }),
      ],
    });

    const ids = getAnnouncementsState(Date.parse('2026-09-22T00:00:00Z')).items.map((i) => i.id);
    expect(ids).toContain('remote-fine');
    expect(ids).not.toContain('remote-too-new');
    expect(ids).not.toContain('remote-expired');
  });

  it('hides remote items entirely once telemetry is off', () => {
    state.store[ANNOUNCEMENTS_CACHE_KEY] = JSON.stringify({ announcements: [remote()] });
    state.store['telemetry_enabled'] = 'false';

    const s = getAnnouncementsState();
    expect(s.remote.enabled).toBe(false);
    expect(s.items.every((i) => i.source === 'changelog')).toBe(true);
  });

  it('reports the env lock', () => {
    state.telemetryConfig = { ...state.telemetryConfig, enabled: false };
    const s = getAnnouncementsState();
    expect(s.remote.enabled).toBe(false);
    expect(s.remote.lockedByEnv).toBe(true);
  });
});

describe('refreshAnnouncements', () => {
  it('fetches with only the version, caches, and clears the last error', async () => {
    state.store[ANNOUNCEMENTS_LAST_ERROR_KEY] = 'earlier failure';
    feedResponse([remote()]);

    const result = await refreshAnnouncements();

    expect(result).toEqual({ fetched: true, count: 1 });
    const [url, options] = state.getMock.mock.calls[0] as [string, { params: unknown }];
    expect(url).toBe('https://telemetry.example/v1/announcements');
    expect(options.params).toEqual({ version: '1.8.0' });
    expect(JSON.parse(state.store[ANNOUNCEMENTS_CACHE_KEY]!).announcements).toHaveLength(1);
    expect(state.store[ANNOUNCEMENTS_FETCHED_AT_KEY]).toBeTruthy();
    expect(state.store[ANNOUNCEMENTS_LAST_ERROR_KEY]).toBeUndefined();
  });

  it('does nothing when telemetry is off', async () => {
    state.store['telemetry_enabled'] = 'false';
    expect(await refreshAnnouncements()).toEqual({ fetched: false, reason: 'disabled' });
    expect(state.getMock).not.toHaveBeenCalled();
  });

  it('does nothing when there is no endpoint', async () => {
    state.announcementsConfig = { endpoint: '' };
    expect(await refreshAnnouncements()).toEqual({ fetched: false, reason: 'disabled' });
  });

  it('skips a fetch inside the interval unless forced', async () => {
    state.store[ANNOUNCEMENTS_FETCHED_AT_KEY] = new Date().toISOString();
    expect(await refreshAnnouncements()).toEqual({ fetched: false, reason: 'not-due' });

    feedResponse([]);
    expect(await refreshAnnouncements(true)).toEqual({ fetched: true, count: 0 });
  });

  it('keeps the cached copy and records the error when the fetch fails', async () => {
    state.store[ANNOUNCEMENTS_CACHE_KEY] = JSON.stringify({ announcements: [remote()] });
    state.getMock.mockRejectedValueOnce(new Error('ECONNREFUSED'));

    expect(await refreshAnnouncements()).toEqual({ fetched: false, reason: 'failed' });
    expect(state.store[ANNOUNCEMENTS_LAST_ERROR_KEY]).toBe('ECONNREFUSED');
    expect(getAnnouncementsState().items.some((i) => i.id === 'remote-smart-rules')).toBe(true);
  });

  it('rejects a feed that does not match the schema', async () => {
    state.getMock.mockResolvedValueOnce({ data: { announcements: [{ id: 'x', type: 'party' }] } });
    expect(await refreshAnnouncements()).toEqual({ fetched: false, reason: 'failed' });
    expect(state.store[ANNOUNCEMENTS_CACHE_KEY]).toBeUndefined();
  });

  it('strips fields the schema does not know about', async () => {
    feedResponse([remote({ trackingPixel: 'https://evil.example/px' })]);
    await refreshAnnouncements();
    const cached = JSON.parse(state.store[ANNOUNCEMENTS_CACHE_KEY]!).announcements[0];
    expect(cached.trackingPixel).toBeUndefined();
  });
});

describe('clearAnnouncementsCache', () => {
  it('forgets everything', () => {
    state.store[ANNOUNCEMENTS_CACHE_KEY] = '{}';
    state.store[ANNOUNCEMENTS_FETCHED_AT_KEY] = 'x';
    state.store[ANNOUNCEMENTS_LAST_ERROR_KEY] = 'y';
    clearAnnouncementsCache();
    expect(state.store).toEqual({});
  });
});
