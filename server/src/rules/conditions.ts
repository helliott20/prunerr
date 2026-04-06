import type { MediaItem } from '../types';
import type {
  ConditionLeaf,
  ConditionNode,
  ExtendedRuleCondition,
  ExtendedMediaItem,
  ConditionType,
} from './types';
import logger from '../utils/logger';

// ============================================================================
// Evaluation Context (for JOIN-requiring evaluators)
// ============================================================================

/**
 * Shape of the collections repository used by evaluators. Kept narrow so
 * evaluators can be tested with a tiny mock.
 */
export interface CollectionsRepoLike {
  findAll(): Array<{ id: number; is_protected: number | boolean }>;
  findProtectedContainingItem(mediaItemId: number): Array<{ id: number }>;
  getMediaItemIds(collectionId: number): number[];
}

/**
 * Pre-built lookup: ratingKey → username → most-recent watched date.
 * The evaluation context builds this once per run for performance.
 */
export type WatchLookup = Map<string, Map<string, Date>>;

export interface EvaluationContext {
  collectionsRepo?: CollectionsRepoLike;
  /**
   * Pre-fetched watch history keyed by plex rating key and username.
   * Evaluators only read this — they never query the DB themselves.
   */
  watchLookup?: WatchLookup;
  now?: Date;
  /** Runtime cache for collection membership lookups — avoids repeated queries. */
  _collectionCache?: Map<string, Set<number>>;
}

// ============================================================================
// Helper Functions
// ============================================================================

function daysBetween(date1: Date, date2: Date): number {
  const oneDay = 24 * 60 * 60 * 1000;
  return Math.floor(Math.abs((date1.getTime() - date2.getTime()) / oneDay));
}

function parseResolution(resolution: string | null | undefined): number | undefined {
  if (!resolution) return undefined;
  const lower = resolution.toLowerCase();
  if (lower.includes('4k') || lower.includes('2160')) return 2160;
  if (lower.includes('1080')) return 1080;
  if (lower.includes('720')) return 720;
  if (lower.includes('480')) return 480;
  if (lower.includes('sd') || lower.includes('576')) return 576;
  const match = resolution.match(/(\d+)/);
  if (match && match[1]) return parseInt(match[1], 10);
  return undefined;
}

function bytesToGB(bytes: number | null | undefined): number | undefined {
  if (bytes === null || bytes === undefined) return undefined;
  return bytes / (1024 * 1024 * 1024);
}

export function extendMediaItem(item: MediaItem): ExtendedMediaItem {
  const now = new Date();
  return {
    ...item,
    daysSinceLastWatched: item.last_watched_at
      ? daysBetween(now, new Date(item.last_watched_at))
      : undefined,
    daysSinceAdded: item.added_at
      ? daysBetween(now, new Date(item.added_at))
      : undefined,
    fileSizeGB: bytesToGB(item.file_size),
    resolutionValue: parseResolution(item.resolution),
  };
}

// ============================================================================
// Field Value Resolution
// ============================================================================

type FieldValue = unknown;

/**
 * Resolve a field name to a value on the media item. Supports both direct
 * columns and computed fields.
 */
export function resolveFieldValue(item: MediaItem, field: string): FieldValue {
  switch (field) {
    case 'days_since_added': {
      if (!item.added_at) return null;
      return Math.floor(
        (Date.now() - new Date(item.added_at).getTime()) / (1000 * 60 * 60 * 24)
      );
    }
    case 'days_since_watched': {
      if (!item.last_watched_at) return null;
      return Math.floor(
        (Date.now() - new Date(item.last_watched_at).getTime()) / (1000 * 60 * 60 * 24)
      );
    }
    case 'size_gb':
      return item.file_size ? item.file_size / (1024 * 1024 * 1024) : null;
    case 'resolution_number':
      return parseResolution(item.resolution) ?? 0;
    case 'never_watched':
      return item.play_count === 0;
    case 'watched_by_count': {
      try {
        const wb = item.watched_by;
        if (!wb) return 0;
        const parsed = typeof wb === 'string' ? JSON.parse(wb) : wb;
        return Array.isArray(parsed) ? parsed.length : 0;
      } catch {
        return 0;
      }
    }
    default: {
      const record = item as unknown as Record<string, unknown>;
      if (field in record) return record[field];
      return null;
    }
  }
}

// ============================================================================
// Operator Evaluators (work on resolved field value + condition value)
// ============================================================================

function toNumber(v: unknown): number | null {
  if (typeof v === 'number' && !isNaN(v)) return v;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return isNaN(n) ? null : n;
  }
  return null;
}

function toStringLower(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  return String(v).toLowerCase();
}

function toArray(v: unknown): unknown[] {
  if (Array.isArray(v)) return v;
  if (typeof v === 'string') {
    // Parse JSON array, fallback to comma-split
    try {
      const parsed = JSON.parse(v);
      if (Array.isArray(parsed)) return parsed;
    } catch {
      // ignore
    }
    return v
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return [];
}

function lowerArray(arr: unknown[]): string[] {
  return arr.map((x) => String(x).toLowerCase());
}

function evalOperator(
  operator: string,
  fieldValue: unknown,
  conditionValue: unknown
): boolean {
  switch (operator) {
    // Equality / comparison
    case 'equals':
      return fieldValue === conditionValue;
    case 'not_equals':
      return fieldValue !== conditionValue;
    case 'greater_than': {
      const a = toNumber(fieldValue);
      const b = toNumber(conditionValue);
      return a !== null && b !== null && a > b;
    }
    case 'less_than': {
      const a = toNumber(fieldValue);
      const b = toNumber(conditionValue);
      return a !== null && b !== null && a < b;
    }
    case 'greater_than_or_equal': {
      const a = toNumber(fieldValue);
      const b = toNumber(conditionValue);
      return a !== null && b !== null && a >= b;
    }
    case 'less_than_or_equal': {
      const a = toNumber(fieldValue);
      const b = toNumber(conditionValue);
      return a !== null && b !== null && a <= b;
    }

    // String containment (single-value field, substring match)
    case 'contains': {
      const fv = toStringLower(fieldValue);
      const cv = toStringLower(conditionValue);
      return fv !== null && cv !== null && fv.includes(cv);
    }
    case 'not_contains': {
      if (fieldValue === null || fieldValue === undefined) return true;
      // Array field: check membership
      if (Array.isArray(fieldValue)) {
        const haystack = lowerArray(fieldValue);
        const needle = String(conditionValue).toLowerCase();
        return !haystack.includes(needle);
      }
      const fv = String(fieldValue).toLowerCase();
      const cv = String(conditionValue).toLowerCase();
      return !fv.includes(cv);
    }

    // Null checks
    case 'is_empty':
    case 'is_null':
      return (
        fieldValue === null ||
        fieldValue === undefined ||
        fieldValue === '' ||
        (Array.isArray(fieldValue) && fieldValue.length === 0)
      );
    case 'is_not_empty':
    case 'is_not_null':
      return !(
        fieldValue === null ||
        fieldValue === undefined ||
        fieldValue === '' ||
        (Array.isArray(fieldValue) && fieldValue.length === 0)
      );

    // Set membership
    case 'in': {
      const set = lowerArray(toArray(conditionValue));
      const fv = toStringLower(fieldValue);
      return fv !== null && set.includes(fv);
    }
    case 'not_in': {
      const set = lowerArray(toArray(conditionValue));
      const fv = toStringLower(fieldValue);
      return fv === null || !set.includes(fv);
    }

    // Range
    case 'between': {
      const range = toArray(conditionValue);
      if (range.length !== 2) return false;
      const min = toNumber(range[0]);
      const max = toNumber(range[1]);
      const v = toNumber(fieldValue);
      return (
        v !== null && min !== null && max !== null && v >= min && v <= max
      );
    }

    // Regex (already validated at parse time via safe-regex)
    case 'regex_match': {
      const fv = toStringLower(fieldValue);
      if (fv === null) return false;
      try {
        const re = new RegExp(String(conditionValue), 'i');
        return re.test(fv);
      } catch {
        return false;
      }
    }

    // Array field matching
    case 'matches_any':
    case 'contains_any': {
      const haystack = lowerArray(
        Array.isArray(fieldValue) ? fieldValue : toArray(fieldValue)
      );
      const needles = lowerArray(toArray(conditionValue));
      return needles.some((n) => haystack.includes(n));
    }
    case 'matches_all':
    case 'contains_all': {
      const haystack = lowerArray(
        Array.isArray(fieldValue) ? fieldValue : toArray(fieldValue)
      );
      const needles = lowerArray(toArray(conditionValue));
      return needles.every((n) => haystack.includes(n));
    }

    default:
      logger.warn(`Unknown operator: ${operator}`);
      return false;
  }
}

// ============================================================================
// Specialized Condition Evaluators (JOIN-requiring)
// ============================================================================

/**
 * Get or build a cached Set of media item IDs for a given cache key.
 * Avoids re-querying the same collection/protection data per item.
 */
function getCachedSet(
  ctx: EvaluationContext,
  key: string,
  build: () => number[]
): Set<number> {
  if (!ctx._collectionCache) ctx._collectionCache = new Map();
  let cached = ctx._collectionCache.get(key);
  if (!cached) {
    cached = new Set(build());
    ctx._collectionCache.set(key, cached);
  }
  return cached;
}

function evaluateCollectionMembership(
  item: MediaItem,
  operator: string,
  value: unknown,
  ctx: EvaluationContext
): boolean {
  if (!ctx.collectionsRepo) {
    logger.warn('collection_membership condition requires collectionsRepo in context');
    return false;
  }

  switch (operator) {
    case 'in_any_protected': {
      // Cache all protected item IDs across all protected collections
      const protectedIds = getCachedSet(ctx, '_all_protected', () => {
        const allCols = ctx.collectionsRepo!.findAll().filter((c: { is_protected: number | boolean }) => c.is_protected);
        return allCols.flatMap((c: { id: number }) => ctx.collectionsRepo!.getMediaItemIds(c.id));
      });
      return protectedIds.has(item.id);
    }
    case 'not_in_any_protected': {
      const protectedIds = getCachedSet(ctx, '_all_protected', () => {
        const allCols = ctx.collectionsRepo!.findAll().filter((c: { is_protected: number | boolean }) => c.is_protected);
        return allCols.flatMap((c: { id: number }) => ctx.collectionsRepo!.getMediaItemIds(c.id));
      });
      return !protectedIds.has(item.id);
    }
    case 'in_collection_id': {
      const collectionId = toNumber(value);
      if (collectionId === null) return false;
      const memberIds = getCachedSet(ctx, `col_${collectionId}`, () =>
        ctx.collectionsRepo!.getMediaItemIds(collectionId)
      );
      return memberIds.has(item.id);
    }
    default:
      logger.warn(`Unknown collection_membership operator: ${operator}`);
      return false;
  }
}

function evaluateWatchedByUser(
  item: MediaItem,
  operator: string,
  params: Record<string, unknown> | undefined,
  ctx: EvaluationContext
): boolean {
  if (!item.plex_id) return false;
  const username = params && typeof params['username'] === 'string' ? String(params['username']) : '';
  if (!username) {
    logger.warn('watched_by_user condition requires params.username');
    return false;
  }

  const userMap = ctx.watchLookup?.get(item.plex_id);
  const watchedAt = userMap?.get(username);
  const now = ctx.now ?? new Date();
  const days = toNumber(params?.['days']);

  switch (operator) {
    case 'ever_watched':
      return watchedAt !== undefined;
    case 'never_watched':
      return watchedAt === undefined;
    case 'watched_since': {
      if (!watchedAt || days === null) return false;
      const cutoff = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
      return watchedAt >= cutoff;
    }
    case 'not_watched_since': {
      if (days === null) return false;
      const cutoff = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
      if (!watchedAt) return true; // never watched by that user → hasn't watched since
      return watchedAt < cutoff;
    }
    default:
      logger.warn(`Unknown watched_by_user operator: ${operator}`);
      return false;
  }
}

// ============================================================================
// Tree Walker
// ============================================================================

/**
 * Recursively evaluate a condition tree node against a media item.
 */
export function evaluateNode(
  node: ConditionNode,
  item: MediaItem,
  ctx: EvaluationContext = {}
): boolean {
  if (node.kind === 'condition') {
    return evaluateLeaf(node, item, ctx);
  }

  // group node
  const { logic, children } = node;
  if (children.length === 0) {
    // Empty groups: AND is vacuously true, OR is false, NOT(AND()) = false
    if (logic === 'OR') return false;
    return logic === 'AND';
  }

  if (logic === 'AND') {
    for (const child of children) {
      if (!evaluateNode(child, item, ctx)) return false;
    }
    return true;
  }
  if (logic === 'OR') {
    for (const child of children) {
      if (evaluateNode(child, item, ctx)) return true;
    }
    return false;
  }
  // NOT group: negation of AND(children) — equivalent to "any child is false".
  // For the single-child case (most common from the UI), this is !child.
  return !children.every((child) => evaluateNode(child, item, ctx));
}

function evaluateLeaf(
  leaf: ConditionLeaf,
  item: MediaItem,
  ctx: EvaluationContext
): boolean {
  // Specialized fields that need joins
  if (leaf.field === 'collection_membership') {
    return evaluateCollectionMembership(item, leaf.operator, leaf.value, ctx);
  }
  if (leaf.field === 'watched_by_user') {
    return evaluateWatchedByUser(item, leaf.operator, leaf.params, ctx);
  }

  const fieldValue = resolveFieldValue(item, leaf.field);
  return evalOperator(leaf.operator, fieldValue, leaf.value);
}

// ============================================================================
// Legacy Evaluators (retained for backward compatibility)
// ============================================================================

export function evaluateNotWatchedDays(item: ExtendedMediaItem, value: number): boolean {
  if (!item.last_watched_at) return true;
  return (item.daysSinceLastWatched ?? 0) >= value;
}

export function evaluatePlayCountLessThan(item: ExtendedMediaItem, value: number): boolean {
  return item.play_count < value;
}

export function evaluateFileSizeGreaterThan(item: ExtendedMediaItem, value: number): boolean {
  if (item.fileSizeGB === null || item.fileSizeGB === undefined) return false;
  return item.fileSizeGB > value;
}

export function evaluateResolutionLessThan(item: ExtendedMediaItem, value: number): boolean {
  if (item.resolutionValue === null || item.resolutionValue === undefined) return false;
  return item.resolutionValue < value;
}

export function evaluateAddedDaysAgo(item: ExtendedMediaItem, value: number): boolean {
  if (!item.added_at) return false;
  return (item.daysSinceAdded ?? 0) >= value;
}

export function evaluateGenreIs(item: ExtendedMediaItem, value: string | string[]): boolean {
  if (!item.genres || item.genres.length === 0) return false;
  const targets = Array.isArray(value) ? value : [value];
  const itemGenres = item.genres.map((g) => g.toLowerCase());
  return targets.some((g) => itemGenres.includes(g.toLowerCase()));
}

export function evaluateGenreIsNot(item: ExtendedMediaItem, value: string | string[]): boolean {
  if (!item.genres || item.genres.length === 0) return true;
  const excluded = Array.isArray(value) ? value : [value];
  const itemGenres = item.genres.map((g) => g.toLowerCase());
  return !excluded.some((g) => itemGenres.includes(g.toLowerCase()));
}

export function evaluateYearBefore(item: ExtendedMediaItem, value: number): boolean {
  if (item.year === undefined || item.year === null) return false;
  return item.year < value;
}

export function evaluateYearAfter(item: ExtendedMediaItem, value: number): boolean {
  if (item.year === undefined || item.year === null) return false;
  return item.year > value;
}

export function evaluateRatingLessThan(item: ExtendedMediaItem, value: number): boolean {
  if (item.rating === undefined || item.rating === null) return false;
  return item.rating < value;
}

export function evaluateTypeIs(item: ExtendedMediaItem, value: string | string[]): boolean {
  const targets = Array.isArray(value) ? value : [value];
  return targets.some((t) => t.toLowerCase() === item.type.toLowerCase());
}

/**
 * Legacy single-condition evaluator (type-based). Retained for compat.
 */
export function evaluateCondition(item: MediaItem, condition: ExtendedRuleCondition): boolean {
  const extendedItem = extendMediaItem(item);
  try {
    switch (condition.type as ConditionType) {
      case 'not_watched_days':
        return evaluateNotWatchedDays(extendedItem, Number(condition.value));
      case 'play_count_less_than':
        return evaluatePlayCountLessThan(extendedItem, Number(condition.value));
      case 'file_size_greater_than':
        return evaluateFileSizeGreaterThan(extendedItem, Number(condition.value));
      case 'resolution_less_than':
        return evaluateResolutionLessThan(extendedItem, Number(condition.value));
      case 'added_days_ago':
        return evaluateAddedDaysAgo(extendedItem, Number(condition.value));
      case 'genre_is':
        return evaluateGenreIs(extendedItem, condition.value as string | string[]);
      case 'genre_is_not':
        return evaluateGenreIsNot(extendedItem, condition.value as string | string[]);
      case 'year_before':
        return evaluateYearBefore(extendedItem, Number(condition.value));
      case 'year_after':
        return evaluateYearAfter(extendedItem, Number(condition.value));
      case 'rating_less_than':
        return evaluateRatingLessThan(extendedItem, Number(condition.value));
      case 'type_is':
        return evaluateTypeIs(extendedItem, condition.value as string | string[]);
      default:
        logger.warn(`Unknown condition type: ${condition.type}`);
        return false;
    }
  } catch (error) {
    logger.error(`Error evaluating condition ${condition.type}:`, error);
    return false;
  }
}

/**
 * Legacy multi-condition evaluator.
 */
export function evaluateConditions(
  item: MediaItem,
  conditions: ExtendedRuleCondition[],
  logic: 'AND' | 'OR' = 'AND'
): { matched: boolean; matchedConditions: ExtendedRuleCondition[] } {
  if (conditions.length === 0) {
    return { matched: false, matchedConditions: [] };
  }
  const matchedConditions: ExtendedRuleCondition[] = [];
  for (const condition of conditions) {
    const result = evaluateCondition(item, condition);
    if (result) matchedConditions.push(condition);
    if (logic === 'AND' && !result) return { matched: false, matchedConditions };
    if (logic === 'OR' && result) return { matched: true, matchedConditions };
  }
  const matched = logic === 'AND';
  return { matched, matchedConditions: matched ? matchedConditions : [] };
}
