import type { MediaItem } from '../types';

/**
 * How far through a TV show its viewers are, judged per person.
 *
 * A show is "in progress" when any one person has watched some but not all of
 * its episodes and watched one recently. Someone who started long ago and
 * stopped makes it "stalled" instead, so an abandoned show doesn't stay
 * protected forever. Judging per person matters: when one person has finished
 * and another is half-way, everyone's episodes together cover the whole show,
 * but the second person is still watching.
 *
 * When the provider can't say who watched (Plex's own count, for one), the
 * combined count stands in as if it were one person.
 */

export const IN_PROGRESS_DEFAULT_RECENT_DAYS = 60;

export type WatchProgress = 'not_started' | 'in_progress' | 'stalled' | 'finished';

export interface PersonProgress {
  /** Distinct episodes they finished. */
  watched: number;
  /** Their latest play (ISO), finished or not. */
  lastWatched: string | null;
}

type ProgressFields = Pick<MediaItem, 'type' | 'episode_count' | 'watched_episode_count'> &
  Partial<Pick<MediaItem, 'episode_progress' | 'last_watched_at'>>;

/** Each person's progress through a show, or null when it isn't recorded. */
export function parseEpisodeProgress(item: Pick<ProgressFields, 'episode_progress'>): Record<string, PersonProgress> | null {
  const raw = item.episode_progress;
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const out: Record<string, PersonProgress> = {};
    for (const [user, value] of Object.entries(parsed as Record<string, unknown>)) {
      const v = value as Partial<PersonProgress> | null;
      if (!v || typeof v.watched !== 'number') continue;
      out[user] = { watched: v.watched, lastWatched: typeof v.lastWatched === 'string' ? v.lastWatched : null };
    }
    return Object.keys(out).length > 0 ? out : null;
  } catch {
    return null;
  }
}

function isRecent(iso: string | null | undefined, recentDays: number, now: Date): boolean {
  if (!iso) return false;
  const at = new Date(iso).getTime();
  if (Number.isNaN(at)) return false;
  return now.getTime() - at <= recentDays * 24 * 60 * 60 * 1000;
}

/** One person's (or the combined) progress through a show of `total` episodes. */
export function progressOf(
  person: PersonProgress,
  total: number,
  recentDays: number,
  now: Date = new Date()
): WatchProgress {
  if (person.watched <= 0) return 'not_started';
  if (person.watched >= total) return 'finished';
  return isRecent(person.lastWatched, recentDays, now) ? 'in_progress' : 'stalled';
}

/** The people progress is judged on: each viewer, or everyone as one. */
function people(item: ProgressFields): PersonProgress[] | null {
  const perPerson = parseEpisodeProgress(item);
  if (perPerson) return Object.values(perPerson);
  const watched = item.watched_episode_count;
  if (watched === null || watched === undefined) return null;
  return [{ watched, lastWatched: item.last_watched_at ?? null }];
}

/** Share of a show's episodes anyone has watched, 0–100; null when unknown. */
export function percentWatched(item: ProgressFields): number | null {
  if (item.type !== 'show') return null;
  const total = item.episode_count;
  const watched = item.watched_episode_count;
  if (!total || total <= 0 || watched === null || watched === undefined) return null;
  return Math.min(100, Math.round((watched / total) * 100));
}

/** Who is part-way through a show and watched recently. */
export function usersInProgress(item: ProgressFields, recentDays: number, now: Date = new Date()): string[] {
  if (item.type !== 'show' || !item.episode_count || item.episode_count <= 0) return [];
  const perPerson = parseEpisodeProgress(item);
  if (!perPerson) return [];
  const total = item.episode_count;
  return Object.entries(perPerson)
    .filter(([, p]) => progressOf(p, total, recentDays, now) === 'in_progress')
    .map(([user]) => user);
}

export function isShowInProgress(item: ProgressFields, recentDays: number, now: Date = new Date()): boolean {
  return watchProgress(item, recentDays, now) === 'in_progress';
}

/**
 * A show's watch progress, or null for movies and shows whose episode counts
 * aren't known. Anyone in progress makes the show in progress; otherwise
 * anyone part-way makes it stalled — so "finished" means nobody stopped short.
 */
export function watchProgress(item: ProgressFields, recentDays: number, now: Date = new Date()): WatchProgress | null {
  if (item.type !== 'show') return null;
  const total = item.episode_count;
  if (!total || total <= 0) return null;
  const viewers = people(item);
  if (!viewers) return null;

  const states = viewers.map((p) => progressOf(p, total, recentDays, now));
  if (states.includes('in_progress')) return 'in_progress';
  if (states.includes('stalled')) return 'stalled';
  if (states.includes('finished')) return 'finished';
  return 'not_started';
}
