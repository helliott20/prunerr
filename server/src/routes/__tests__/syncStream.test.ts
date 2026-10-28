import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import fs from 'fs';
import express from 'express';
import type { Server } from 'http';

// The sync coordinator sends a final 'complete' after the scanner's own. A
// stream that had already ended on the first one wrote again, and the
// resulting 'error' event on the response crashed the server (issue #101).

const { tmpDbPath } = vi.hoisted(() => {
  const osMod = require('os');
  const pathMod = require('path');
  return {
    tmpDbPath: pathMod.join(osMod.tmpdir(), `prunerr-sync-stream-test-${process.pid}-${Date.now()}.db`),
  };
});

vi.mock('../../config', () => ({ default: { dbPath: tmpDbPath, nodeEnv: 'test' } }));
vi.mock('../../utils/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// A coordinator that broadcasts the way the real one does, but whose run only
// finishes when the test says so.
const sync = vi.hoisted(() => {
  const listeners = new Set<(data: unknown) => void>();
  let inProgress = false;
  let finish: () => void = () => {};
  return {
    listeners,
    start() {
      inProgress = true;
      return new Promise<void>((resolve) => { finish = resolve; });
    },
    finish: () => finish(),
    isInProgress: () => inProgress,
    stop() {
      inProgress = false;
    },
  };
});

vi.mock('../../services/syncCoordinator', () => ({
  isSyncInProgress: () => sync.isInProgress(),
  getSyncProgressLog: () => [{ stage: 'scanning', message: 'Scanning' }],
  subscribeToSync: (listener: (data: unknown) => void) => {
    sync.listeners.add(listener);
    return () => sync.listeners.delete(listener);
  },
  runLibrarySync: async () => {
    await sync.start();
    for (const l of sync.listeners) l({ stage: 'complete', message: 'Sync complete', result: { success: true } });
    sync.stop();
    for (const l of sync.listeners) {
      try { l({ stage: 'complete', message: 'Sync stream ended' }); } catch { /* ignore */ }
    }
    sync.listeners.clear();
    return { status: 'completed', result: { itemsScanned: 1, itemsAdded: 0, itemsUpdated: 0, errors: [] } };
  },
}));

import { initializeDatabase, closeDatabase } from '../../db/index';
import libraryRouter from '../library';

let server: Server;
let baseUrl: string;

async function waitFor(check: () => boolean) {
  for (let i = 0; i < 100 && !check(); i++) await new Promise((r) => setTimeout(r, 10));
}

describe('library sync streams', () => {
  beforeAll(async () => {
    initializeDatabase();
    const app = express();
    app.use(express.json());
    app.use(libraryRouter);
    await new Promise<void>((resolve) => {
      server = app.listen(0, () => {
        const addr = server.address();
        baseUrl = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
        resolve();
      });
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    closeDatabase();
    for (const suffix of ['', '-wal', '-shm']) {
      try { fs.unlinkSync(tmpDbPath + suffix); } catch { /* ignore */ }
    }
  });

  it('ends a reconnected stream once, without writing after the end', async () => {
    const started = fetch(`${baseUrl}/sync/stream`, { method: 'POST' });
    await waitFor(() => sync.isInProgress());

    const watcher = await fetch(`${baseUrl}/sync/stream`);
    await waitFor(() => sync.listeners.size === 2);
    sync.finish();

    const [watched, owner] = await Promise.all([watcher.text(), (await started).text()]);

    // Replay, then the scanner's complete; the coordinator's sentinel is not
    // written to a stream that has already ended.
    expect(watched.match(/"stage":"complete"/g)).toHaveLength(1);
    expect(watched).toContain('"stage":"scanning"');
    expect(owner.match(/"stage":"complete"/g)).toHaveLength(1);
    expect(sync.listeners.size).toBe(0);
  });

  it('drops a client that goes away and lets the sync carry on', async () => {
    const controller = new AbortController();
    const started = fetch(`${baseUrl}/sync/stream`, { method: 'POST' });
    await waitFor(() => sync.isInProgress());

    const watcher = await fetch(`${baseUrl}/sync/stream`, { signal: controller.signal });
    await waitFor(() => sync.listeners.size === 2);
    controller.abort();
    await watcher.text().catch(() => undefined);
    await waitFor(() => sync.listeners.size === 1);
    expect(sync.listeners.size).toBe(1);

    sync.finish();
    expect(await (await started).text()).toContain('Sync complete');
  });
});
