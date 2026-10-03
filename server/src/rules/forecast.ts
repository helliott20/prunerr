import type { MediaItem, Rule } from '../types';
import type { ConditionLeaf, ConditionNode } from './types';
import { evaluateNode, resolveFieldValue, viewersOf, type EvaluationContext } from './conditions';
import { upgradeToV2 } from './migration';
import { ruleScopeMatches } from './scope';
import { isProtectedInProgress, type InProgressConfig } from './inProgress';
import { parseEpisodeProgress } from './watchProgress';
import logger from '../utils/logger';

/**
 * Forecast: when each item in the library will first be matched by a rule,
 * if nothing about it changes but the date.
 *
 * Rules only move with time through a few conditions — days since added or
 * watched, when a person last watched, and when a show someone stopped
 * part-way through counts as stalled (which also lifts in-progress
 * protection). An item's match can only change on the days those thresholds
 * are crossed, so instead of re-running every rule for every day, each item
 * is checked on today and on each of its crossing days, in order. The first
 * day a rule matches is its eligibility date.
 *
 * It mirrors the scheduled scan: monitored items only, protected and
 * excluded items skipped, rules tried by priority with the first match
 * winning, and in-progress protection judged on the day itself.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** Furthest ahead the forecast looks. */
export const FORECAST_MAX_DAYS = 730;

/** Conditions whose answer changes when someone watches, requests or rates. */
const CONDITIONAL_FIELDS = new Set([
  'play_count',
  'never_watched',
  'days_since_watched',
  'last_watched_at',
  'watched_by',
  'watched_by_user',
  'watched_by_count',
  'watch_progress',
  'in_progress_for',
  'watched_episode_count',
  'percent_watched',
  'collection_membership',
  'requested_by',
  'rating_imdb',
  'rating_tmdb',
  'rating_rt',
]);

export type ForecastCertainty = 'predictable' | 'conditional';

export interface ForecastReason {
  field: string;
  operator: string;
  value: unknown;
  params?: Record<string, unknown>;
  /** The item's value for the field on the eligibility day, when it's a plain field. */
  actual: unknown;
}

export interface ForecastRuleInput {
  rule: Rule;
  root: ConditionNode;
}

export interface ForecastMatch {
  /** Whole days from now until the first match; 0 = the next scan. */
  dayOffset: number;
  rule: Rule;
  certainty: ForecastCertainty;
  reasons: ForecastReason[];
}

export interface ForecastOptions {
  now: Date;
  horizonDays: number;
  ctx: EvaluationContext;
  inProgress: InProgressConfig;
}

/** Parse each rule's stored conditions once. Rules that can't be read are dropped. */
export function prepareRules(rules: Rule[]): ForecastRuleInput[] {
  const out: ForecastRuleInput[] = [];
  for (const rule of rules) {
    try {
      out.push({ rule, root: upgradeToV2(JSON.parse(rule.conditions)).root });
    } catch (error) {
      logger.warn(`Forecast skipped rule "${rule.name}": its conditions could not be read`, {
        message: (error as Error).message,
      });
    }
  }
  return out;
}

export function leavesOf(node: ConditionNode): ConditionLeaf[] {
  if (node.kind === 'condition') return [node];
  return node.children.flatMap(leavesOf);
}

function numbersIn(value: unknown): number[] {
  const list = Array.isArray(value) ? value : [value];
  return list
    .map((v) => (typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN))
    .filter((n) => Number.isFinite(n));
}

/** Days from now until `at + days`, as candidate offsets around the crossing. */
function crossingOffsets(at: Date | null, days: number, now: Date): number[] {
  if (!at || Number.isNaN(at.getTime())) return [];
  const crossing = Math.ceil((at.getTime() + days * DAY_MS - now.getTime()) / DAY_MS);
  return [crossing - 1, crossing, crossing + 1];
}

function dateOrNull(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * The days an item's rules (and its in-progress protection) could change
 * their answer, within the horizon. Always includes today.
 */
export function candidateOffsets(
  item: MediaItem,
  rules: ForecastRuleInput[],
  opts: Pick<ForecastOptions, 'now' | 'horizonDays' | 'ctx' | 'inProgress'>
): number[] {
  const { now, horizonDays, ctx } = opts;
  const recentDays = opts.inProgress.recentDays;
  const offsets = new Set<number>([0]);
  const add = (list: number[]) => list.forEach((d) => offsets.add(d));

  const added = dateOrNull(item.added_at);
  const watched = dateOrNull(item.last_watched_at);
  let progressAdded = false;
  const addProgressCrossings = () => {
    if (progressAdded) return;
    progressAdded = true;
    // A show stops being in progress `recentDays` after each viewer's last play.
    const perPerson = parseEpisodeProgress(item);
    if (perPerson) {
      for (const p of Object.values(perPerson)) add(crossingOffsets(dateOrNull(p.lastWatched), recentDays, now));
    }
    add(crossingOffsets(watched, recentDays, now));
  };

  if (opts.inProgress.protect && item.type === 'show') addProgressCrossings();

  for (const { root } of rules) {
    for (const leaf of leavesOf(root)) {
      switch (leaf.field) {
        case 'days_since_added':
          for (const n of numbersIn(leaf.value)) add(crossingOffsets(added, n, now));
          break;
        case 'days_since_watched':
          for (const n of numbersIn(leaf.value)) add(crossingOffsets(watched, n, now));
          break;
        case 'watched_by_user': {
          const days = numbersIn(leaf.params?.['days'])[0];
          const username = typeof leaf.params?.['username'] === 'string' ? (leaf.params['username'] as string) : '';
          if (days === undefined || !username) break;
          add(crossingOffsets(viewersOf(item, ctx)?.get(username) ?? null, days, now));
          break;
        }
        case 'watch_progress':
        case 'in_progress_for':
          addProgressCrossings();
          break;
      }
    }
  }

  return [...offsets].filter((d) => d >= 0 && d <= horizonDays).sort((a, b) => a - b);
}

function certaintyOf(root: ConditionNode, delayedByInProgress: boolean): ForecastCertainty {
  if (delayedByInProgress) return 'conditional';
  return leavesOf(root).some((l) => CONDITIONAL_FIELDS.has(l.field)) ? 'conditional' : 'predictable';
}

const SPECIAL_FIELDS = new Set(['watched_by', 'watched_by_user', 'collection_membership', 'in_progress_for', 'watch_progress']);

function reasonsFor(root: ConditionNode, item: MediaItem, at: Date): ForecastReason[] {
  return leavesOf(root)
    .slice(0, 6)
    .map((leaf) => ({
      field: leaf.field,
      operator: leaf.operator,
      value: leaf.value,
      ...(leaf.params ? { params: leaf.params } : {}),
      actual: SPECIAL_FIELDS.has(leaf.field) ? null : resolveFieldValue(item, leaf.field, at),
    }));
}

/**
 * The first day within the horizon a rule matches this item, and which rule
 * — or null when none does. Assumes the item isn't already queued, protected
 * or excluded.
 */
export function forecastItem(item: MediaItem, rules: ForecastRuleInput[], opts: ForecastOptions): ForecastMatch | null {
  const offsets = candidateOffsets(item, rules, opts);
  let blockedByInProgress = false;

  for (const dayOffset of offsets) {
    const at = new Date(opts.now.getTime() + dayOffset * DAY_MS);
    if (isProtectedInProgress(item, opts.inProgress, at)) {
      blockedByInProgress = true;
      continue;
    }
    const ctx: EvaluationContext = { ...opts.ctx, now: at };
    for (const { rule, root } of rules) {
      if (!ruleScopeMatches(rule, item)) continue;
      if (!evaluateNode(root, item, ctx)) continue;
      // The scan applies the first matching rule only, whatever it does.
      return {
        dayOffset,
        rule,
        certainty: certaintyOf(root, blockedByInProgress),
        reasons: reasonsFor(root, item, at),
      };
    }
  }
  return null;
}

/** Bytes a rule's deletion action frees: none when it only unmonitors. */
export function bytesFreed(item: Pick<MediaItem, 'file_size'>, deletionAction: string | null | undefined): number {
  if (deletionAction === 'unmonitor_only') return 0;
  return item.file_size || 0;
}
