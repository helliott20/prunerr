/**
 * Tests for the telemetry Worker, run against a real SQLite database through a
 * small D1 shim. No dependencies — `node:sqlite` ships with Node 22+.
 *
 *   node --test packaging/telemetry/test/
 *
 * The privacy assertions here are the point of the file. "Extra fields are
 * dropped" and "no column exists that could hold them" are the two properties
 * the UI's promise rests on, so they are tested rather than asserted in a
 * comment.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import worker from '../src/worker.js';

const here = dirname(fileURLToPath(import.meta.url));
const SCHEMA = readFileSync(join(here, '..', 'schema.sql'), 'utf8');

const DAY = 86400;
const nowSec = () => Math.floor(Date.now() / 1000);

/** A fresh database plus the D1-shaped binding the Worker expects. */
function harness() {
  const db = new DatabaseSync(':memory:');
  db.exec(SCHEMA);

  const DB = {
    prepare(sql) {
      let params = [];
      const api = {
        bind(...p) {
          params = p;
          return api;
        },
        async first() {
          return db.prepare(sql).get(...params) ?? null;
        },
        async all() {
          return { results: db.prepare(sql).all(...params) };
        },
        async run() {
          return db.prepare(sql).run(...params);
        },
      };
      return api;
    },
  };

  const env = { DB };

  return {
    db,
    env,
    ping: (body, rawBody) =>
      worker.fetch(
        new Request('https://telemetry.test/v1/ping', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: rawBody ?? JSON.stringify(body),
        }),
        env
      ),
    stats: async () => {
      const res = await worker.fetch(new Request('https://telemetry.test/v1/stats'), env);
      return res.json();
    },
    /** Run the cron handler and wait for the work it handed to waitUntil. */
    runScheduled: async () => {
      const pending = [];
      await worker.scheduled({}, env, { waitUntil: (p) => pending.push(p) });
      await Promise.all(pending);
    },
    setLastSeen: (id, secondsAgo) =>
      db
        .prepare('UPDATE installs SET last_seen = ? WHERE install_id = ?')
        .run(nowSec() - secondsAgo, id),
    row: (id) => db.prepare('SELECT * FROM installs WHERE install_id = ?').get(id),
    count: () => db.prepare('SELECT COUNT(*) AS c FROM installs').get().c,
  };
}

test('records a heartbeat', async () => {
  const h = harness();
  const id = randomUUID();

  const res = await h.ping({ installId: id, version: '1.4.10' });

  assert.equal(res.status, 204);
  assert.equal(h.count(), 1);
  assert.equal(h.row(id).version, '1.4.10');
});

test('a returning install updates in place rather than adding a row', async () => {
  const h = harness();
  const id = randomUUID();

  await h.ping({ installId: id, version: '1.4.10' });
  h.setLastSeen(id, 5 * DAY);
  await h.ping({ installId: id, version: '1.4.10' });

  assert.equal(h.count(), 1);
});

test('a repeat ping inside the interval is not written', async () => {
  const h = harness();
  const id = randomUUID();

  await h.ping({ installId: id, version: '1.4.10' });
  h.setLastSeen(id, 60);
  const before = h.row(id).last_seen;

  await h.ping({ installId: id, version: '1.4.10' });

  assert.equal(h.row(id).last_seen, before);
});

test('a version change is written through immediately', async () => {
  const h = harness();
  const id = randomUUID();

  await h.ping({ installId: id, version: '1.4.10' });
  await h.ping({ installId: id, version: '1.5.0' });

  assert.equal(h.row(id).version, '1.5.0');
});

test('extra fields in the payload are dropped, not stored', async () => {
  const h = harness();
  const id = randomUUID();

  await h.ping({
    installId: id,
    version: '1.4.10',
    hostname: 'tower.local',
    plexToken: 'secret',
    libraryPath: '/mnt/user/media',
    libraryCount: 4212,
  });

  const row = h.row(id);
  assert.deepEqual(Object.keys(row), ['install_id', 'version', 'first_seen', 'last_seen']);
  assert.deepEqual(
    { ...row, first_seen: 0, last_seen: 0 },
    { install_id: id, version: '1.4.10', first_seen: 0, last_seen: 0 }
  );
});

test('rejects anything that is not a UUID in the id field', async () => {
  const h = harness();

  for (const bad of ['tower.local', 'harry@example.com', '/mnt/user/media', '', 'null']) {
    const res = await h.ping({ installId: bad, version: '1.4.10' });
    assert.equal(res.status, 400, `expected 400 for ${JSON.stringify(bad)}`);
  }

  assert.equal(h.count(), 0);
});

test('rejects malformed payloads', async () => {
  const h = harness();
  const id = randomUUID();

  assert.equal((await h.ping({ version: '1.4.10' })).status, 400);
  assert.equal((await h.ping({ installId: id })).status, 400);
  assert.equal((await h.ping({ installId: id, version: 'x'.repeat(40) })).status, 400);
  assert.equal((await h.ping(null, '{not json')).status, 400);
  assert.equal((await h.ping([1, 2, 3])).status, 400);
  assert.equal(h.count(), 0);
});

test('rejects an oversized body', async () => {
  const h = harness();

  const res = await h.ping(
    null,
    JSON.stringify({ installId: randomUUID(), version: '1.4.10', pad: 'x'.repeat(600) })
  );

  assert.equal(res.status, 413);
  assert.equal(h.count(), 0);
});

test('stats counts only installs seen inside the window', async () => {
  const h = harness();
  const live = randomUUID();
  const silent = randomUUID();

  await h.ping({ installId: live, version: '1.4.10' });
  await h.ping({ installId: silent, version: '1.4.9' });
  assert.equal((await h.stats()).activeInstalls, 2);

  h.setLastSeen(silent, 45 * DAY);

  const stats = await h.stats();
  assert.equal(stats.activeInstalls, 1);
  assert.equal(stats.windowDays, 30);
  assert.deepEqual(stats.versions, [{ version: '1.4.10', count: 1 }]);
});

test('scheduled maintenance records the day and prunes stale installs', async () => {
  const h = harness();
  const live = randomUUID();
  const ancient = randomUUID();

  await h.ping({ installId: live, version: '1.4.10' });
  await h.ping({ installId: ancient, version: '1.0.0' });
  h.setLastSeen(ancient, 120 * DAY);

  await h.runScheduled();

  assert.equal(h.row(ancient), undefined, 'install past retention should be deleted');
  assert.ok(h.row(live), 'a live install should survive the prune');

  const rollup = h.db.prepare('SELECT * FROM daily_counts').all();
  assert.equal(rollup.length, 1);
  assert.equal(rollup[0].active_installs, 1);
});

test('routing', async () => {
  const h = harness();

  assert.equal((await worker.fetch(new Request('https://telemetry.test/'), h.env)).status, 200);
  assert.equal((await worker.fetch(new Request('https://telemetry.test/nope'), h.env)).status, 404);
  assert.equal(
    (await worker.fetch(new Request('https://telemetry.test/v1/ping'), h.env)).status,
    404,
    'GET on the ping route is not a heartbeat'
  );
  assert.equal(
    (
      await worker.fetch(
        new Request('https://telemetry.test/v1/ping', { method: 'OPTIONS' }),
        h.env
      )
    ).status,
    204
  );
});
