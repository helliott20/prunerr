/**
 * Prunerr telemetry receiver.
 *
 * Counts how many Prunerr installs are still running. That is the entire
 * purpose, and the code is in this repo so anyone who wonders what happens to
 * their heartbeat can read it rather than take our word for it.
 *
 * What it stores: a random install ID, the reported version, and two
 * timestamps. What it deliberately does not store: IP addresses, user agents,
 * geolocation, request logs, or anything derived from them. The ingest handler
 * never reads `CF-Connecting-IP` or the `cf` object, and the row it writes is
 * built field by field from an allowlist — the request body is never spread
 * into it, so a field we did not ask for cannot become a column we did not
 * intend.
 *
 * Endpoints:
 *   POST /v1/ping           — one heartbeat
 *   GET  /v1/stats          — public aggregate counts
 *   GET  /v1/announcements  — the in-app "What's new" feed (see announcements.js)
 *   GET  /v1/images/<name>  — an announcement image
 *   GET  /                  — human-readable description
 */

import { handleAnnouncementsRequest } from './announcements.js';

/** Anything larger than this is not a heartbeat. */
const MAX_BODY_BYTES = 512;

/** Rows older than this are deleted outright by the scheduled prune. */
const RETENTION_DAYS = 90;

/** An install is "live" if it has reported within this window. */
const ACTIVE_WINDOW_DAYS = 30;

/**
 * Ignore repeat pings from the same install inside this window.
 *
 * Prunerr only pings daily, so this costs nothing in normal operation. It
 * exists so a restart loop or a misbehaving install cannot burn through the
 * daily row-write allowance, and it is checked with a read (5M/day) to avoid
 * spending a write (100k/day).
 */
const MIN_PING_INTERVAL_SECONDS = 60 * 60;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

function json(body, init = {}) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...CORS_HEADERS,
      ...(init.headers ?? {}),
    },
  });
}

/**
 * A v4-shaped UUID and nothing else.
 *
 * This is the privacy guarantee doing real work: the ID field cannot carry a
 * hostname, an email or a path, because none of those match.
 */
const INSTALL_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Semver-ish: digits, letters, dots, dashes, plus. Bounded length. */
const VERSION_PATTERN = /^[0-9A-Za-z][0-9A-Za-z.+-]{0,31}$/;

function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}

async function handlePing(request, env) {
  const contentLength = Number(request.headers.get('content-length') ?? '0');
  if (contentLength > MAX_BODY_BYTES) {
    return json({ error: 'payload too large' }, { status: 413 });
  }

  let body;
  try {
    const text = await request.text();
    if (text.length > MAX_BODY_BYTES) {
      return json({ error: 'payload too large' }, { status: 413 });
    }
    body = JSON.parse(text);
  } catch {
    return json({ error: 'invalid JSON' }, { status: 400 });
  }

  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return json({ error: 'expected an object' }, { status: 400 });
  }

  // The allowlist. Read the two fields we accept, by name, and ignore the rest
  // of the body entirely — including any field a future Prunerr version might
  // start sending before this Worker has been taught to expect it.
  const installId = body.installId;
  const version = body.version;

  if (typeof installId !== 'string' || !INSTALL_ID_PATTERN.test(installId)) {
    return json({ error: 'installId must be a UUID' }, { status: 400 });
  }
  if (typeof version !== 'string' || !VERSION_PATTERN.test(version)) {
    return json({ error: 'invalid version' }, { status: 400 });
  }

  const id = installId.toLowerCase();
  const seconds = nowSeconds();

  // Read before writing: a duplicate ping costs one row read instead of one
  // row write, and writes are the scarcer allowance.
  const existing = await env.DB.prepare(
    'SELECT last_seen, version FROM installs WHERE install_id = ?'
  )
    .bind(id)
    .first();

  if (
    existing &&
    seconds - existing.last_seen < MIN_PING_INTERVAL_SECONDS &&
    existing.version === version
  ) {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  await env.DB.prepare(
    `INSERT INTO installs (install_id, version, first_seen, last_seen)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(install_id) DO UPDATE SET
       version = excluded.version,
       last_seen = excluded.last_seen`
  )
    .bind(id, version, seconds, seconds)
    .run();

  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

async function handleStats(env) {
  const cutoff = nowSeconds() - ACTIVE_WINDOW_DAYS * 86400;

  const active = await env.DB.prepare(
    'SELECT COUNT(*) AS count FROM installs WHERE last_seen >= ?'
  )
    .bind(cutoff)
    .first();

  const versions = await env.DB.prepare(
    `SELECT version, COUNT(*) AS count
     FROM installs
     WHERE last_seen >= ?
     GROUP BY version
     ORDER BY count DESC
     LIMIT 25`
  )
    .bind(cutoff)
    .all();

  return json(
    {
      activeInstalls: active?.count ?? 0,
      windowDays: ACTIVE_WINDOW_DAYS,
      versions: (versions.results ?? []).map((row) => ({
        version: row.version,
        count: row.count,
      })),
      generatedAt: new Date().toISOString(),
    },
    {
      // A public counter does not need to be to-the-second accurate, and
      // caching keeps a linked-to stats page from spending the read allowance.
      headers: { 'Cache-Control': 'public, max-age=900' },
    }
  );
}

const DESCRIPTION = `Prunerr telemetry.

This endpoint counts how many Prunerr installs are still running. Each install
sends a random ID and its version, once a day. No IP addresses, no library
contents, no settings, no personal data of any kind is stored.

  POST /v1/ping           one heartbeat: {"installId": "<uuid>", "version": "1.2.3"}
  GET  /v1/stats          the public count
  GET  /v1/announcements  the "What's new" feed shown inside Prunerr. Fetched
                          with the install's version so it can be filtered per
                          release; nothing about the request is stored.

Turn it off in Prunerr under Settings -> System -> Privacy, or set
TELEMETRY_ENABLED=false. Turning it off deletes the install's ID.

Source: https://github.com/helliott20/prunerr/tree/main/packaging/telemetry
`;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    if (url.pathname === '/v1/ping' && request.method === 'POST') {
      try {
        return await handlePing(request, env);
      } catch {
        // Never surface internals, and never fail loudly: the client treats
        // any error as "try again tomorrow" anyway.
        return json({ error: 'unavailable' }, { status: 503 });
      }
    }

    if (url.pathname === '/v1/stats' && request.method === 'GET') {
      try {
        return await handleStats(env);
      } catch {
        return json({ error: 'unavailable' }, { status: 503 });
      }
    }

    if (url.pathname === '/v1/announcements' || url.pathname.startsWith('/v1/images/')) {
      try {
        const handled = await handleAnnouncementsRequest(request, env);
        if (handled) return handled;
      } catch {
        return json({ error: 'unavailable' }, { status: 503 });
      }
    }

    if (url.pathname === '/' && request.method === 'GET') {
      return new Response(DESCRIPTION, {
        headers: { 'Content-Type': 'text/plain; charset=utf-8', ...CORS_HEADERS },
      });
    }

    return json({ error: 'not found' }, { status: 404 });
  },

  /**
   * Daily maintenance: record the day's count, then forget old installs.
   *
   * Retention is the reason the prune exists. An install that stopped
   * reporting three months ago is not a live install, and keeping its ID
   * around serves no purpose — so it is deleted, while the aggregate count it
   * contributed to survives in daily_counts as a number with no IDs attached.
   */
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(
      (async () => {
        const seconds = nowSeconds();
        const activeCutoff = seconds - ACTIVE_WINDOW_DAYS * 86400;
        const retentionCutoff = seconds - RETENTION_DAYS * 86400;
        const day = new Date(seconds * 1000).toISOString().slice(0, 10);

        const active = await env.DB.prepare(
          'SELECT COUNT(*) AS count FROM installs WHERE last_seen >= ?'
        )
          .bind(activeCutoff)
          .first();

        await env.DB.prepare(
          `INSERT INTO daily_counts (day, active_installs, recorded_at)
           VALUES (?, ?, ?)
           ON CONFLICT(day) DO UPDATE SET
             active_installs = excluded.active_installs,
             recorded_at = excluded.recorded_at`
        )
          .bind(day, active?.count ?? 0, seconds)
          .run();

        await env.DB.prepare('DELETE FROM installs WHERE last_seen < ?')
          .bind(retentionCutoff)
          .run();
      })()
    );
  },
};
