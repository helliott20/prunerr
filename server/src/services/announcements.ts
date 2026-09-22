import axios from 'axios';
import { z } from 'zod';

import config from '../config';
import logger from '../utils/logger';
import settingsRepo from '../db/repositories/settings';
import { getAppVersion } from '../utils/version';
import { isTelemetryEnabled, isLockedByEnv } from './telemetry';

/**
 * The "What's new" feed.
 *
 * A remote feed of announcements, fetched from the same Worker that receives
 * the install-count heartbeat and cached in the settings table. This is what
 * lets a feature announcement or a request for feedback reach every install
 * without a release. Nothing ships in the image: until something is
 * published, the panel is empty.
 *
 * The remote fetch is governed by the telemetry setting: one toggle, one
 * outbound endpoint. When telemetry is off nothing is fetched, the cache is
 * dropped, and the panel is empty. The request carries the version number so
 * an entry can target a release, and nothing else.
 *
 * Every failure is swallowed. A missing feed is a normal outcome, never
 * something that surfaces as an error to someone whose media server works.
 */

export const ANNOUNCEMENTS_CACHE_KEY = 'announcements_cache';
export const ANNOUNCEMENTS_FETCHED_AT_KEY = 'announcements_fetched_at';
export const ANNOUNCEMENTS_LAST_ERROR_KEY = 'announcements_last_error';

/** Give up quickly: a hung endpoint must not hold a scheduled task open. */
const REQUEST_TIMEOUT_MS = 8000;

/** Refuse to parse anything bigger than the Worker will ever serve. */
const MAX_RESPONSE_BYTES = 512 * 1024;

/**
 * Don't refetch inside this window unless forced. Short enough that a page
 * load a few minutes after something is published picks it up, long enough
 * that a busy dashboard does not hammer the feed.
 */
const MIN_FETCH_INTERVAL_MS = 5 * 60 * 1000;

/**
 * How long a page load will wait for a due refresh before answering from
 * the cache. The fetch keeps running in the background either way, so the
 * next load sees the result.
 */
const PAGE_LOAD_WAIT_MS = 2500;

export const ANNOUNCEMENT_TYPES = ['announcement', 'feature', 'improvement', 'fix', 'feedback'] as const;
export type AnnouncementType = (typeof ANNOUNCEMENT_TYPES)[number];

const VERSION_PATTERN = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;

const httpUrl = z
  .string()
  .max(512)
  .refine((value) => /^https?:\/\//i.test(value), 'must be an http(s) URL');

const RemoteAnnouncementSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/),
  type: z.enum(['announcement', 'feature', 'improvement', 'fix', 'feedback']),
  title: z.string().min(1).max(120),
  body: z.string().max(4000),
  publishedAt: z.string().refine((value) => !Number.isNaN(Date.parse(value)), 'must be a date'),
  imageUrl: httpUrl.optional(),
  link: z
    .object({
      url: httpUrl,
      label: z.string().max(60).optional(),
    })
    .optional(),
  minVersion: z.string().regex(VERSION_PATTERN).optional(),
  maxVersion: z.string().regex(VERSION_PATTERN).optional(),
  expiresAt: z.string().refine((value) => !Number.isNaN(Date.parse(value)), 'must be a date').optional(),
  pinned: z.boolean().optional(),
});

const RemoteFeedSchema = z.object({
  announcements: z.array(RemoteAnnouncementSchema).max(50),
  updatedAt: z.string().nullable().optional(),
});

export type RemoteAnnouncement = z.infer<typeof RemoteAnnouncementSchema>;

/** One item as the panel receives it, whichever source it came from. */
export interface AnnouncementItem {
  id: string;
  type: AnnouncementType;
  title: string;
  body: string;
  publishedAt: string;
  imageUrl?: string;
  link?: { url: string; label?: string };
  pinned?: boolean;
}

export interface AnnouncementsState {
  version: string;
  items: AnnouncementItem[];
  remote: {
    /** Whether the remote feed is fetched at all (telemetry on, endpoint set). */
    enabled: boolean;
    /** TELEMETRY_ENABLED=false took the decision out of the UI's hands. */
    lockedByEnv: boolean;
    endpoint: string;
    lastFetchedAt: string | null;
    lastError: string | null;
  };
}

// ---------------------------------------------------------------------------
// Version comparison
// ---------------------------------------------------------------------------

interface ParsedVersion {
  parts: [number, number, number];
  prerelease: string | null;
}

/** Parse "1.2.3", "v1.2.3" or "1.2.3-beta.1". Anything else is null. */
export function parseVersion(raw: string): ParsedVersion | null {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?/.exec(raw.trim());
  if (!match) return null;
  return {
    parts: [Number(match[1]), Number(match[2]), Number(match[3])],
    prerelease: match[4] ?? null,
  };
}

/** Negative when a < b, zero when equal, positive when a > b. */
export function compareVersions(a: ParsedVersion, b: ParsedVersion): number {
  for (let i = 0; i < 3; i += 1) {
    const diff = (a.parts[i] ?? 0) - (b.parts[i] ?? 0);
    if (diff !== 0) return diff;
  }
  // A prerelease sorts below the release it precedes.
  if (a.prerelease && !b.prerelease) return -1;
  if (!a.prerelease && b.prerelease) return 1;
  if (a.prerelease && b.prerelease) return a.prerelease.localeCompare(b.prerelease);
  return 0;
}

/**
 * Whether an announcement applies to the running version.
 *
 * A build whose version is not semver (a beta branch build reports the
 * branch and commit) cannot be compared, so it sees everything: an
 * announcement is more useful than an over-cautious blank.
 */
export function appliesToVersion(item: Pick<RemoteAnnouncement, 'minVersion' | 'maxVersion'>, version: string): boolean {
  const running = parseVersion(version);
  if (!running) return true;

  if (item.minVersion) {
    const min = parseVersion(item.minVersion);
    if (min && compareVersions(running, min) < 0) return false;
  }
  if (item.maxVersion) {
    const max = parseVersion(item.maxVersion);
    if (max && compareVersions(running, max) > 0) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

export function isRemoteEnabled(): boolean {
  if (!config.announcements.endpoint) return false;
  return isTelemetryEnabled();
}

function readCache(): RemoteAnnouncement[] {
  const raw = settingsRepo.getValue(ANNOUNCEMENTS_CACHE_KEY);
  if (!raw) return [];
  try {
    const parsed = RemoteFeedSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data.announcements : [];
  } catch {
    return [];
  }
}

/** Forget the cached feed. Called when telemetry is switched off. */
export function clearAnnouncementsCache(): void {
  settingsRepo.delete(ANNOUNCEMENTS_CACHE_KEY);
  settingsRepo.delete(ANNOUNCEMENTS_FETCHED_AT_KEY);
  settingsRepo.delete(ANNOUNCEMENTS_LAST_ERROR_KEY);
}

function remoteItems(now: number): AnnouncementItem[] {
  if (!isRemoteEnabled()) return [];

  const version = getAppVersion();
  return readCache()
    .filter((item) => appliesToVersion(item, version))
    .filter((item) => !item.expiresAt || Date.parse(item.expiresAt) > now)
    .map((item) => {
      const out: AnnouncementItem = {
        id: `remote-${item.id}`,
        type: item.type,
        title: item.title,
        body: item.body,
        publishedAt: item.publishedAt,
      };
      if (item.imageUrl) out.imageUrl = item.imageUrl;
      if (item.link) out.link = item.link;
      if (item.pinned) out.pinned = true;
      return out;
    });
}

/**
 * Everything the panel shows, newest first, pinned entries on top.
 */
export function getAnnouncementsState(now = Date.now()): AnnouncementsState {
  const items = remoteItems(now).sort((a, b) => {
    if (Boolean(a.pinned) !== Boolean(b.pinned)) return a.pinned ? -1 : 1;
    return Date.parse(b.publishedAt) - Date.parse(a.publishedAt);
  });

  return {
    version: getAppVersion(),
    items,
    remote: {
      enabled: isRemoteEnabled(),
      lockedByEnv: isLockedByEnv(),
      endpoint: config.announcements.endpoint,
      lastFetchedAt: settingsRepo.getValue(ANNOUNCEMENTS_FETCHED_AT_KEY),
      lastError: settingsRepo.getValue(ANNOUNCEMENTS_LAST_ERROR_KEY),
    },
  };
}

// ---------------------------------------------------------------------------
// Fetching
// ---------------------------------------------------------------------------

function isDue(now: number): boolean {
  const last = settingsRepo.getValue(ANNOUNCEMENTS_FETCHED_AT_KEY);
  if (!last) return true;
  const lastMs = Date.parse(last);
  if (Number.isNaN(lastMs)) return true;
  return now - lastMs >= MIN_FETCH_INTERVAL_MS;
}

export interface RefreshResult {
  fetched: boolean;
  count?: number;
  reason?: 'disabled' | 'not-due' | 'failed';
}

/**
 * Fetch the remote feed and cache it.
 *
 * `force` skips the interval check — used by the panel's refresh button, not
 * by the schedule.
 */
export async function refreshAnnouncements(force = false): Promise<RefreshResult> {
  if (!isRemoteEnabled()) {
    return { fetched: false, reason: 'disabled' };
  }

  const now = Date.now();
  if (!force && !isDue(now)) {
    return { fetched: false, reason: 'not-due' };
  }

  const version = getAppVersion();

  try {
    const response = await axios.get(config.announcements.endpoint, {
      params: { version },
      timeout: REQUEST_TIMEOUT_MS,
      maxContentLength: MAX_RESPONSE_BYTES,
      headers: {
        Accept: 'application/json',
        'User-Agent': `Prunerr/${version}`,
      },
    });

    const parsed = RemoteFeedSchema.safeParse(response.data);
    if (!parsed.success) {
      throw new Error('feed did not match the expected shape');
    }

    settingsRepo.set({
      key: ANNOUNCEMENTS_CACHE_KEY,
      value: JSON.stringify({ announcements: parsed.data.announcements }),
    });
    settingsRepo.set({ key: ANNOUNCEMENTS_FETCHED_AT_KEY, value: new Date(now).toISOString() });
    settingsRepo.delete(ANNOUNCEMENTS_LAST_ERROR_KEY);

    logger.debug(`Announcements feed refreshed: ${parsed.data.announcements.length} entries`);
    return { fetched: true, count: parsed.data.announcements.length };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    settingsRepo.set({ key: ANNOUNCEMENTS_LAST_ERROR_KEY, value: message });
    // Offline installs are the normal case. The cached copy, if any, stays.
    logger.debug(`Announcements feed fetch failed: ${message}`);
    return { fetched: false, reason: 'failed' };
  }
}

/**
 * Refresh if due, waiting briefly so the caller's response includes the
 * result when the feed answers quickly. A slow or unreachable endpoint never
 * holds a page load: after the wait the cached state is used, and the fetch
 * finishes on its own.
 */
export async function refreshIfDue(): Promise<void> {
  if (!isRemoteEnabled() || !isDue(Date.now())) return;

  const fetching = refreshAnnouncements().catch(() => undefined);
  const timeout = new Promise<void>((resolve) => {
    setTimeout(resolve, PAGE_LOAD_WAIT_MS).unref?.();
  });
  await Promise.race([fetching, timeout]);
}

/**
 * Fire the startup fetch without blocking boot.
 *
 * Deliberately not awaited by the caller: a slow or unreachable endpoint must
 * not add seconds to startup.
 */
export function refreshAnnouncementsOnStartup(): void {
  if (!isRemoteEnabled()) return;

  void refreshAnnouncements().catch(() => {
    /* refreshAnnouncements already swallows its own failures. */
  });
}
