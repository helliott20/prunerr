import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import fs from 'fs';

// An install that never picked a watch history provider must still read
// history from somewhere. With none, every item reads as never watched, and
// never watched is exactly what the rules delete.

const { tmpDbPath } = vi.hoisted(() => {
  const osMod = require('os');
  const pathMod = require('path');
  return { tmpDbPath: pathMod.join(osMod.tmpdir(), `prunerr-provider-test-${process.pid}-${Date.now()}.db`) };
});

vi.mock('../../config', async (importOriginal) => {
  const actual = (await importOriginal()) as { default: Record<string, unknown> };
  return { default: { ...actual.default, dbPath: tmpDbPath, nodeEnv: 'test' } };
});
vi.mock('../../utils/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { initializeDatabase, closeDatabase, getDatabase } from '../../db/index';
import settingsRepo from '../../db/repositories/settings';
import { ScannerService } from '../scanner';
import { MediaServerHistoryService } from '../mediaServerHistory';
import { TautulliService } from '../tautulli';
import { TracearrService } from '../tracearr';

function provider(): unknown {
  return (new ScannerService() as unknown as { watchHistoryProvider: unknown }).watchHistoryProvider;
}

function set(key: string, value: string) {
  settingsRepo.set({ key, value });
}

describe('scanner: watch history provider', () => {
  beforeAll(() => initializeDatabase());
  afterAll(() => {
    closeDatabase();
    for (const s of ['', '-wal', '-shm']) {
      try { fs.unlinkSync(tmpDbPath + s); } catch { /* ignore */ }
    }
  });

  beforeEach(() => {
    getDatabase().prepare('DELETE FROM settings').run();
    set('media_server_type', 'jellyfin');
    set('jellyfin_url', 'http://jf.local:8096');
    set('jellyfin_apiKey', 'KEY123');
  });

  it('reads the media server itself when none was picked', () => {
    expect(provider()).toBeInstanceOf(MediaServerHistoryService);
  });

  it('still falls back to a configured Tautulli when none was picked', () => {
    set('tautulli_url', 'http://tautulli.local');
    set('tautulli_apiKey', 'T');
    expect(provider()).toBeInstanceOf(TautulliService);
  });

  it('uses a configured Tracearr when none was picked, as the settings page does', () => {
    set('tracearr_url', 'http://tracearr.local');
    set('tracearr_apiKey', 'T');
    expect(provider()).toBeInstanceOf(TracearrService);
  });

  it('keeps an explicit choice', () => {
    set('tautulli_url', 'http://tautulli.local');
    set('tautulli_apiKey', 'T');
    set('watch_history_provider', 'mediaServer');
    expect(provider()).toBeInstanceOf(MediaServerHistoryService);
  });
});
