/**
 * Tests for the announcements feed, run against an in-memory KV shim.
 *
 *   node --test packaging/telemetry/test/
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import worker from '../src/worker.js';
import { validateFeed } from '../src/announcements.js';

const TOKEN = 'a-test-token-of-reasonable-length';

/** The subset of the KV binding the handlers use. */
function kvShim() {
  const store = new Map();
  return {
    store,
    async get(key, type) {
      const hit = store.get(key);
      if (!hit) return null;
      return type === 'json' ? JSON.parse(hit.value) : hit.value;
    },
    async getWithMetadata(key) {
      const hit = store.get(key);
      if (!hit) return { value: null, metadata: null };
      return { value: hit.value, metadata: hit.metadata ?? null };
    },
    async put(key, value, opts = {}) {
      store.set(key, { value, metadata: opts.metadata });
    },
    async delete(key) {
      store.delete(key);
    },
    async list({ prefix = '' } = {}) {
      const keys = [...store.entries()]
        .filter(([k]) => k.startsWith(prefix))
        .map(([name, v]) => ({ name, metadata: v.metadata ?? null }));
      return { keys, list_complete: true };
    },
  };
}

function harness({ withToken = true, withKv = true } = {}) {
  const env = {};
  if (withKv) env.ANNOUNCEMENTS = kvShim();
  if (withToken) env.ADMIN_TOKEN = TOKEN;

  const call = (path, init = {}) =>
    worker.fetch(new Request(`https://telemetry.test${path}`, init), env);

  return {
    env,
    get: () => call('/v1/announcements'),
    put: (body, token = TOKEN) =>
      call('/v1/announcements', {
        method: 'PUT',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: typeof body === 'string' ? body : JSON.stringify(body),
      }),
    putImage: (name, bytes, token = TOKEN) =>
      call(`/v1/images/${name}`, {
        method: 'PUT',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: bytes,
      }),
    getImage: (name) => call(`/v1/images/${name}`),
    deleteImage: (name) =>
      call(`/v1/images/${name}`, { method: 'DELETE', headers: { Authorization: `Bearer ${TOKEN}` } }),
  };
}

const entry = (overrides = {}) => ({
  id: 'smart-rules',
  type: 'feature',
  title: 'Smart rules',
  body: 'Rules can now match on anything.',
  publishedAt: '2026-09-01T00:00:00Z',
  ...overrides,
});

test('an empty namespace serves an empty feed', async () => {
  const h = harness();
  const res = await h.get();
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { announcements: [], updatedAt: null });
});

test('a publish round-trips and is served newest first', async () => {
  const h = harness();
  const res = await h.put({
    announcements: [
      entry({ id: 'older', publishedAt: '2026-08-01T00:00:00Z' }),
      entry({ id: 'newer', publishedAt: '2026-09-01T00:00:00Z' }),
    ],
  });
  assert.equal(res.status, 200);

  const feed = await (await h.get()).json();
  assert.deepEqual(
    feed.announcements.map((a) => a.id),
    ['newer', 'older']
  );
  assert.ok(feed.updatedAt);
});

test('publishing without the token is refused', async () => {
  const h = harness();
  assert.equal((await h.put({ announcements: [entry()] }, null)).status, 401);
  assert.equal((await h.put({ announcements: [entry()] }, 'wrong-token-of-similar-len')).status, 401);
});

test('a Worker with no ADMIN_TOKEN secret refuses every write', async () => {
  const h = harness({ withToken: false });
  assert.equal((await h.put({ announcements: [entry()] })).status, 401);
});

test('a broken entry is rejected with a pointer to the field', async () => {
  const h = harness();
  const res = await h.put({ announcements: [entry({ type: 'party' })] });
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.match(body.error, /announcements\[0\]\.type/);
});

test('unknown fields are dropped, not stored', async () => {
  const h = harness();
  await h.put({ announcements: [entry({ trackingPixel: 'https://evil.example/px' })] });
  const feed = await (await h.get()).json();
  assert.equal(feed.announcements[0].trackingPixel, undefined);
});

test('duplicate ids are rejected', () => {
  const result = validateFeed({ announcements: [entry(), entry()] });
  assert.match(result.error, /duplicated/);
});

test('version bounds must be semver', () => {
  assert.match(validateFeed({ announcements: [entry({ minVersion: 'v1' })] }).error, /minVersion/);
  assert.ok(validateFeed({ announcements: [entry({ minVersion: '1.5.0', maxVersion: '1.6.0' })] }).feed);
});

test('images upload, serve with their content type, and delete', async () => {
  const h = harness();
  const png = new Uint8Array([137, 80, 78, 71]);

  const up = await h.putImage('hero.png', png);
  assert.equal(up.status, 200);
  const meta = await up.json();
  assert.equal(meta.url, 'https://telemetry.test/v1/images/hero.png');

  const got = await h.getImage('hero.png');
  assert.equal(got.status, 200);
  assert.equal(got.headers.get('content-type'), 'image/png');
  assert.deepEqual(new Uint8Array(await got.arrayBuffer()), png);

  assert.equal((await h.deleteImage('hero.png')).status, 204);
  assert.equal((await h.getImage('hero.png')).status, 404);
});

test('the image list is admin-only and names what is stored', async () => {
  const h = harness();
  await h.putImage('a.png', new Uint8Array([1]));
  await h.putImage('b.webp', new Uint8Array([1]));
  const anon = await worker.fetch(new Request('https://telemetry.test/v1/images'), h.env);
  assert.equal(anon.status, 401);
  const res = await worker.fetch(new Request('https://telemetry.test/v1/images', { headers: { Authorization: `Bearer ${TOKEN}` } }), h.env);
  assert.equal(res.status, 200);
  const { images } = await res.json();
  assert.deepEqual(images.map((i) => [i.name, i.contentType]), [['a.png', 'image/png'], ['b.webp', 'image/webp']]);
  assert.equal(images[0].url, 'https://telemetry.test/v1/images/a.png');
});

test('image names are constrained to safe file names', async () => {
  const h = harness();
  assert.equal((await h.putImage('..%2Fetc%2Fpasswd', new Uint8Array([1]))).status, 404);
  assert.equal((await h.putImage('notes.txt', new Uint8Array([1]))).status, 404);
  assert.equal((await h.getImage('missing.png')).status, 404);
});

test('image upload needs the token', async () => {
  const h = harness();
  assert.equal((await h.putImage('hero.png', new Uint8Array([1]), null)).status, 401);
});

test('a Worker with no KV binding still answers reads', async () => {
  const h = harness({ withKv: false });
  const res = await h.get();
  assert.equal(res.status, 200);
  assert.deepEqual((await res.json()).announcements, []);
  assert.equal((await h.put({ announcements: [] })).status, 503);
});

test('the admin page is served with a strict CSP and no caching', async () => {
  const h = harness();
  const res = await worker.fetch(new Request('https://telemetry.test/admin'), h.env);
  assert.equal(res.status, 200);
  const csp = res.headers.get('content-security-policy');
  assert.match(csp, /default-src 'none'/);
  assert.match(csp, /script-src 'nonce-[A-Za-z0-9+/=]+'/);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.equal(res.headers.get('x-frame-options'), 'DENY');
  const html = await res.text();
  const nonce = /script-src 'nonce-([^']+)'/.exec(csp)[1];
  assert.ok(html.includes(`<script nonce="${nonce}"`));
  assert.ok(!html.includes(TOKEN), 'the token must never appear in the page');
});

test('the admin page refuses plain http', async () => {
  const h = harness();
  const res = await worker.fetch(new Request('http://telemetry.test/admin'), h.env);
  assert.equal(res.status, 403);
});

test('verify answers 204 for the token and 401 otherwise, with no body', async () => {
  const h = harness();
  const ok = await worker.fetch(new Request('https://telemetry.test/v1/admin/verify', { headers: { Authorization: `Bearer ${TOKEN}` } }), h.env);
  assert.equal(ok.status, 204);
  const bad = await worker.fetch(new Request('https://telemetry.test/v1/admin/verify', { headers: { Authorization: 'Bearer nope-nope-nope-nope-nope' } }), h.env);
  assert.equal(bad.status, 401);
  assert.equal(await bad.text(), '');
  const none = await worker.fetch(new Request('https://telemetry.test/v1/admin/verify'), h.env);
  assert.equal(none.status, 401);
});
