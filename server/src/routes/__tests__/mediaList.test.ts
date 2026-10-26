import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import fs from 'fs';
import express from 'express';
import type { Server } from 'http';

// GET /api/media validates its query string. Express 5 made req.query a
// getter, so storing the parsed query by assignment threw on every request.

const { tmpDbPath } = vi.hoisted(() => {
  const osMod = require('os');
  const pathMod = require('path');
  return {
    tmpDbPath: pathMod.join(osMod.tmpdir(), `prunerr-media-list-test-${process.pid}-${Date.now()}.db`),
  };
});

vi.mock('../../config', () => ({
  default: { dbPath: tmpDbPath, nodeEnv: 'test' },
}));

vi.mock('../../utils/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { initializeDatabase, closeDatabase } from '../../db/index';
import { createMediaItem } from '../../db/repositories/mediaItems';
import mediaRouter from '../media';

let server: Server;
let baseUrl: string;

describe('GET /api/media', () => {
  beforeAll(async () => {
    initializeDatabase();
    createMediaItem({ type: 'movie', title: 'Arrival', plex_id: 'rk-1' } as never);
    createMediaItem({ type: 'show', title: 'Severance', plex_id: 'rk-2' } as never);

    const app = express();
    app.use(express.json());
    app.use(mediaRouter);
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

  it('lists items with the parsed filters applied', async () => {
    const res = await fetch(`${baseUrl}/?type=show&limit=10`);
    const json = (await res.json()) as { success: boolean; data: Array<{ title: string }> };

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data.map((i) => i.title)).toEqual(['Severance']);
  });

  it('still rejects an invalid query', async () => {
    const res = await fetch(`${baseUrl}/?limit=-5`);
    expect(res.status).toBe(400);
  });
});
