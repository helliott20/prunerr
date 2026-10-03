import watchHistoryCache, { type WatchHistoryCacheEntry } from '../db/repositories/watchHistoryCache';
import type { MediaItem } from '../types';
import { parseEpisodeProgress, progressOf, type PersonProgress, type WatchProgress } from '../rules/watchProgress';
import { episodeProgressByUser } from './watchHistory';

/** One person's watching of an item, for the detail page. */
export interface ViewerProgress {
  user: string;
  /** Shows: distinct episodes they finished. Null for movies or when unknown. */
  episodesWatched: number | null;
  lastWatched: string | null;
  /**
   * Shows: their progress through it. Movies: 'watched' once they finished it,
   * 'started' if they only played part of it. Null when nothing is known.
   */
  status: WatchProgress | 'watched' | 'started' | null;
}

function byLatest(a: ViewerProgress, b: ViewerProgress): number {
  if (a.lastWatched === b.lastWatched) return a.user.localeCompare(b.user);
  if (!a.lastWatched) return 1;
  if (!b.lastWatched) return -1;
  return b.lastWatched.localeCompare(a.lastWatched);
}

/** Names from the scanned watched_by column, when there's no history to go on. */
function namesOnly(item: MediaItem): ViewerProgress[] {
  if (!item.watched_by) return [];
  try {
    const parsed = typeof item.watched_by === 'string' ? JSON.parse(item.watched_by) : item.watched_by;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((u): u is string => typeof u === 'string' && u.length > 0)
      .map((user) => ({ user, episodesWatched: null, lastWatched: null, status: null }));
  } catch {
    return [];
  }
}

/** A show's plays from the history cache: by its own key and by its title. */
function showPlays(item: MediaItem): WatchHistoryCacheEntry[] {
  const plays = item.plex_id ? watchHistoryCache.getByRatingKey(item.plex_id) : [];
  if (!item.title) return plays;
  const seen = new Set(plays.map((p) => p.session_id ?? `${p.username}|${p.stopped_at}`));
  for (const play of watchHistoryCache.getByShowTitle(item.title)) {
    const key = play.session_id ?? `${play.username}|${play.stopped_at}`;
    if (!seen.has(key)) {
      plays.push(play);
      seen.add(key);
    }
  }
  return plays;
}

/**
 * Who has watched an item and how far they got, most recent first. Uses the
 * per-person progress recorded at the last sync, else works it out from the
 * cached watch history, else falls back to the names recorded at sync.
 */
export function viewersFor(item: MediaItem, recentDays: number, now: Date = new Date()): ViewerProgress[] {
  if (item.type === 'show') {
    let progress: Record<string, PersonProgress> | null = parseEpisodeProgress(item);
    if (!progress) {
      const plays = showPlays(item);
      progress = plays.length > 0 && item.plex_id ? episodeProgressByUser(plays, item.plex_id) : null;
    }
    if (!progress || Object.keys(progress).length === 0) return namesOnly(item);
    const total = item.episode_count;
    return Object.entries(progress)
      .map(([user, p]) => ({
        user,
        episodesWatched: p.watched,
        lastWatched: p.lastWatched,
        status: total && total > 0 ? progressOf(p, total, recentDays, now) : null,
      }))
      .sort(byLatest);
  }

  const plays = item.plex_id ? watchHistoryCache.getByRatingKey(item.plex_id) : [];
  if (plays.length === 0) return namesOnly(item);
  const people = new Map<string, ViewerProgress>();
  for (const play of plays) {
    const at = new Date(play.stopped_at).toISOString();
    const existing = people.get(play.username);
    const lastWatched = !existing?.lastWatched || at > existing.lastWatched ? at : existing.lastWatched;
    const finished = play.watched || existing?.status === 'watched';
    people.set(play.username, {
      user: play.username,
      episodesWatched: null,
      lastWatched,
      status: finished ? 'watched' : 'started',
    });
  }
  return [...people.values()].sort(byLatest);
}
