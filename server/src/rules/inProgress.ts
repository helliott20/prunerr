import settingsRepo from '../db/repositories/settings';
import type { MediaItem } from '../types';
import { IN_PROGRESS_DEFAULT_RECENT_DAYS, isShowInProgress } from './watchProgress';

export { IN_PROGRESS_DEFAULT_RECENT_DAYS, isShowInProgress, percentWatched, usersInProgress, watchProgress } from './watchProgress';

/** Settings → Safety: keep rules away from shows someone is part-way through. */

export interface InProgressConfig {
  /** Skip in-progress shows in every rule, cleanup and preview. */
  protect: boolean;
  /** How recently an episode must have been watched. */
  recentDays: number;
}

/** Safety settings (Settings → Safety). Protection is on unless turned off. */
export function loadInProgressConfig(): InProgressConfig {
  const recentDays = settingsRepo.getNumber('inProgress_recentDays', IN_PROGRESS_DEFAULT_RECENT_DAYS);
  return {
    protect: settingsRepo.getBoolean('inProgress_protect', true),
    recentDays: recentDays > 0 ? recentDays : IN_PROGRESS_DEFAULT_RECENT_DAYS,
  };
}

/** True when in-progress protection is on and this item is an in-progress show. */
export function isProtectedInProgress(
  item: Pick<MediaItem, 'type' | 'episode_count' | 'watched_episode_count' | 'last_watched_at'> &
    Partial<Pick<MediaItem, 'episode_progress'>>,
  config: InProgressConfig,
  now: Date = new Date()
): boolean {
  return config.protect && isShowInProgress(item, config.recentDays, now);
}
