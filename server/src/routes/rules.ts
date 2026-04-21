import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import safeRegex from 'safe-regex';
import rulesRepo from '../db/repositories/rules';
import mediaItemsRepo from '../db/repositories/mediaItems';
import collectionsRepo from '../db/repositories/collections';
import { getDatabase } from '../db/index';
import { CreateRuleSchema, UpdateRuleSchema, RuleCondition, MediaItem, Rule } from '../types';
import {
  evaluateNode,
  evaluateRuleConditions,
  upgradeToV2,
  type EvaluationContext,
} from '../rules/engine';
import type { WatchLookup } from '../rules/conditions';
import type { ConditionNode } from '../rules/types';
import logger from '../utils/logger';
import { formatBytes } from '../utils/format';

// ============================================================================
// V2 Condition Schema + Safe Regex Validation
// ============================================================================

const REGEX_OPERATORS = new Set(['regex_match']);

/**
 * Recursively validate a v2 condition tree, rejecting unsafe regex patterns.
 * Throws a ZodError-shaped object on the first unsafe pattern found.
 */
function validateConditionTree(node: unknown, path: string[] = []): void {
  if (!node || typeof node !== 'object') {
    throw new Error(`Invalid condition node at ${path.join('.') || 'root'}`);
  }
  const n = node as Record<string, unknown>;
  if (n['kind'] === 'condition') {
    if (REGEX_OPERATORS.has(String(n['operator']))) {
      const pattern = String(n['value'] ?? '');
      if (!safeRegex(pattern)) {
        throw new UnsafeRegexError(pattern, path);
      }
    }
    return;
  }
  if (n['kind'] === 'group' && Array.isArray(n['children'])) {
    if (path.length > 40) {
      throw new Error(`Condition tree exceeds maximum nesting depth at ${path.join('.')}`);
    }
    (n['children'] as unknown[]).forEach((child, i) =>
      validateConditionTree(child, [...path, 'children', String(i)])
    );
    return;
  }
  throw new Error(`Unknown node kind at ${path.join('.') || 'root'}`);
}

class UnsafeRegexError extends Error {
  constructor(public readonly pattern: string, public readonly path: string[]) {
    super(`Unsafe regex pattern rejected: ${pattern}`);
  }
}

/**
 * Zod schema for v2 condition tree. Uses z.lazy for recursion.
 */
const ConditionLeafSchema: z.ZodType<unknown> = z.object({
  kind: z.literal('condition'),
  field: z.string().min(1),
  operator: z.string().min(1),
  value: z.unknown(),
  params: z.record(z.string(), z.unknown()).optional(),
});

const ConditionGroupSchema: z.ZodType<unknown> = z.lazy(() =>
  z.object({
    kind: z.literal('group'),
    logic: z.enum(['AND', 'OR', 'NOT']),
    children: z.array(z.union([ConditionLeafSchema, ConditionGroupSchema])),
  })
);

const ConditionNodeSchema: z.ZodType<unknown> = z.union([
  ConditionLeafSchema,
  ConditionGroupSchema,
]);

const V2ConditionsSchema = z.object({
  version: z.literal(2),
  root: ConditionNodeSchema,
});

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Transforms a rule from snake_case (database) to camelCase (client format)
 */
interface ClientRule {
  id: number;
  name: string;
  profileId: number | null;
  type: string;
  mediaType: 'all' | 'movie' | 'tv';
  conditions: string;
  /**
   * v2 parsed condition tree — the stored JSON is upgraded on read so the
   * client always sees the nested-group form.
   */
  conditionsV2: { version: 2; root: ConditionNode };
  action: string;
  enabled: boolean;
  gracePeriodDays: number;
  deletionAction: string;
  resetOverseerr: boolean;
  priority: number;
  createdAt: string;
  updatedAt: string;
}

function toClientRule(rule: Rule): ClientRule {
  // Convert 'show' to 'tv' for client (client uses 'tv', server uses 'show')
  const clientMediaType = rule.media_type === 'show' ? 'tv' : (rule.media_type || 'all');
  let conditionsV2: { version: 2; root: ConditionNode };
  try {
    const parsed = JSON.parse(rule.conditions);
    conditionsV2 = upgradeToV2(parsed) as { version: 2; root: ConditionNode };
  } catch {
    conditionsV2 = { version: 2, root: { kind: 'group', logic: 'AND', children: [] } };
  }
  return {
    id: rule.id,
    name: rule.name,
    profileId: rule.profile_id,
    type: rule.type,
    mediaType: clientMediaType as 'all' | 'movie' | 'tv',
    conditions: rule.conditions,
    conditionsV2,
    action: rule.action,
    enabled: rule.enabled,
    gracePeriodDays: rule.grace_period_days,
    deletionAction: rule.deletion_action,
    resetOverseerr: rule.reset_overseerr,
    priority: rule.priority,
    createdAt: rule.created_at,
    updatedAt: rule.updated_at,
  };
}

/**
 * Evaluates whether a media item matches all the given rule conditions.
 * All conditions must be true for the item to match (AND logic).
 */
function evaluateConditions(item: MediaItem, conditions: RuleCondition[]): boolean {
  if (conditions.length === 0) {
    return false; // No conditions means no match (safety)
  }

  for (const condition of conditions) {
    if (!evaluateSingleCondition(item, condition)) {
      return false;
    }
  }
  return true;
}

/**
 * Evaluates a single condition against a media item.
 */
function evaluateSingleCondition(item: MediaItem, condition: RuleCondition): boolean {
  const { field, operator, value } = condition;

  // Get the field value from the item (handle nested fields like 'type', 'status', etc.)
  const fieldValue = getFieldValue(item, field);

  switch (operator) {
    case 'equals':
      return fieldValue === value;
    case 'not_equals':
      return fieldValue !== value;
    case 'greater_than':
      return typeof fieldValue === 'number' && typeof value === 'number' && fieldValue > value;
    case 'less_than':
      return typeof fieldValue === 'number' && typeof value === 'number' && fieldValue < value;
    case 'contains':
      return typeof fieldValue === 'string' && typeof value === 'string' && fieldValue.toLowerCase().includes(value.toLowerCase());
    case 'not_contains':
      return typeof fieldValue === 'string' && typeof value === 'string' && !fieldValue.toLowerCase().includes(value.toLowerCase());
    case 'is_empty':
      return fieldValue === null || fieldValue === undefined || fieldValue === '';
    case 'is_not_empty':
      return fieldValue !== null && fieldValue !== undefined && fieldValue !== '';
    default:
      logger.warn(`Unknown operator: ${operator}`);
      return false;
  }
}


/**
 * Gets the value of a field from a media item.
 * Supports special computed fields like 'days_since_added', 'days_since_watched'.
 */
function getFieldValue(item: MediaItem, field: string): string | number | boolean | null {
  // Handle special computed fields
  switch (field) {
    case 'days_since_added': {
      if (!item.added_at) return null;
      const addedDate = new Date(item.added_at);
      const now = new Date();
      return Math.floor((now.getTime() - addedDate.getTime()) / (1000 * 60 * 60 * 24));
    }
    case 'days_since_watched': {
      if (!item.last_watched_at) return null;
      const watchedDate = new Date(item.last_watched_at);
      const now = new Date();
      return Math.floor((now.getTime() - watchedDate.getTime()) / (1000 * 60 * 60 * 24));
    }
    case 'size_gb': {
      if (!item.file_size) return null;
      return item.file_size / (1024 * 1024 * 1024);
    }
    case 'resolution_number': {
      // Parse resolution string to number: "1080p" → 1080, "4K" → 2160, "720p" → 720, "480p" → 480
      const res = String(item.resolution || '');
      if (res.toLowerCase().includes('4k') || res.includes('2160')) return 2160;
      const match = res.match(/(\d+)/);
      return match && match[1] ? parseInt(match[1], 10) : 0;
    }
    case 'year':
      return item.year || 0;
    case 'codec':
      return (item.codec || '').toLowerCase();
    case 'library_key':
      return (item as any).library_key || '';
    case 'file_path':
      return item.file_path || '';
    case 'watched_by_count': {
      // Parse watched_by JSON array and count unique watchers
      try {
        const wb = item.watched_by;
        if (!wb) return 0;
        const parsed = typeof wb === 'string' ? JSON.parse(wb) : wb;
        return Array.isArray(parsed) ? parsed.length : 0;
      } catch { return 0; }
    }
    default:
      // Direct field access
      if (field in item) {
        return item[field as keyof MediaItem] as string | number | boolean | null;
      }
      return null;
  }
}

const router = Router();

// Validation middleware
function validateBody<T>(schema: z.ZodSchema<T>) {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: result.error.issues,
      });
      return;
    }
    req.body = result.data;
    next();
  };
}

// ============================================================================
// Rules Endpoints
// ============================================================================

// GET /api/rules - Get all rules
router.get('/', (_req: Request, res: Response) => {
  try {
    const rules = rulesRepo.rules.getAll();
    res.json({
      success: true,
      data: rules.map(toClientRule),
      total: rules.length,
    });
  } catch (error) {
    logger.error('Failed to get rules:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve rules',
    });
  }
});

// GET /api/rules/enabled - Get only enabled rules
router.get('/enabled', (_req: Request, res: Response) => {
  try {
    const rules = rulesRepo.rules.getEnabled();
    res.json({
      success: true,
      data: rules.map(toClientRule),
      total: rules.length,
    });
  } catch (error) {
    logger.error('Failed to get enabled rules:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve enabled rules',
    });
  }
});

// GET /api/rules/suggestions - Get smart rule suggestions based on library analysis
// NOTE: This must be defined BEFORE /:id to avoid matching "suggestions" as an ID
router.get('/suggestions', async (_req: Request, res: Response) => {
  try {
    const { data: items } = mediaItemsRepo.getAll({ limit: 10000 });

    const now = new Date();
    const suggestions: Array<{
      id: string;
      name: string;
      description: string;
      icon: string;
      matchCount: number;
      totalSize: number;
      totalSizeFormatted: string;
      conditions: RuleCondition[];
      mediaType: 'all' | 'movie' | 'show';
    }> = [];

    // 1. Never watched (added 30+ days ago, play_count = 0)
    const neverWatched = items.filter((item) => {
      if (item.play_count > 0) return false;
      if (!item.added_at) return false;
      const days = Math.floor((now.getTime() - new Date(item.added_at).getTime()) / (1000 * 60 * 60 * 24));
      return days >= 30;
    });
    if (neverWatched.length > 0) {
      const size = neverWatched.reduce((sum, i) => sum + (i.file_size || 0), 0);
      suggestions.push({
        id: 'never-watched',
        name: 'Never Watched',
        description: 'Added 30+ days ago, never played',
        icon: 'download',
        matchCount: neverWatched.length,
        totalSize: size,
        totalSizeFormatted: formatBytes(size),
        conditions: [
          { field: 'play_count', operator: 'equals', value: 0 },
          { field: 'days_since_added', operator: 'greater_than', value: 30 },
        ],
        mediaType: 'all',
      });
    }

    // 2. Watched once (watched exactly once, 60+ days ago)
    const watchedOnce = items.filter((item) => {
      if (item.play_count !== 1) return false;
      if (!item.last_watched_at) return false;
      const days = Math.floor((now.getTime() - new Date(item.last_watched_at).getTime()) / (1000 * 60 * 60 * 24));
      return days >= 60;
    });
    if (watchedOnce.length > 0) {
      const size = watchedOnce.reduce((sum, i) => sum + (i.file_size || 0), 0);
      suggestions.push({
        id: 'watched-once',
        name: 'Watched Once',
        description: 'Played once, 60+ days ago',
        icon: 'eye',
        matchCount: watchedOnce.length,
        totalSize: size,
        totalSizeFormatted: formatBytes(size),
        conditions: [
          { field: 'play_count', operator: 'equals', value: 1 },
          { field: 'days_since_watched', operator: 'greater_than', value: 60 },
        ],
        mediaType: 'all',
      });
    }

    // 3. Large files (10GB+, not watched in 30+ days)
    const largeFiles = items.filter((item) => {
      if (!item.file_size || item.file_size < 10 * 1024 * 1024 * 1024) return false; // 10GB
      if (!item.last_watched_at) return true;
      const days = Math.floor((now.getTime() - new Date(item.last_watched_at).getTime()) / (1000 * 60 * 60 * 24));
      return days >= 30;
    });
    if (largeFiles.length > 0) {
      const size = largeFiles.reduce((sum, i) => sum + (i.file_size || 0), 0);
      suggestions.push({
        id: 'large-files',
        name: 'Large Files',
        description: '10GB+ files, not watched in 30+ days',
        icon: 'hard-drive',
        matchCount: largeFiles.length,
        totalSize: size,
        totalSizeFormatted: formatBytes(size),
        conditions: [
          { field: 'size_gb', operator: 'greater_than', value: 10 },
          { field: 'days_since_watched', operator: 'greater_than', value: 30 },
        ],
        mediaType: 'all',
      });
    }

    // 4. Stale content (not watched in 90+ days)
    const stale = items.filter((item) => {
      if (!item.last_watched_at) {
        if (!item.added_at) return false;
        const days = Math.floor((now.getTime() - new Date(item.added_at).getTime()) / (1000 * 60 * 60 * 24));
        return days >= 90;
      }
      const days = Math.floor((now.getTime() - new Date(item.last_watched_at).getTime()) / (1000 * 60 * 60 * 24));
      return days >= 90;
    });
    if (stale.length > 0) {
      const size = stale.reduce((sum, i) => sum + (i.file_size || 0), 0);
      suggestions.push({
        id: 'stale',
        name: 'Stale Content',
        description: 'Not watched in 90+ days',
        icon: 'clock',
        matchCount: stale.length,
        totalSize: size,
        totalSizeFormatted: formatBytes(size),
        conditions: [{ field: 'days_since_watched', operator: 'greater_than', value: 90 }],
        mediaType: 'all',
      });
    }

    // 5. Old movies (movies watched once, 30+ days ago)
    const oldMovies = items.filter((item) => {
      if (item.type !== 'movie') return false;
      if (item.play_count !== 1) return false;
      if (!item.last_watched_at) return false;
      const days = Math.floor((now.getTime() - new Date(item.last_watched_at).getTime()) / (1000 * 60 * 60 * 24));
      return days >= 30;
    });
    if (oldMovies.length > 0) {
      const size = oldMovies.reduce((sum, i) => sum + (i.file_size || 0), 0);
      suggestions.push({
        id: 'old-movies',
        name: 'Old Movies',
        description: 'Movies watched once, 30+ days ago',
        icon: 'film',
        matchCount: oldMovies.length,
        totalSize: size,
        totalSizeFormatted: formatBytes(size),
        conditions: [
          { field: 'play_count', operator: 'equals', value: 1 },
          { field: 'days_since_watched', operator: 'greater_than', value: 30 },
        ],
        mediaType: 'movie',
      });
    }

    // 6. Completed TV shows (TV shows not watched in 60+ days)
    const completedShows = items.filter((item) => {
      if (item.type !== 'show') return false;
      if (!item.last_watched_at) return false;
      const days = Math.floor((now.getTime() - new Date(item.last_watched_at).getTime()) / (1000 * 60 * 60 * 24));
      return days >= 60;
    });
    if (completedShows.length > 0) {
      const size = completedShows.reduce((sum, i) => sum + (i.file_size || 0), 0);
      suggestions.push({
        id: 'completed-shows',
        name: 'Old TV Shows',
        description: 'TV shows not watched in 60+ days',
        icon: 'tv',
        matchCount: completedShows.length,
        totalSize: size,
        totalSizeFormatted: formatBytes(size),
        conditions: [{ field: 'days_since_watched', operator: 'greater_than', value: 60 }],
        mediaType: 'show',
      });
    }

    // 7. Low Quality Files (SD and 720p content)
    const lowQuality = items.filter((item) => {
      const res = String(item.resolution || '');
      let resNum = 0;
      if (res.toLowerCase().includes('4k') || res.includes('2160')) resNum = 2160;
      else {
        const m = res.match(/(\d+)/);
        resNum = m && m[1] ? parseInt(m[1], 10) : 0;
      }
      return resNum > 0 && resNum < 1080;
    });
    if (lowQuality.length > 0) {
      const size = lowQuality.reduce((sum, i) => sum + (i.file_size || 0), 0);
      suggestions.push({
        id: 'low-quality',
        name: 'Low Quality Files',
        description: 'Remove SD and 720p content to save space',
        icon: 'monitor',
        matchCount: lowQuality.length,
        totalSize: size,
        totalSizeFormatted: formatBytes(size),
        conditions: [
          { field: 'resolution_number', operator: 'less_than', value: 1080 },
        ],
        mediaType: 'all',
      });
    }

    // 8. Old Codec Cleanup (H.264 or similar)
    const oldCodec = items.filter((item) => {
      if (item.type !== 'movie') return false;
      const codec = (item.codec || '').toLowerCase();
      return codec.includes('h264') || codec.includes('h.264');
    });
    if (oldCodec.length > 0) {
      const size = oldCodec.reduce((sum, i) => sum + (i.file_size || 0), 0);
      suggestions.push({
        id: 'old-codec',
        name: 'Old Codec Cleanup',
        description: 'Remove files using older codecs like H.264 or MPEG',
        icon: 'film',
        matchCount: oldCodec.length,
        totalSize: size,
        totalSizeFormatted: formatBytes(size),
        conditions: [
          { field: 'codec', operator: 'contains', value: 'h264' },
        ],
        mediaType: 'movie',
      });
    }

    // 9. Classic Movies Never Rewatched (before 2015, not watched in 180+ days)
    const classicNeverRewatched = items.filter((item) => {
      if (item.type !== 'movie') return false;
      if (!item.year || item.year >= 2015) return false;
      if (!item.last_watched_at) return true; // Never watched counts
      const days = Math.floor((now.getTime() - new Date(item.last_watched_at).getTime()) / (1000 * 60 * 60 * 24));
      return days > 180;
    });
    if (classicNeverRewatched.length > 0) {
      const size = classicNeverRewatched.reduce((sum, i) => sum + (i.file_size || 0), 0);
      suggestions.push({
        id: 'classic-never-rewatched',
        name: 'Classic Movies Never Rewatched',
        description: "Movies released before 2015 that haven't been watched recently",
        icon: 'clock',
        matchCount: classicNeverRewatched.length,
        totalSize: size,
        totalSizeFormatted: formatBytes(size),
        conditions: [
          { field: 'year', operator: 'less_than', value: 2015 },
          { field: 'days_since_watched', operator: 'greater_than', value: 180 },
        ],
        mediaType: 'movie',
      });
    }

    // 10. Large 4K Files Watched Once (4K, play_count = 1, 20GB+)
    const large4kWatchedOnce = items.filter((item) => {
      if (item.type !== 'movie') return false;
      if (item.play_count !== 1) return false;
      if (!item.file_size || item.file_size < 20 * 1024 * 1024 * 1024) return false; // 20GB
      const res = String(item.resolution || '');
      let resNum = 0;
      if (res.toLowerCase().includes('4k') || res.includes('2160')) resNum = 2160;
      else {
        const m = res.match(/(\d+)/);
        resNum = m && m[1] ? parseInt(m[1], 10) : 0;
      }
      return resNum > 2000;
    });
    if (large4kWatchedOnce.length > 0) {
      const size = large4kWatchedOnce.reduce((sum, i) => sum + (i.file_size || 0), 0);
      suggestions.push({
        id: 'large-4k-watched-once',
        name: 'Large 4K Files Watched Once',
        description: 'Large 4K files that have only been watched once',
        icon: 'hard-drive',
        matchCount: large4kWatchedOnce.length,
        totalSize: size,
        totalSizeFormatted: formatBytes(size),
        conditions: [
          { field: 'resolution_number', operator: 'greater_than', value: 2000 },
          { field: 'play_count', operator: 'equals', value: 1 },
          { field: 'size_gb', operator: 'greater_than', value: 20 },
        ],
        mediaType: 'movie',
      });
    }

    // 11. Low play count (watched 2 or fewer times, 90+ days ago)
    const lowPlayCount = items.filter((item) => {
      if (item.play_count > 2) return false;
      if (!item.last_watched_at && !item.added_at) return false;
      const dateToCheck = item.last_watched_at || item.added_at;
      const days = Math.floor((now.getTime() - new Date(dateToCheck!).getTime()) / (1000 * 60 * 60 * 24));
      return days >= 90;
    });
    if (lowPlayCount.length > 0) {
      const size = lowPlayCount.reduce((sum, i) => sum + (i.file_size || 0), 0);
      suggestions.push({
        id: 'low-play-count',
        name: 'Rarely Watched',
        description: 'Played 2 or fewer times, 90+ days old',
        icon: 'eye',
        matchCount: lowPlayCount.length,
        totalSize: size,
        totalSizeFormatted: formatBytes(size),
        conditions: [
          { field: 'play_count', operator: 'less_than', value: 3 },
          { field: 'days_since_watched', operator: 'greater_than', value: 90 },
        ],
        mediaType: 'all',
      });
    }

    res.json({
      success: true,
      data: {
        suggestions,
        libraryStats: {
          totalItems: items.length,
          movies: items.filter((i) => i.type === 'movie').length,
          shows: items.filter((i) => i.type === 'show').length,
          totalSize: items.reduce((sum, i) => sum + (i.file_size || 0), 0),
        },
      },
    });
  } catch (error) {
    logger.error('Failed to get rule suggestions:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get rule suggestions',
    });
  }
});

// GET /api/rules/:id - Get a specific rule
router.get('/:id', (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params['id'] as string, 10);
    if (isNaN(id)) {
      res.status(400).json({
        success: false,
        error: 'Invalid rule ID',
      });
      return;
    }

    const rule = rulesRepo.rules.getById(id);
    if (!rule) {
      res.status(404).json({
        success: false,
        error: `Rule not found: ${id}`,
      });
      return;
    }

    res.json({
      success: true,
      data: toClientRule(rule),
    });
  } catch (error) {
    logger.error('Failed to get rule:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve rule',
    });
  }
});

/**
 * Middleware that validates any regex_match operators in the incoming rule
 * body. Supports both v1 (flat `conditions` array) and v2 (tree `root`).
 * Rejects unsafe patterns with a 400.
 */
function validateRegexSafety(req: Request, res: Response, next: NextFunction): void {
  try {
    const body = req.body;
    // v2 at top level: look for `root`
    if (body && typeof body === 'object' && 'root' in body && body.root) {
      validateConditionTree(body.root);
    }
    // v2 nested inside `conditions`: { version: 2, root: ... }
    if (
      body &&
      typeof body === 'object' &&
      body.conditions &&
      typeof body.conditions === 'object' &&
      !Array.isArray(body.conditions) &&
      body.conditions.root
    ) {
      validateConditionTree(body.conditions.root);
    }
    // v1: look for flat conditions array
    if (body && Array.isArray(body.conditions)) {
      for (const c of body.conditions) {
        if (c && REGEX_OPERATORS.has(String(c.operator))) {
          const pattern = String(c.value ?? '');
          if (!safeRegex(pattern)) {
            throw new UnsafeRegexError(pattern, ['conditions']);
          }
        }
      }
    }
    next();
  } catch (err) {
    if (err instanceof UnsafeRegexError) {
      res.status(400).json({
        success: false,
        error: `Unsafe regex pattern rejected: ${err.pattern}`,
      });
      return;
    }
    res.status(400).json({
      success: false,
      error: (err as Error).message,
    });
  }
}

// POST /api/rules - Create a new rule
router.post('/', validateRegexSafety, validateBody(CreateRuleSchema), (req: Request, res: Response) => {
  try {
    const rule = rulesRepo.rules.create(req.body);
    res.status(201).json({
      success: true,
      data: toClientRule(rule),
      message: 'Rule created successfully',
    });
  } catch (error) {
    logger.error('Failed to create rule:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create rule',
    });
  }
});

// PUT /api/rules/:id - Update a rule
router.put('/:id', validateRegexSafety, validateBody(UpdateRuleSchema), (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params['id'] as string, 10);
    if (isNaN(id)) {
      res.status(400).json({
        success: false,
        error: 'Invalid rule ID',
      });
      return;
    }

    const rule = rulesRepo.rules.update(id, req.body);
    if (!rule) {
      res.status(404).json({
        success: false,
        error: `Rule not found: ${id}`,
      });
      return;
    }

    res.json({
      success: true,
      data: toClientRule(rule),
      message: 'Rule updated successfully',
    });
  } catch (error) {
    logger.error('Failed to update rule:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update rule',
    });
  }
});

// DELETE /api/rules/:id - Delete a rule
router.delete('/:id', (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params['id'] as string, 10);
    if (isNaN(id)) {
      res.status(400).json({
        success: false,
        error: 'Invalid rule ID',
      });
      return;
    }

    const deleted = rulesRepo.rules.delete(id);
    if (!deleted) {
      res.status(404).json({
        success: false,
        error: `Rule not found: ${id}`,
      });
      return;
    }

    res.json({
      success: true,
      message: 'Rule deleted successfully',
    });
  } catch (error) {
    logger.error('Failed to delete rule:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete rule',
    });
  }
});

// PATCH /api/rules/:id/toggle - Toggle rule enabled/disabled
router.patch('/:id/toggle', (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params['id'] as string, 10);
    if (isNaN(id)) {
      res.status(400).json({
        success: false,
        error: 'Invalid rule ID',
      });
      return;
    }

    // Use the enabled value from request body if provided, otherwise toggle
    const { enabled } = req.body;
    let rule;
    if (typeof enabled === 'boolean') {
      rule = rulesRepo.rules.update(id, { enabled });
    } else {
      rule = rulesRepo.rules.toggle(id);
    }

    if (!rule) {
      res.status(404).json({
        success: false,
        error: `Rule not found: ${id}`,
      });
      return;
    }

    res.json({
      success: true,
      data: toClientRule(rule),
      message: `Rule ${rule.enabled ? 'enabled' : 'disabled'}`,
    });
  } catch (error) {
    logger.error('Failed to toggle rule:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to toggle rule',
    });
  }
});

// POST /api/rules/:id/run - Run a rule manually (scan library and mark matching items)
router.post('/:id/run', async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params['id'] as string, 10);
    if (isNaN(id)) {
      res.status(400).json({
        success: false,
        error: 'Invalid rule ID',
      });
      return;
    }

    const rule = rulesRepo.rules.getById(id);
    if (!rule) {
      res.status(404).json({
        success: false,
        error: `Rule not found: ${id}`,
      });
      return;
    }

    // Get all media items
    const { data: mediaItems } = mediaItemsRepo.getAll({ limit: 10000 });

    // Filter by media type if specified
    const ruleMediaType = rule.media_type || 'all';
    const filteredItems = ruleMediaType === 'all'
      ? mediaItems
      : mediaItems.filter((item) => item.type === ruleMediaType);

    // Build evaluation context once for this run (v2 engine — supports nested
    // groups, new operators, collection_membership, watched_by_user)
    const watchLookup = buildWatchLookup();
    const ctx: EvaluationContext = {
      collectionsRepo,
      watchLookup,
      now: new Date(),
    };

    // Evaluate each media item against the rule conditions via the v2 engine.
    // evaluateRuleConditions handles v1→v2 upgrade + tree walking internally.
    const matchingItems: typeof mediaItems = [];
    for (const item of filteredItems) {
      // Skip protected items
      if (item.is_protected) {
        continue;
      }
      try {
        if (evaluateRuleConditions(rule.conditions, item, ctx)) {
          matchingItems.push(item);
        }
      } catch (evalError) {
        logger.error(`Failed to evaluate rule ${rule.id} against item ${item.id}:`, evalError);
      }
    }

    // Calculate delete_after date based on grace period
    const gracePeriodDays = rule.grace_period_days ?? 7;
    const now = new Date();
    const deleteAfter = new Date(now.getTime() + gracePeriodDays * 24 * 60 * 60 * 1000);
    const markedAt = now.toISOString();
    const deleteAfterStr = deleteAfter.toISOString();

    // Apply the rule action to matching items
    let processed = 0;
    let failed = 0;
    const results: { id: number; title: string; action: string; success: boolean }[] = [];

    for (const item of matchingItems) {
      try {
        switch (rule.action) {
          case 'flag':
            mediaItemsRepo.update(item.id, {
              status: 'flagged',
              marked_at: markedAt,
              matched_rule_id: rule.id,
            } as any);
            results.push({ id: item.id, title: item.title, action: 'flagged', success: true });
            processed++;
            break;
          case 'delete':
            mediaItemsRepo.update(item.id, {
              status: 'pending_deletion',
              marked_at: markedAt,
              delete_after: deleteAfterStr,
              deletion_action: rule.deletion_action || 'delete_files',
              reset_overseerr: rule.reset_overseerr ? 1 : 0,
              matched_rule_id: rule.id,
            } as any);
            results.push({ id: item.id, title: item.title, action: 'pending_deletion', success: true });
            processed++;
            break;
          case 'notify':
            // For notify action, just mark them as flagged but don't delete
            // In a full implementation, this would trigger a notification
            results.push({ id: item.id, title: item.title, action: 'notified', success: true });
            processed++;
            break;
        }
      } catch (itemError) {
        logger.error(`Failed to process item ${item.id}:`, itemError);
        results.push({ id: item.id, title: item.title, action: rule.action, success: false });
        failed++;
      }
    }

    logger.info(`Rule ${id} (${rule.name}) run complete: ${processed} processed, ${failed} failed`);

    res.json({
      success: true,
      data: {
        rule: {
          id: rule.id,
          name: rule.name,
          action: rule.action,
        },
        summary: {
          totalScanned: mediaItems.length,
          matched: matchingItems.length,
          processed,
          failed,
        },
        results,
      },
      message: `Rule executed: ${processed} items ${rule.action === 'flag' ? 'flagged' : rule.action === 'delete' ? 'marked for deletion' : 'notified'}`,
    });
  } catch (error) {
    logger.error('Failed to run rule:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to run rule',
    });
  }
});

// ============================================================================
// Preview Endpoint
// ============================================================================

// POST /api/rules/preview - Preview which items would match a rule (before saving)
// Accepts either v1 (legacy flat conditions) or v2 (nested tree) payloads.
const PreviewRuleSchema = z.object({
  mediaType: z.enum(['all', 'movie', 'show', 'tv']).optional(),
  // v2
  version: z.literal(2).optional(),
  root: ConditionNodeSchema.optional(),
  // v1 (legacy)
  conditions: z
    .array(
      z.object({
        field: z.string(),
        operator: z.string(),
        value: z.union([z.string(), z.number(), z.boolean(), z.array(z.unknown())]),
      })
    )
    .optional(),
  logic: z.enum(['AND', 'OR']).optional(),
});

router.post('/preview', validateBody(PreviewRuleSchema), async (req: Request, res: Response) => {
  try {
    const { mediaType } = req.body;

    // Build v2 tree from payload
    let v2;
    try {
      v2 = upgradeToV2(req.body);
      validateConditionTree(v2.root);
    } catch (validationError) {
      if (validationError instanceof UnsafeRegexError) {
        res.status(400).json({
          success: false,
          error: `Unsafe regex pattern rejected: ${validationError.pattern}`,
        });
        return;
      }
      res.status(400).json({
        success: false,
        error: (validationError as Error).message,
      });
      return;
    }

    // Fetch all media items
    const { data: allItems } = mediaItemsRepo.getAll({ limit: 100000 });

    // Normalize mediaType: client 'tv' → server 'show'
    const normalizedType = mediaType === 'tv' ? 'show' : mediaType;
    const items =
      !normalizedType || normalizedType === 'all'
        ? allItems
        : allItems.filter((item) => item.type === normalizedType);

    // Build watch lookup from cache (one-time prefetch for this run)
    const watchLookup = buildWatchLookup();
    const ctx: EvaluationContext = {
      collectionsRepo,
      watchLookup,
      now: new Date(),
    };

    // Evaluate
    const matching = items.filter((item) => evaluateNode(v2.root as ConditionNode, item, ctx));

    // Separate protected vs queueable
    const wouldSkipProtected = matching.filter((i) => i.is_protected).length;
    const wouldQueue = matching.length - wouldSkipProtected;

    const totalBytes = matching.reduce((sum, i) => sum + (i.file_size || 0), 0);
    const storageFreedGB = totalBytes / (1024 * 1024 * 1024);

    // Top 10 by file size
    const samples = [...matching]
      .sort((a, b) => (b.file_size || 0) - (a.file_size || 0))
      .slice(0, 10)
      .map((item) => ({
        id: item.id,
        title: item.title,
        size: item.file_size || 0,
        rating: item.rating_imdb ?? item.rating_tmdb ?? null,
        posterUrl: item.poster_url || null,
        reason: describeMatchReason(v2.root as ConditionNode),
      }));

    res.json({
      success: true,
      data: {
        totalMatches: matching.length,
        wouldQueue,
        wouldSkipProtected,
        storageFreedGB: Math.round(storageFreedGB * 100) / 100,
        totalSize: totalBytes,
        totalSizeFormatted: formatBytes(totalBytes),
        samples,
      },
    });
  } catch (error) {
    logger.error('Failed to preview rule:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to preview rule',
    });
  }
});

/**
 * Build a ratingKey → username → Date lookup from the watch_history_cache.
 * Called once per preview/evaluation run.
 */
function buildWatchLookup(): WatchLookup {
  const lookup: WatchLookup = new Map();
  try {
    // Snapshot the cache — pull all watched entries. For very large caches
    // this could be narrowed with a filter, but 100k rows is manageable.
    // We use getByRatingKey per-item? No — we need all at once. Query direct:
    const db = getDatabase();
    const rows = db
      .prepare(
        'SELECT plex_rating_key, username, MAX(stopped_at) as stopped_at FROM watch_history_cache WHERE watched = 1 GROUP BY plex_rating_key, username'
      )
      .all() as Array<{ plex_rating_key: string; username: string; stopped_at: string }>;
    for (const r of rows) {
      let userMap = lookup.get(r.plex_rating_key);
      if (!userMap) {
        userMap = new Map();
        lookup.set(r.plex_rating_key, userMap);
      }
      userMap.set(r.username, new Date(r.stopped_at));
    }
  } catch (err) {
    logger.warn('Failed to build watch lookup:', err);
  }
  return lookup;
}

function describeMatchReason(root: ConditionNode): string {
  if (root.kind === 'condition') {
    return `${root.field} ${root.operator}`;
  }
  return `${root.logic} of ${root.children.length} condition(s)`;
}

// ============================================================================
// Profiles Endpoints
// ============================================================================

// GET /api/rules/profiles - Get all profiles
router.get('/profiles/all', (_req: Request, res: Response) => {
  try {
    const profiles = rulesRepo.profiles.getAll();
    res.json({
      success: true,
      data: profiles,
      total: profiles.length,
    });
  } catch (error) {
    logger.error('Failed to get profiles:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve profiles',
    });
  }
});

// GET /api/rules/profiles/active - Get active profile
router.get('/profiles/active', (_req: Request, res: Response) => {
  try {
    const profile = rulesRepo.profiles.getActive();
    if (!profile) {
      res.status(404).json({
        success: false,
        error: 'No active profile found',
      });
      return;
    }

    res.json({
      success: true,
      data: profile,
    });
  } catch (error) {
    logger.error('Failed to get active profile:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve active profile',
    });
  }
});

// POST /api/rules/profiles - Create a new profile
const CreateProfileSchema = z.object({
  name: z.string().min(1),
});

router.post('/profiles', validateBody(CreateProfileSchema), (req: Request, res: Response) => {
  try {
    const profile = rulesRepo.profiles.create(req.body.name);
    res.status(201).json({
      success: true,
      data: profile,
      message: 'Profile created successfully',
    });
  } catch (error) {
    logger.error('Failed to create profile:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create profile',
    });
  }
});

// PATCH /api/rules/profiles/:id/activate - Set active profile
router.patch('/profiles/:id/activate', (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params['id'] as string, 10);
    if (isNaN(id)) {
      res.status(400).json({
        success: false,
        error: 'Invalid profile ID',
      });
      return;
    }

    const profile = rulesRepo.profiles.setActive(id);
    if (!profile) {
      res.status(404).json({
        success: false,
        error: `Profile not found: ${id}`,
      });
      return;
    }

    res.json({
      success: true,
      data: profile,
      message: 'Profile activated',
    });
  } catch (error) {
    logger.error('Failed to activate profile:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to activate profile',
    });
  }
});

// DELETE /api/rules/profiles/:id - Delete a profile
router.delete('/profiles/:id', (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params['id'] as string, 10);
    if (isNaN(id)) {
      res.status(400).json({
        success: false,
        error: 'Invalid profile ID',
      });
      return;
    }

    const deleted = rulesRepo.profiles.delete(id);
    if (!deleted) {
      res.status(404).json({
        success: false,
        error: `Profile not found: ${id}`,
      });
      return;
    }

    res.json({
      success: true,
      message: 'Profile deleted successfully',
    });
  } catch (error) {
    logger.error('Failed to delete profile:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete profile',
    });
  }
});

// ============================================================================
// Deletion History Endpoints
// ============================================================================

// GET /api/rules/history/deletions - Get deletion history
router.get('/history/deletions', (req: Request, res: Response) => {
  try {
    const limit = parseInt(req.query['limit'] as string, 10) || 100;
    const offset = parseInt(req.query['offset'] as string, 10) || 0;

    const history = rulesRepo.deletionHistory.getAll(limit, offset);
    res.json({
      success: true,
      data: history,
      total: history.length,
      limit,
      offset,
    });
  } catch (error) {
    logger.error('Failed to get deletion history:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve deletion history',
    });
  }
});

// GET /api/rules/history/deletions/stats - Get deletion statistics
router.get('/history/deletions/stats', (_req: Request, res: Response) => {
  try {
    const stats = rulesRepo.deletionHistory.getStats();
    res.json({
      success: true,
      data: stats,
    });
  } catch (error) {
    logger.error('Failed to get deletion stats:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve deletion statistics',
    });
  }
});

export default router;
