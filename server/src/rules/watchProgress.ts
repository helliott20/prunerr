import type { MediaItem } from '../types';

/**
 * How far through a TV show its viewers are. "In progress" means someone has
 * watched some but not all of the episodes, and watched one recently — a show
 * abandoned long ago is "stalled" instead, so it doesn't stay protected
 * forever.
 */

export const IN_PROGRESS_DEFAULT_RECENT_DAYS = 60;

export type WatchProgress = 'not_started' | 'in_progress' | 'stalled' | 'finished';

type ProgressFields = Pick<MediaItem, 'type' | 'episode_count' | 'watched_episode_count'>;

/** Share of a show's episodes someone has watched, 0–100; null when unknown. */
export function percentWatched(item: ProgressFields): number | null {
  if (item.type !== 'show') return null;
  const total = item.episode_count;
  const watched = item.watched_episode_count;
  if (!total || total <= 0 || watched === null || watched === undefined) return null;
  return Math.min(100, Math.round((watched / total) * 100));
}

export function isShowInProgress(
  item: ProgressFields & Pick<MediaItem, 'last_watched_at'>,
  recentDays: number,
  now: Date = new Date()
): boolean {
  if (item.type !== 'show') return false;
  const total = item.episode_count;
  const watched = item.watched_episode_count;
  if (!total || !watched || watched <= 0 || watched >= total) return false;
  if (!item.last_watched_at) return false;
  const lastWatched = new Date(item.last_watched_at).getTime();
  if (Number.isNaN(lastWatched)) return false;
  return now.getTime() - lastWatched <= recentDays * 24 * 60 * 60 * 1000;
}

/**
 * A show's watch progress, or null for movies and shows whose episode counts
 * aren't known.
 */
export function watchProgress(
  item: ProgressFields & Pick<MediaItem, 'last_watched_at'>,
  recentDays: number,
  now: Date = new Date()
): WatchProgress | null {
  if (item.type !== 'show') return null;
  const total = item.episode_count;
  const watched = item.watched_episode_count;
  if (!total || total <= 0 || watched === null || watched === undefined) return null;
  if (watched <= 0) return 'not_started';
  if (watched >= total) return 'finished';
  return isShowInProgress(item, recentDays, now) ? 'in_progress' : 'stalled';
}
