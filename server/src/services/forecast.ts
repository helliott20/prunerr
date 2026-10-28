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
import unraidSnapshotsRepo, { type CapacitySource } from '../db/repositories/unraidSnapshots';
import { toThumbnailUrl } from '../utils/posterUrl';
import logger from '../utils/logger';
import type { MediaItem, Rule } from '../types';
import type { ConditionNode } from '../rules/types';

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
    /** How fast new downloads fill the disk, from capacity snapshots; null until there's enough history. */
    growth: StorageGrowth | null;
  };
  scanEnabled: boolean;
  autoProcess: boolean;
  diskPressureActive: boolean;
}

export interface StorageGrowth {
  /** Bytes added per day by new downloads, before anything is deleted. */
  bytesPerDay: number;
  /** Days of snapshots the rate is measured over. */
  measuredDays: number;
}

/** Look back this far for capacity snapshots, and need at least this much. */
const GROWTH_WINDOW_DAYS = 180;
const GROWTH_MIN_DAYS = 14;

/** SQLite's "YYYY-MM-DD HH:MM:SS" (UTC) as a Date. */
function sqliteDate(value: string): Date {
  return new Date(value.includes('T') ? value : `${value.replace(' ', 'T')}Z`);
}

/**
 * How fast downloads fill the disk: the rises in used space from one daily
 * snapshot to the next, added up and spread over the days measured. Falls
 * (deletions, whether Prunerr's or anyone's) are skipped rather than added
 * back, so nothing depends on how big a deletion was logged as. Steps where
 * the disk's size changed, or used space leapt by more than a tenth of it,
 * are a drive added, an array not yet mounted or a bad reading, not downloads.
 */
export function measureGrowth(source: CapacitySource): StorageGrowth | null {
  const snapshots = unraidSnapshotsRepo.getSince(GROWTH_WINDOW_DAYS, source);
  if (snapshots.length < 2) return null;
  const first = snapshots[0]!;
  const last = snapshots[snapshots.length - 1]!;
  const days = (sqliteDate(last.captured_at).getTime() - sqliteDate(first.captured_at).getTime()) / DAY_MS;
  if (!(days >= GROWTH_MIN_DAYS)) return null;

  let added = 0;
  for (let i = 1; i < snapshots.length; i++) {
    const prev = snapshots[i - 1]!;
    const cur = snapshots[i]!;
    const rise = cur.used_bytes - prev.used_bytes;
    if (rise <= 0) continue;
    const resized = Math.abs(cur.total_bytes - prev.total_bytes) > prev.total_bytes * 0.01;
    if (resized || rise > cur.total_bytes * 0.1) continue;
    added += rise;
  }
  return { bytesPerDay: added / days, measuredDays: Math.round(days) };
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

/** Everything the Forecast page shows, out to five years. */
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

  let storage: ForecastResult['storage'] = {
    configured: false,
    source: null,
    freeBytes: null,
    totalBytes: null,
    driveCount: 0,
    growth: null,
  };
  try {
    const stats = await getStorageStats();
    if (stats.configured) {
      storage = {
        configured: true,
        source: stats.source,
        freeBytes: stats.freeCapacity ?? null,
        totalBytes: stats.totalCapacity ?? null,
        driveCount: stats.disks?.length ?? 0,
        growth: stats.source ? measureGrowth(stats.source) : null,
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

export interface RuleForecastTotals {
  items: number;
  bytes: number;
  predictableBytes: number;
}

/** Points the rule-editor forecast reports: the next scan, three months, a year. */
export const RULE_FORECAST_DAYS = [0, 90, 365] as const;

export interface RuleForecastPoint extends RuleForecastTotals {
  /** Days from now; 0 is the next scan. */
  day: number;
}

export interface RuleForecastInput {
  root: ConditionNode;
  mediaType?: string;
  libraryKeys?: string[];
  deletionAction?: string | null;
}

/**
 * What one rule would make eligible by each of RULE_FORECAST_DAYS, judged on
 * its own: the "what if" in the rule editor. Other rules don't get a say, so
 * an item a higher-priority rule would take first still counts here. Items
 * already in the queue aren't counted; they're not new work. Totals are
 * running: the year includes the next scan.
 */
export function forecastSingleRule(input: RuleForecastInput, options: { now?: Date } = {}): RuleForecastPoint[] {
  const now = options.now ?? new Date();
  const horizonDays: number = RULE_FORECAST_DAYS[RULE_FORECAST_DAYS.length - 1] ?? 365;
  const rule = {
    id: -1,
    name: '',
    action: 'delete',
    media_type: input.mediaType === 'tv' ? 'show' : input.mediaType || 'all',
    library_keys: input.libraryKeys ?? [],
    deletion_action: input.deletionAction ?? null,
  } as unknown as Rule;
  const rules = [{ rule, root: input.root }];
  const ctx = buildEvaluationContext();
  const inProgress = loadInProgressConfig();
  const exclusionPatterns = loadExclusionPatterns();
  const opts = { now, horizonDays, ctx: { ...ctx, now }, inProgress };

  const points: RuleForecastPoint[] = RULE_FORECAST_DAYS.map((day) => ({ day, items: 0, bytes: 0, predictableBytes: 0 }));
  for (const item of mediaItemsRepo.fetchAll({ status: 'monitored' as MediaItem['status'] })) {
    if (item.is_protected) continue;
    if (exclusionPatterns.length > 0 && matchesExclusionPattern(item, exclusionPatterns)) continue;
    const match = forecastItem(item, rules, opts);
    if (!match) continue;
    const bytes = bytesFreed(item, input.deletionAction);
    for (const point of points) {
      if (match.dayOffset > point.day) continue;
      point.items++;
      point.bytes += bytes;
      if (match.certainty === 'predictable') point.predictableBytes += bytes;
    }
  }
  return points;
}
