import mediaItemsRepo from '../db/repositories/mediaItems';
import rulesRepo from '../db/repositories/rules';
import settingsRepo from '../db/repositories/settings';
import { buildEvaluationContext } from '../rules/context';
import { loadInProgressConfig } from '../rules/inProgress';
import {
  FORECAST_MAX_DAYS,
  bytesFreed,
  forecastItem,
  prepareRules,
  type ForecastCertainty,
  type ForecastReason,
} from '../rules/forecast';
import { loadExclusionPatterns, matchesExclusionPattern } from '../scheduler/tasks';
import { getStorageStats } from './storage';
import { toThumbnailUrl } from '../utils/posterUrl';
import logger from '../utils/logger';
import type { MediaItem } from '../types';

const DAY_MS = 24 * 60 * 60 * 1000;

export interface ForecastEntry {
  id: number;
  title: string;
  type: MediaItem['type'];
  year: number | null;
  libraryKey: string | null;
  posterUrl: string | null;
  sizeBytes: number;
  /** What deleting it frees: 0 when the rule only unmonitors. */
  freesBytes: number;
  playCount: number;
  lastWatchedAt: string | null;
  addedAt: string | null;
  /** When a rule first matches (or, for queued items, when it was queued). */
  eligibleAt: string;
  /** When it would be deleted: eligibility plus the rule's grace period. */
  deleteAt: string;
  /** Already in the deletion queue. */
  queued: boolean;
  /** Matches today, so the next scan queues it. */
  eligibleNow: boolean;
  ruleId: number | null;
  ruleName: string | null;
  certainty: ForecastCertainty;
  reasons: ForecastReason[];
}

export interface ForecastResult {
  generatedAt: string;
  horizonDays: number;
  items: ForecastEntry[];
  rules: Array<{ id: number; name: string }>;
  /** Monitored items left out, and why. */
  skipped: { protected: number; excluded: number; flagOrNotify: number };
  /** Enabled rules that queue deletions. */
  deleteRuleCount: number;
  storage: {
    configured: boolean;
    source: 'unraid' | 'arr' | null;
    freeBytes: number | null;
    totalBytes: number | null;
    driveCount: number;
  };
  scanEnabled: boolean;
  autoProcess: boolean;
  diskPressureActive: boolean;
}

const CACHE_MS = 2 * 60 * 1000;
let cache: { at: number; result: ForecastResult } | null = null;

/** Forget the cached forecast (rules or settings changed, or a test). */
export function clearForecastCache(): void {
  cache = null;
}

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

function entryBase(item: MediaItem) {
  return {
    id: item.id,
    title: item.title,
    type: item.type,
    year: item.year ?? null,
    libraryKey: item.library_key ?? null,
    posterUrl: toThumbnailUrl(item.poster_url) || null,
    sizeBytes: item.file_size || 0,
    playCount: item.play_count || 0,
    lastWatchedAt: item.last_watched_at ?? null,
    addedAt: item.added_at ?? null,
  };
}

/** Everything the Forecast page shows, out to two years. */
export async function buildForecast(options: { fresh?: boolean; now?: Date } = {}): Promise<ForecastResult> {
  if (!options.fresh && !options.now && cache && Date.now() - cache.at < CACHE_MS) return cache.result;

  const now = options.now ?? new Date();
  const enabledRules = rulesRepo.rules.getEnabled();
  const rules = prepareRules(enabledRules);
  const ruleNames = new Map(enabledRules.map((r) => [r.id, r.name]));
  const ctx = buildEvaluationContext();
  const inProgress = loadInProgressConfig();
  const exclusionPatterns = loadExclusionPatterns();
  const opts = { now, horizonDays: FORECAST_MAX_DAYS, ctx: { ...ctx, now }, inProgress };

  const items: ForecastEntry[] = [];
  const skipped = { protected: 0, excluded: 0, flagOrNotify: 0 };

  // Already queued: these go first, on their own dates.
  for (const item of mediaItemsRepo.getPendingDeletion()) {
    if (!item.delete_after || !item.marked_at) continue;
    // Queue columns the MediaItem type doesn't declare.
    const queuedRow = item as MediaItem & { matched_rule_id?: number | null; deletion_action?: string | null };
    const ruleId = queuedRow.matched_rule_id ?? null;
    items.push({
      ...entryBase(item),
      freesBytes: bytesFreed(item, queuedRow.deletion_action),
      eligibleAt: item.marked_at,
      deleteAt: item.delete_after,
      queued: true,
      eligibleNow: false,
      ruleId,
      ruleName: ruleId !== null ? (ruleNames.get(ruleId) ?? rulesRepo.rules.getById(ruleId)?.name ?? null) : null,
      certainty: 'predictable',
      reasons: [],
    });
  }

  // Items protected in the library carry their own status and never reach the scan.
  skipped.protected += mediaItemsRepo.fetchAll({ status: 'protected' as MediaItem['status'] }).length;

  if (rules.length > 0) {
    for (const item of mediaItemsRepo.fetchAll({ status: 'monitored' as MediaItem['status'] })) {
      if (item.is_protected) {
        skipped.protected++;
        continue;
      }
      if (exclusionPatterns.length > 0 && matchesExclusionPattern(item, exclusionPatterns)) {
        skipped.excluded++;
        continue;
      }
      const match = forecastItem(item, rules, opts);
      if (!match) continue;
      if (match.rule.action !== 'delete') {
        // A flag or notify rule wins first, so nothing deletes it.
        skipped.flagOrNotify++;
        continue;
      }
      const eligibleMs = now.getTime() + match.dayOffset * DAY_MS;
      const grace = match.rule.grace_period_days ?? 7;
      items.push({
        ...entryBase(item),
        freesBytes: bytesFreed(item, match.rule.deletion_action),
        eligibleAt: iso(eligibleMs),
        deleteAt: iso(eligibleMs + grace * DAY_MS),
        queued: false,
        eligibleNow: match.dayOffset === 0,
        ruleId: match.rule.id,
        ruleName: match.rule.name,
        certainty: match.certainty,
        reasons: match.reasons,
      });
    }
  }

  items.sort((a, b) => a.deleteAt.localeCompare(b.deleteAt) || a.title.localeCompare(b.title));

  let storage: ForecastResult['storage'] = { configured: false, source: null, freeBytes: null, totalBytes: null, driveCount: 0 };
  try {
    const stats = await getStorageStats();
    if (stats.configured) {
      storage = {
        configured: true,
        source: stats.source,
        freeBytes: stats.freeCapacity ?? null,
        totalBytes: stats.totalCapacity ?? null,
        driveCount: stats.disks?.length ?? 0,
      };
    }
  } catch (error) {
    logger.warn('Forecast could not read storage', { message: (error as Error).message });
  }

  const result: ForecastResult = {
    generatedAt: now.toISOString(),
    horizonDays: FORECAST_MAX_DAYS,
    items,
    rules: enabledRules.filter((r) => r.action === 'delete').map((r) => ({ id: r.id, name: r.name })),
    skipped,
    deleteRuleCount: enabledRules.filter((r) => r.action === 'delete').length,
    storage,
    scanEnabled: settingsRepo.getValue('schedule_enabled') !== 'false',
    autoProcess: settingsRepo.getValue('schedule_autoProcess') !== 'false',
    diskPressureActive:
      settingsRepo.getBoolean('diskPressure_enabled', false) && !settingsRepo.getBoolean('diskPressure_observeOnly', true),
  };
  if (!options.now) cache = { at: Date.now(), result };
  return result;
}
