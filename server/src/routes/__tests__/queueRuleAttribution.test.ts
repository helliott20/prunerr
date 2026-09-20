import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import fs from 'fs';
import express from 'express';
import type { Server } from 'http';

// Real on-disk SQLite so the migrations run; same temp-db + hoisting trick as
// the other route tests.
const { tmpDbPath } = vi.hoisted(() => {
  const osMod = require('os');
  const pathMod = require('path');
  return {
    tmpDbPath: pathMod.join(osMod.tmpdir(), `prunerr-queue-rules-test-${process.pid}-${Date.now()}.db`),
  };
});

vi.mock('../../config', () => ({ default: { dbPath: tmpDbPath, nodeEnv: 'test' } }));
vi.mock('../../utils/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../services/init', () => ({
  getSonarrService: () => null,
  getRadarrService: () => null,
  getOverseerrService: () => null,
  getPlexService: () => null,
}));

vi.mock('../../services/deletion', () => ({
  getDeletionService: () => ({ executeDelete: vi.fn() }),
}));

vi.mock('../../notifications', () => ({
  getNotificationService: () => ({ notify: vi.fn(async () => undefined) }),
}));

import { initializeDatabase, getDatabase, closeDatabase } from '../../db/index';
import { createMediaItem, updateMediaItem } from '../../db/repositories/mediaItems';
import rulesRepo from '../../db/repositories/rules';
import queueRouter from '../queue';

let server: Server;
let baseUrl: string;

async function get(path: string) {
  const res = await fetch(`${baseUrl}${path}`);
  return { status: res.status, json: (await res.json()) as any };
}

/** A movie sitting in the queue, optionally attributed to a rule. */
function queuedItem(title: string, ruleId: number | null) {
  const item = createMediaItem({ type: 'movie', title, file_size: 1_000 } as never);
  updateMediaItem(item.id, {
    status: 'pending_deletion',
    marked_at: new Date().toISOString(),
    delete_after: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
    matched_rule_id: ruleId,
  });
  return item.id;
}

describe('queue rule attribution', () => {
  beforeAll(async () => {
    initializeDatabase();
    const app = express();
    app.use(express.json());
    app.use('/queue', queueRouter);
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

  beforeEach(() => {
    const db = getDatabase();
    db.prepare('DELETE FROM media_items').run();
    db.prepare('DELETE FROM rules').run();
    vi.clearAllMocks();
  });

  it('reports the rule that queued each item on /queue', async () => {
    const rule = rulesRepo.rules.create({
      name: 'Unwatched for 90 days',
      type: 'custom',
      conditions: { version: 2, root: { type: 'group', logic: 'AND', children: [] } },
      action: 'delete',
    } as never);
    queuedItem('Ruled Movie', rule.id);

    const { json } = await get('/queue');
    expect(json.success).toBe(true);
    expect(json.data).toHaveLength(1);
    expect(json.data[0].matchedRule).toBe('Unwatched for 90 days');
    expect(json.data[0].ruleId).toBe(String(rule.id));
  });

  it('reports the same attribution on /queue/upcoming', async () => {
    const rule = rulesRepo.rules.create({
      name: 'Big files',
      type: 'size',
      conditions: { version: 2, root: { type: 'group', logic: 'AND', children: [] } },
      action: 'delete',
    } as never);
    queuedItem('Ruled Movie', rule.id);

    const { json } = await get('/queue/upcoming');
    expect(json.data[0].matchedRule).toBe('Big files');
    expect(json.data[0].ruleId).toBe(String(rule.id));
  });

  it('leaves manually queued items unattributed', async () => {
    queuedItem('Hand Queued', null);

    const { json } = await get('/queue');
    expect(json.data[0].matchedRule).toBeUndefined();
    expect(json.data[0].ruleId).toBeUndefined();
  });

  it('omits the rule id when the rule has since been deleted', async () => {
    const rule = rulesRepo.rules.create({
      name: 'Doomed rule',
      type: 'custom',
      conditions: { version: 2, root: { type: 'group', logic: 'AND', children: [] } },
      action: 'delete',
    } as never);
    queuedItem('Orphaned Movie', rule.id);
    // The media row keeps the stale id; without a name to show, the client
    // would otherwise render a link to a rule that no longer exists.
    getDatabase().prepare('DELETE FROM rules WHERE id = ?').run(rule.id);

    const { json } = await get('/queue');
    expect(json.data[0].matchedRule).toBeUndefined();
    expect(json.data[0].ruleId).toBeUndefined();
  });
});
