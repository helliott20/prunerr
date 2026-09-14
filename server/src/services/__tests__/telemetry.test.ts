import { describe, it, expect, vi, beforeEach } from 'vitest';

// In-memory stand-in for the settings table. Hoisted alongside the vi.mock
// factories below, which run before the module-level statements in this file.
const h = vi.hoisted(() => {
  const state = {
    store: {} as Record<string, string>,
    telemetryConfig: { endpoint: 'https://telemetry.example/v1/ping', enabled: true },
    postMock: vi.fn(),
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
const postMock = state.postMock;
const telemetryConfig = state.telemetryConfig;

vi.mock('../../db/repositories/settings', () => ({
  default: h.settingsMock,
}));

vi.mock('../../config', () => ({
  default: {
    get telemetry() {
      return h.state.telemetryConfig;
    },
  },
}));

vi.mock('../../utils/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('axios', () => ({
  default: { post: (...args: unknown[]) => h.state.postMock(...args) },
}));

vi.mock('../../utils/version', () => ({
  getAppVersion: () => '9.9.9',
}));

import {
  getOrCreateInstallId,
  getTelemetryState,
  isTelemetryEnabled,
  markNoticeSeen,
  peekInstallId,
  sendHeartbeat,
  setTelemetryEnabled,
  TELEMETRY_INSTALL_ID_KEY,
  TELEMETRY_LAST_PING_KEY,
} from '../telemetry';

beforeEach(() => {
  state.store = {};
  postMock.mockReset();
  postMock.mockResolvedValue({ status: 204 });
  telemetryConfig.enabled = true;
  telemetryConfig.endpoint = 'https://telemetry.example/v1/ping';
});

describe('isTelemetryEnabled', () => {
  it('defaults to on for a fresh install', () => {
    expect(isTelemetryEnabled()).toBe(true);
  });

  it('honours the stored opt-out', () => {
    state.store['telemetry_enabled'] = 'false';
    expect(isTelemetryEnabled()).toBe(false);
  });

  it('lets TELEMETRY_ENABLED=false override a stored opt-in', () => {
    state.store['telemetry_enabled'] = 'true';
    telemetryConfig.enabled = false;
    expect(isTelemetryEnabled()).toBe(false);
  });

  it('stays off when no endpoint is configured', () => {
    telemetryConfig.endpoint = '';
    expect(isTelemetryEnabled()).toBe(false);
  });
});

describe('getOrCreateInstallId', () => {
  it('generates an ID once and reuses it', () => {
    const first = getOrCreateInstallId();
    expect(first).toMatch(/^[0-9a-f-]{36}$/);
    expect(getOrCreateInstallId()).toBe(first);
  });

  it('does not invent an ID just to report state', () => {
    expect(peekInstallId()).toBeNull();
    expect(getTelemetryState().installId).toBeNull();
    expect(state.store[TELEMETRY_INSTALL_ID_KEY]).toBeUndefined();
  });

  it('gives different installs different IDs', () => {
    const first = getOrCreateInstallId();
    state.store = {};
    expect(getOrCreateInstallId()).not.toBe(first);
  });
});

describe('setTelemetryEnabled', () => {
  it('discards the install ID when switched off', () => {
    getOrCreateInstallId();
    state.store[TELEMETRY_LAST_PING_KEY] = new Date().toISOString();

    const result = setTelemetryEnabled(false);

    expect(result.enabled).toBe(false);
    expect(state.store[TELEMETRY_INSTALL_ID_KEY]).toBeUndefined();
    expect(state.store[TELEMETRY_LAST_PING_KEY]).toBeUndefined();
  });

  it('mints a fresh ID rather than resurrecting the old one', async () => {
    const original = getOrCreateInstallId();
    setTelemetryEnabled(false);
    setTelemetryEnabled(true);

    await sendHeartbeat();

    expect(postMock).toHaveBeenCalledTimes(1);
    expect(postMock.mock.calls[0]?.[1]?.installId).not.toBe(original);
  });
});

describe('sendHeartbeat', () => {
  it('sends exactly the install ID and version, and nothing else', async () => {
    const result = await sendHeartbeat();

    expect(result.sent).toBe(true);
    expect(postMock).toHaveBeenCalledTimes(1);

    const [url, body] = postMock.mock.calls[0] ?? [];
    expect(url).toBe('https://telemetry.example/v1/ping');
    expect(Object.keys(body as object).sort()).toEqual(['installId', 'version']);
    expect((body as { version: string }).version).toBe('9.9.9');
  });

  it('sends nothing when telemetry is off', async () => {
    state.store['telemetry_enabled'] = 'false';

    const result = await sendHeartbeat();

    expect(result).toEqual({ sent: false, reason: 'disabled' });
    expect(postMock).not.toHaveBeenCalled();
  });

  it('does not generate an install ID while disabled', async () => {
    state.store['telemetry_enabled'] = 'false';
    await sendHeartbeat();
    expect(state.store[TELEMETRY_INSTALL_ID_KEY]).toBeUndefined();
  });

  it('skips a second ping inside the interval, so restarts do not spam', async () => {
    await sendHeartbeat();
    const second = await sendHeartbeat();

    expect(second).toEqual({ sent: false, reason: 'not-due' });
    expect(postMock).toHaveBeenCalledTimes(1);
  });

  it('sends again once the interval has passed', async () => {
    await sendHeartbeat();
    state.store[TELEMETRY_LAST_PING_KEY] = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();

    expect((await sendHeartbeat()).sent).toBe(true);
    expect(postMock).toHaveBeenCalledTimes(2);
  });

  it('force bypasses the interval check', async () => {
    await sendHeartbeat();
    expect((await sendHeartbeat(true)).sent).toBe(true);
  });

  it('swallows network failures instead of throwing', async () => {
    postMock.mockRejectedValue(new Error('ENOTFOUND'));

    const result = await sendHeartbeat();

    expect(result).toEqual({ sent: false, reason: 'failed' });
  });

  it('does not record a last-ping time when delivery failed', async () => {
    postMock.mockRejectedValue(new Error('ENOTFOUND'));
    await sendHeartbeat();

    expect(state.store[TELEMETRY_LAST_PING_KEY]).toBeUndefined();

    // ...so the next run genuinely retries.
    postMock.mockResolvedValue({ status: 204 });
    expect((await sendHeartbeat()).sent).toBe(true);
  });

  it('treats an unparseable last-ping timestamp as due', async () => {
    state.store[TELEMETRY_LAST_PING_KEY] = 'not-a-date';
    expect((await sendHeartbeat()).sent).toBe(true);
  });
});

describe('getTelemetryState', () => {
  it('reports the env lock so the UI can explain why the toggle is stuck', () => {
    telemetryConfig.enabled = false;

    const reported = getTelemetryState();

    expect(reported.enabled).toBe(false);
    expect(reported.lockedByEnv).toBe(true);
  });

  it('tracks whether the first-run notice has been acknowledged', () => {
    expect(getTelemetryState().noticeSeen).toBe(false);
    markNoticeSeen();
    expect(getTelemetryState().noticeSeen).toBe(true);
  });
});
