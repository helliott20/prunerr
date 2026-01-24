import type { MediaItem } from '../types';
import type { ExtendedRuleCondition, ExtendedMediaItem, ConditionType } from './types';
import logger from '../utils/logger';

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Calculate the number of days between two dates
 */
function daysBetween(date1: Date, date2: Date): number {
  const oneDay = 24 * 60 * 60 * 1000;
  return Math.floor(Math.abs((date1.getTime() - date2.getTime()) / oneDay));
}

/**
 * Parse resolution string to numeric value
 */
function parseResolution(resolution: string | null | undefined): number | undefined {
  if (!resolution) return undefined;

  const lower = resolution.toLowerCase();

  // Handle common resolution formats
  if (lower.includes('4k') || lower.includes('2160')) return 2160;
  if (lower.includes('1080')) return 1080;
  if (lower.includes('720')) return 720;
  if (lower.includes('480')) return 480;
  if (lower.includes('sd') || lower.includes('576')) return 576;

  // Try to extract numeric value
  const match = resolution.match(/(\d+)/);
  if (match && match[1]) {
    return parseInt(match[1], 10);
  }

  return undefined;
}

/**
 * Convert file size from bytes to GB
 */
function bytesToGB(bytes: number | null | undefined): number | undefined {
  if (bytes === null || bytes === undefined) return undefined;
  return bytes / (1024 * 1024 * 1024);
}

/**
 * Extend a media item with computed properties for rule evaluation
 */
export function extendMediaItem(item: MediaItem): ExtendedMediaItem {
  const now = new Date();

  const extended: ExtendedMediaItem = {
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

  return extended;
}

// ============================================================================
// Condition Evaluators
// ============================================================================

/**
 * Evaluate: Item not watched in X days
 */
export function evaluateNotWatchedDays(
  item: ExtendedMediaItem,
  value: number
): boolean {
  // If never watched, consider it as matching (not watched for infinite days)
  if (!item.last_watched_at) {
    logger.debug(`Item "${item.title}" has never been watched, condition matches`);
    return true;
  }

  const daysSince = item.daysSinceLastWatched ?? 0;
  const matches = daysSince >= value;

  logger.debug(
    `Item "${item.title}" last watched ${daysSince} days ago, threshold: ${value}, matches: ${matches}`
  );

  return matches;
}

/**
 * Evaluate: Play count below threshold
 */
export function evaluatePlayCountLessThan(
  item: ExtendedMediaItem,
  value: number
): boolean {
  const matches = item.play_count < value;

  logger.debug(
    `Item "${item.title}" play count: ${item.play_count}, threshold: ${value}, matches: ${matches}`
  );

  return matches;
}

/**
 * Evaluate: File size above threshold (in GB)
 */
export function evaluateFileSizeGreaterThan(
  item: ExtendedMediaItem,
  value: number
): boolean {
  if (item.fileSizeGB === null || item.fileSizeGB === undefined) {
    logger.debug(`Item "${item.title}" has no file size data, condition does not match`);
    return false;
  }

  const matches = item.fileSizeGB > value;

  logger.debug(
    `Item "${item.title}" file size: ${item.fileSizeGB.toFixed(2)}GB, threshold: ${value}GB, matches: ${matches}`
  );

  return matches;
}

/**
 * Evaluate: Resolution below threshold
 */
export function evaluateResolutionLessThan(
  item: ExtendedMediaItem,
  value: number
): boolean {
  if (item.resolutionValue === null || item.resolutionValue === undefined) {
    logger.debug(`Item "${item.title}" has no resolution data, condition does not match`);
    return false;
  }

  const matches = item.resolutionValue < value;

  logger.debug(
    `Item "${item.title}" resolution: ${item.resolutionValue}p, threshold: ${value}p, matches: ${matches}`
  );

  return matches;
}

/**
 * Evaluate: Item added more than X days ago
 */
export function evaluateAddedDaysAgo(
  item: ExtendedMediaItem,
  value: number
): boolean {
  if (!item.added_at) {
    logger.debug(`Item "${item.title}" has no added_at date, condition does not match`);
    return false;
  }

  const daysSince = item.daysSinceAdded ?? 0;
  const matches = daysSince >= value;

  logger.debug(
    `Item "${item.title}" added ${daysSince} days ago, threshold: ${value}, matches: ${matches}`
  );

  return matches;
}

/**
 * Evaluate: Genre matching
 */
export function evaluateGenreIs(
  item: ExtendedMediaItem,
  value: string | string[]
): boolean {
  if (!item.genres || item.genres.length === 0) {
    logger.debug(`Item "${item.title}" has no genre data, condition does not match`);
    return false;
  }

  const targetGenres = Array.isArray(value) ? value : [value];
  const itemGenres = item.genres.map((g) => g.toLowerCase());
  const matches = targetGenres.some((genre) =>
    itemGenres.includes(genre.toLowerCase())
  );

  logger.debug(
    `Item "${item.title}" genres: [${item.genres.join(', ')}], target: [${targetGenres.join(', ')}], matches: ${matches}`
  );

  return matches;
}

/**
 * Evaluate: Genre not matching
 */
export function evaluateGenreIsNot(
  item: ExtendedMediaItem,
  value: string | string[]
): boolean {
  if (!item.genres || item.genres.length === 0) {
    // No genres means it doesn't have the excluded genre
    logger.debug(`Item "${item.title}" has no genre data, condition matches by default`);
    return true;
  }

  const excludedGenres = Array.isArray(value) ? value : [value];
  const itemGenres = item.genres.map((g) => g.toLowerCase());
  const hasExcludedGenre = excludedGenres.some((genre) =>
    itemGenres.includes(genre.toLowerCase())
  );

  logger.debug(
    `Item "${item.title}" genres: [${item.genres.join(', ')}], excluded: [${excludedGenres.join(', ')}], matches: ${!hasExcludedGenre}`
  );

  return !hasExcludedGenre;
}

/**
 * Evaluate: Release year before threshold
 */
export function evaluateYearBefore(
  item: ExtendedMediaItem,
  value: number
): boolean {
  if (item.year === undefined || item.year === null) {
    logger.debug(`Item "${item.title}" has no year data, condition does not match`);
    return false;
  }

  const matches = item.year < value;

  logger.debug(
    `Item "${item.title}" year: ${item.year}, threshold: before ${value}, matches: ${matches}`
  );

  return matches;
}

/**
 * Evaluate: Release year after threshold
 */
export function evaluateYearAfter(
  item: ExtendedMediaItem,
  value: number
): boolean {
  if (item.year === undefined || item.year === null) {
    logger.debug(`Item "${item.title}" has no year data, condition does not match`);
    return false;
  }

  const matches = item.year > value;

  logger.debug(
    `Item "${item.title}" year: ${item.year}, threshold: after ${value}, matches: ${matches}`
  );

  return matches;
}

/**
 * Evaluate: Rating below threshold
 */
export function evaluateRatingLessThan(
  item: ExtendedMediaItem,
  value: number
): boolean {
  if (item.rating === undefined || item.rating === null) {
    logger.debug(`Item "${item.title}" has no rating data, condition does not match`);
    return false;
  }

  const matches = item.rating < value;

  logger.debug(
    `Item "${item.title}" rating: ${item.rating}, threshold: ${value}, matches: ${matches}`
  );

  return matches;
}

/**
 * Evaluate: Media type matching
 */
export function evaluateTypeIs(
  item: ExtendedMediaItem,
  value: string | string[]
): boolean {
  const targetTypes = Array.isArray(value) ? value : [value];
  const matches = targetTypes.some(
    (type) => type.toLowerCase() === item.type.toLowerCase()
  );

  logger.debug(
    `Item "${item.title}" type: ${item.type}, target: [${targetTypes.join(', ')}], matches: ${matches}`
  );

  return matches;
}

// ============================================================================
// Main Condition Evaluator
// ============================================================================

/**
 * Evaluate a single condition against a media item
 */
export function evaluateCondition(
  item: MediaItem,
  condition: ExtendedRuleCondition
): boolean {
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
        return evaluateGenreIs(
          extendedItem,
          condition.value as string | string[]
        );

      case 'genre_is_not':
        return evaluateGenreIsNot(
          extendedItem,
          condition.value as string | string[]
        );

      case 'year_before':
        return evaluateYearBefore(extendedItem, Number(condition.value));

      case 'year_after':
        return evaluateYearAfter(extendedItem, Number(condition.value));

      case 'rating_less_than':
        return evaluateRatingLessThan(extendedItem, Number(condition.value));

      case 'type_is':
        return evaluateTypeIs(
          extendedItem,
          condition.value as string | string[]
        );

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
 * Evaluate multiple conditions with AND/OR logic
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
    if (result) {
      matchedConditions.push(condition);
    }

    // Short-circuit evaluation
    if (logic === 'AND' && !result) {
      return { matched: false, matchedConditions };
    }
    if (logic === 'OR' && result) {
      return { matched: true, matchedConditions };
    }
  }

  // For AND: all must match (we got here without returning false)
  // For OR: none matched (we got here without returning true)
  const matched = logic === 'AND';

  return { matched, matchedConditions: matched ? matchedConditions : [] };
}
