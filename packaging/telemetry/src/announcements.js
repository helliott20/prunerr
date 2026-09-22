/**
 * Prunerr announcements feed.
 *
 * Everything the in-app "What's new" panel shows comes from here: a small
 * JSON document plus a handful of images, both stored in Cloudflare KV and
 * edited through a token-guarded admin API, so a feature announcement or a
 * request for feedback can be pushed to every install without cutting a
 * release.
 *
 * Reads are anonymous. An install fetches `GET /v1/announcements` with its
 * version in the query string and nothing else, and the handler stores
 * nothing about the request — same rule as the heartbeat: it never reads
 * `CF-Connecting-IP` or the `cf` object. The version is used only so the
 * feed can be filtered per release, and it is not written anywhere.
 *
 * Writes need `Authorization: Bearer <ADMIN_TOKEN>`, where ADMIN_TOKEN is a
 * Worker secret (`npx wrangler secret put ADMIN_TOKEN`). A Worker deployed
 * without the secret refuses every write.
 *
 * Endpoints:
 *   GET    /v1/announcements          the feed (public, cached)
 *   PUT    /v1/announcements          replace the feed (admin)
 *   GET    /v1/images                 list uploaded images (admin)
 *   GET    /v1/images/<name>          an uploaded image (public, cached)
 *   PUT    /v1/images/<name>          upload or replace an image (admin)
 *   DELETE /v1/images/<name>          remove an image (admin)
 */

/** KV key holding the feed document. */
const FEED_KEY = 'feed';

/** Prefix for image keys. */
const IMAGE_KEY_PREFIX = 'image:';

/** Hard cap on the feed document. 50 entries × 2KB of body is well inside. */
const MAX_FEED_BYTES = 256 * 1024;

/** Images bigger than this belong on a CDN, not in KV. */
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

const MAX_ENTRIES = 50;

/** What an announcement can be. The client maps each to a pill and colour. */
export const ANNOUNCEMENT_TYPES = ['announcement', 'feature', 'improvement', 'fix', 'feedback'];

const ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
const IMAGE_NAME_PATTERN = /^[a-z0-9][a-z0-9._-]{0,79}\.(png|jpg|jpeg|gif|webp|svg)$/;
const VERSION_PATTERN = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;

const IMAGE_CONTENT_TYPES = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
};

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, PUT, DELETE, OPTIONS',
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

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

/** Constant-time string compare, so the token cannot be guessed by timing. */
function timingSafeEqual(a, b) {
  const enc = new TextEncoder();
  const ab = enc.encode(a);
  const bb = enc.encode(b);
  if (ab.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < ab.length; i += 1) diff |= ab[i] ^ bb[i];
  return diff === 0;
}

export function isAuthorized(request, env) {
  const token = env.ADMIN_TOKEN;
  if (typeof token !== 'string' || token.length < 16) return false;

  const header = request.headers.get('authorization') ?? '';
  const match = /^Bearer\s+(.+)$/i.exec(header);
  if (!match) return false;

  return timingSafeEqual(match[1].trim(), token);
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function isIsoDate(value) {
  return typeof value === 'string' && value.length <= 40 && !Number.isNaN(Date.parse(value));
}

function isHttpUrl(value, maxLength = 512) {
  if (typeof value !== 'string' || value.length > maxLength) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

function optionalString(value, maxLength) {
  return value === undefined || (typeof value === 'string' && value.length <= maxLength);
}

/**
 * Validate one entry and return a clean copy built field by field.
 *
 * Returns `{ error }` on the first problem so the admin CLI can print
 * something actionable, or `{ entry }` with only the fields we know about.
 */
export function validateAnnouncement(raw, index) {
  const at = `announcements[${index}]`;
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { error: `${at} must be an object` };
  }

  if (typeof raw.id !== 'string' || !ID_PATTERN.test(raw.id)) {
    return { error: `${at}.id must be lowercase letters, digits and dashes (max 64)` };
  }
  if (!ANNOUNCEMENT_TYPES.includes(raw.type)) {
    return { error: `${at}.type must be one of ${ANNOUNCEMENT_TYPES.join(', ')}` };
  }
  if (typeof raw.title !== 'string' || raw.title.trim().length === 0 || raw.title.length > 120) {
    return { error: `${at}.title is required (max 120 characters)` };
  }
  if (typeof raw.body !== 'string' || raw.body.length > 4000) {
    return { error: `${at}.body must be a string (max 4000 characters)` };
  }
  if (!isIsoDate(raw.publishedAt)) {
    return { error: `${at}.publishedAt must be an ISO date` };
  }
  if (raw.imageUrl !== undefined && !isHttpUrl(raw.imageUrl)) {
    return { error: `${at}.imageUrl must be an http(s) URL` };
  }
  if (raw.link !== undefined) {
    if (typeof raw.link !== 'object' || raw.link === null || !isHttpUrl(raw.link.url)) {
      return { error: `${at}.link.url must be an http(s) URL` };
    }
    if (!optionalString(raw.link.label, 60)) {
      return { error: `${at}.link.label must be a string (max 60 characters)` };
    }
  }
  if (raw.minVersion !== undefined && (typeof raw.minVersion !== 'string' || !VERSION_PATTERN.test(raw.minVersion))) {
    return { error: `${at}.minVersion must be semver, e.g. 1.5.0` };
  }
  if (raw.maxVersion !== undefined && (typeof raw.maxVersion !== 'string' || !VERSION_PATTERN.test(raw.maxVersion))) {
    return { error: `${at}.maxVersion must be semver, e.g. 1.5.0` };
  }
  if (raw.expiresAt !== undefined && !isIsoDate(raw.expiresAt)) {
    return { error: `${at}.expiresAt must be an ISO date` };
  }
  if (raw.pinned !== undefined && typeof raw.pinned !== 'boolean') {
    return { error: `${at}.pinned must be a boolean` };
  }

  const entry = {
    id: raw.id,
    type: raw.type,
    title: raw.title.trim(),
    body: raw.body,
    publishedAt: new Date(raw.publishedAt).toISOString(),
  };
  if (raw.imageUrl !== undefined) entry.imageUrl = raw.imageUrl;
  if (raw.link !== undefined) {
    entry.link = { url: raw.link.url };
    if (raw.link.label !== undefined) entry.link.label = raw.link.label;
  }
  if (raw.minVersion !== undefined) entry.minVersion = raw.minVersion;
  if (raw.maxVersion !== undefined) entry.maxVersion = raw.maxVersion;
  if (raw.expiresAt !== undefined) entry.expiresAt = new Date(raw.expiresAt).toISOString();
  if (raw.pinned !== undefined) entry.pinned = raw.pinned;

  return { entry };
}

export function validateFeed(raw) {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { error: 'expected an object with an announcements array' };
  }
  if (!Array.isArray(raw.announcements)) {
    return { error: 'announcements must be an array' };
  }
  if (raw.announcements.length > MAX_ENTRIES) {
    return { error: `at most ${MAX_ENTRIES} announcements` };
  }

  const seen = new Set();
  const announcements = [];
  for (let i = 0; i < raw.announcements.length; i += 1) {
    const result = validateAnnouncement(raw.announcements[i], i);
    if (result.error) return result;
    if (seen.has(result.entry.id)) {
      return { error: `announcements[${i}].id "${result.entry.id}" is duplicated` };
    }
    seen.add(result.entry.id);
    announcements.push(result.entry);
  }

  // Newest first, so the client can render in order without sorting.
  announcements.sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt));

  return { feed: { announcements, updatedAt: new Date().toISOString() } };
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

const EMPTY_FEED = { announcements: [], updatedAt: null };

async function handleGetFeed(env) {
  if (!env.ANNOUNCEMENTS) return json(EMPTY_FEED);

  const stored = await env.ANNOUNCEMENTS.get(FEED_KEY, 'json');
  return json(stored ?? EMPTY_FEED, {
    // Installs poll every few hours and Prunerr caches the result locally,
    // so a five-minute edge cache costs nothing in freshness and keeps the
    // KV read count flat however many installs there are.
    headers: { 'Cache-Control': 'public, max-age=300' },
  });
}

async function handlePutFeed(request, env) {
  if (!isAuthorized(request, env)) {
    return json({ error: 'unauthorized' }, { status: 401 });
  }
  if (!env.ANNOUNCEMENTS) {
    return json({ error: 'announcements storage is not configured' }, { status: 503 });
  }

  const text = await request.text();
  if (text.length > MAX_FEED_BYTES) {
    return json({ error: 'payload too large' }, { status: 413 });
  }

  let body;
  try {
    body = JSON.parse(text);
  } catch {
    return json({ error: 'invalid JSON' }, { status: 400 });
  }

  const result = validateFeed(body);
  if (result.error) {
    return json({ error: result.error }, { status: 400 });
  }

  await env.ANNOUNCEMENTS.put(FEED_KEY, JSON.stringify(result.feed));
  return json(result.feed);
}

async function handleListImages(request, env) {
  if (!isAuthorized(request, env)) {
    return json({ error: 'unauthorized' }, { status: 401 });
  }
  if (!env.ANNOUNCEMENTS) return json({ images: [] });

  const origin = new URL(request.url).origin;
  const images = [];
  let cursor;
  do {
    const page = await env.ANNOUNCEMENTS.list({ prefix: IMAGE_KEY_PREFIX, cursor });
    for (const key of page.keys) {
      const name = key.name.slice(IMAGE_KEY_PREFIX.length);
      images.push({ name, url: `${origin}/v1/images/${name}`, contentType: key.metadata?.contentType ?? null });
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);

  images.sort((a, b) => a.name.localeCompare(b.name));
  return json({ images }, { headers: { 'Cache-Control': 'no-store' } });
}

function imageName(pathname) {
  const name = pathname.slice('/v1/images/'.length);
  return IMAGE_NAME_PATTERN.test(name) ? name : null;
}

async function handleGetImage(name, env) {
  if (!env.ANNOUNCEMENTS) return json({ error: 'not found' }, { status: 404 });

  const { value, metadata } = await env.ANNOUNCEMENTS.getWithMetadata(
    IMAGE_KEY_PREFIX + name,
    'arrayBuffer'
  );
  if (!value) return json({ error: 'not found' }, { status: 404 });

  const ext = name.slice(name.lastIndexOf('.') + 1);
  return new Response(value, {
    headers: {
      'Content-Type': metadata?.contentType ?? IMAGE_CONTENT_TYPES[ext] ?? 'application/octet-stream',
      // Replacing an image means uploading under a new name; a long cache
      // is what keeps image bytes off the KV read allowance.
      'Cache-Control': 'public, max-age=86400',
      ...CORS_HEADERS,
    },
  });
}

async function handlePutImage(request, name, env) {
  if (!isAuthorized(request, env)) {
    return json({ error: 'unauthorized' }, { status: 401 });
  }
  if (!env.ANNOUNCEMENTS) {
    return json({ error: 'announcements storage is not configured' }, { status: 503 });
  }

  const contentLength = Number(request.headers.get('content-length') ?? '0');
  if (contentLength > MAX_IMAGE_BYTES) {
    return json({ error: 'image too large (max 2MB)' }, { status: 413 });
  }

  const bytes = await request.arrayBuffer();
  if (bytes.byteLength === 0) {
    return json({ error: 'empty body' }, { status: 400 });
  }
  if (bytes.byteLength > MAX_IMAGE_BYTES) {
    return json({ error: 'image too large (max 2MB)' }, { status: 413 });
  }

  const ext = name.slice(name.lastIndexOf('.') + 1);
  const contentType = IMAGE_CONTENT_TYPES[ext];

  await env.ANNOUNCEMENTS.put(IMAGE_KEY_PREFIX + name, bytes, {
    metadata: { contentType },
  });

  const url = new URL(request.url);
  return json({ name, url: `${url.origin}/v1/images/${name}`, bytes: bytes.byteLength });
}

async function handleDeleteImage(request, name, env) {
  if (!isAuthorized(request, env)) {
    return json({ error: 'unauthorized' }, { status: 401 });
  }
  if (!env.ANNOUNCEMENTS) {
    return json({ error: 'announcements storage is not configured' }, { status: 503 });
  }

  await env.ANNOUNCEMENTS.delete(IMAGE_KEY_PREFIX + name);
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

/**
 * Route an announcements request, or return null if the path is not ours.
 */
export async function handleAnnouncementsRequest(request, env) {
  const url = new URL(request.url);
  const { pathname } = url;

  if (pathname === '/v1/announcements') {
    if (request.method === 'GET') return handleGetFeed(env);
    if (request.method === 'PUT') return handlePutFeed(request, env);
    return json({ error: 'method not allowed' }, { status: 405 });
  }

  if (pathname === '/v1/images') {
    if (request.method === 'GET') return handleListImages(request, env);
    return json({ error: 'method not allowed' }, { status: 405 });
  }

  if (pathname.startsWith('/v1/images/')) {
    const name = imageName(pathname);
    if (!name) return json({ error: 'not found' }, { status: 404 });

    if (request.method === 'GET') return handleGetImage(name, env);
    if (request.method === 'PUT') return handlePutImage(request, name, env);
    if (request.method === 'DELETE') return handleDeleteImage(request, name, env);
    return json({ error: 'method not allowed' }, { status: 405 });
  }

  return null;
}
