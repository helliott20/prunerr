import settingsRepo from '../db/repositories/settings';

/**
 * Decides whether a watch history sync can be incremental or must refetch the
 * whole lookback window.
 *
 * An incremental sync only asks for plays newer than the newest cached one, so
 * two kinds of play are never picked up by it:
 * - plays older than what the cache covers, after the lookback is raised;
 * - plays that reach the provider late with older timestamps (for example
 *   Tautulli history imported into Tracearr).
 *
 * A full sync is cheap to repeat because rows are deduped by session id, so
 * one is run whenever the cache doesn't cover the current lookback, and
 * otherwise once every FULL_RESYNC_INTERVAL_DAYS.
 */

export const FULL_RESYNC_INTERVAL_DAYS = 7;

const FULL_SYNC_AT_KEY = 'history_cache_full_sync_at';
const FULL_SYNC_DAYS_KEY = 'history_cache_full_sync_days';

export interface HistorySyncState {
  /** Rows in the cache. */
  cachedCount: number;
  /** Newest cached stopped_at, if any. */
  latestTimestamp: string | null;
  /** When the last full sync finished, if one has been recorded. */
  lastFullSyncAt: string | null;
  /** Lookback the last full sync fetched, if one has been recorded. */
  lastFullSyncDays: number | null;
}

export type HistorySyncPlan =
  | { mode: 'incremental'; since: Date }
  | { mode: 'full'; since: Date; reason: string };

export function planHistorySync(state: HistorySyncState, lookbackDays: number, now: Date = new Date()): HistorySyncPlan {
  const lookbackStart = new Date(now);
  lookbackStart.setDate(lookbackStart.getDate() - lookbackDays);
  const full = (reason: string): HistorySyncPlan => ({ mode: 'full', since: lookbackStart, reason });

  if (!state.latestTimestamp || state.cachedCount === 0) return full('cache is empty');
  if (!state.lastFullSyncAt || state.lastFullSyncDays === null) return full('no full sync recorded');
  if (state.lastFullSyncDays < lookbackDays) {
    return full(`lookback raised from ${state.lastFullSyncDays} to ${lookbackDays} days`);
  }

  const lastFull = new Date(state.lastFullSyncAt).getTime();
  const ageDays = (now.getTime() - lastFull) / 86_400_000;
  if (!Number.isFinite(ageDays) || ageDays >= FULL_RESYNC_INTERVAL_DAYS) {
    return full(`last full sync over ${FULL_RESYNC_INTERVAL_DAYS} days ago`);
  }

  return { mode: 'incremental', since: new Date(state.latestTimestamp) };
}

/** Reads the recorded full-sync state from settings. */
export function getFullSyncRecord(): Pick<HistorySyncState, 'lastFullSyncAt' | 'lastFullSyncDays'> {
  const at = settingsRepo.getValue(FULL_SYNC_AT_KEY);
  const days = parseInt(settingsRepo.getValue(FULL_SYNC_DAYS_KEY) ?? '', 10);
  return { lastFullSyncAt: at || null, lastFullSyncDays: Number.isFinite(days) ? days : null };
}

/** Records a full sync that finished without error. */
export function recordFullSync(lookbackDays: number, now: Date = new Date()): void {
  settingsRepo.set({ key: FULL_SYNC_AT_KEY, value: now.toISOString() });
  settingsRepo.set({ key: FULL_SYNC_DAYS_KEY, value: String(lookbackDays) });
}
