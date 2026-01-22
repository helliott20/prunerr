import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import rulesRepo from '../db/repositories/rules';
import { CreateRuleSchema, UpdateRuleSchema, RuleCondition, MediaItem } from '../types';
import logger from '../utils/logger';
import { formatBytes } from '../utils/format';

// ============================================================================
// Helper Functions
// ============================================================================

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
      data: rules,
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
      data: rules,
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
    const mediaItemsRepo = await import('../db/repositories/mediaItems');
    const { data: items } = mediaItemsRepo.default.getAll({ limit: 10000 });

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

    // 7. Low play count (watched 2 or fewer times, 90+ days ago)
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
      data: rule,
    });
  } catch (error) {
    logger.error('Failed to get rule:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve rule',
    });
  }
});

// POST /api/rules - Create a new rule
router.post('/', validateBody(CreateRuleSchema), (req: Request, res: Response) => {
  try {
    const rule = rulesRepo.rules.create(req.body);
    res.status(201).json({
      success: true,
      data: rule,
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
router.put('/:id', validateBody(UpdateRuleSchema), (req: Request, res: Response) => {
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
      data: rule,
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

    const rule = rulesRepo.rules.toggle(id);
    if (!rule) {
      res.status(404).json({
        success: false,
        error: `Rule not found: ${id}`,
      });
      return;
    }

    res.json({
      success: true,
      data: rule,
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

    // Parse the rule conditions
    let conditions: RuleCondition[];
    try {
      conditions = JSON.parse(rule.conditions) as RuleCondition[];
    } catch {
      res.status(400).json({
        success: false,
        error: 'Invalid rule conditions format',
      });
      return;
    }

    // Get all media items
    const mediaItemsRepo = await import('../db/repositories/mediaItems');
    const { data: mediaItems } = mediaItemsRepo.default.getAll({ limit: 10000 });

    // Evaluate each media item against the rule conditions
    const matchingItems: typeof mediaItems = [];
    for (const item of mediaItems) {
      if (evaluateConditions(item, conditions)) {
        matchingItems.push(item);
      }
    }

    // Apply the rule action to matching items
    let processed = 0;
    let failed = 0;
    const results: { id: number; title: string; action: string; success: boolean }[] = [];

    for (const item of matchingItems) {
      try {
        switch (rule.action) {
          case 'flag':
            mediaItemsRepo.default.updateStatus(item.id, 'flagged');
            results.push({ id: item.id, title: item.title, action: 'flagged', success: true });
            processed++;
            break;
          case 'delete':
            mediaItemsRepo.default.updateStatus(item.id, 'pending_deletion');
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
const PreviewRuleSchema = z.object({
  mediaType: z.enum(['all', 'movie', 'show']).optional(),
  conditions: z.array(
    z.object({
      field: z.string(),
      operator: z.string(),
      value: z.union([z.string(), z.number(), z.boolean()]),
    })
  ),
});

router.post('/preview', validateBody(PreviewRuleSchema), async (req: Request, res: Response) => {
  try {
    const { mediaType, conditions } = req.body;

    // Get all media items
    const mediaItemsRepo = await import('../db/repositories/mediaItems');
    const { data: allItems } = mediaItemsRepo.default.getAll({ limit: 10000 });

    // Filter by media type if specified
    let items = allItems;
    if (mediaType && mediaType !== 'all') {
      items = items.filter((item) => item.type === mediaType);
    }

    // Evaluate each item against the conditions
    const matchingItems: typeof items = [];
    for (const item of items) {
      if (evaluateConditions(item, conditions)) {
        matchingItems.push(item);
      }
    }

    // Calculate total size
    const totalSize = matchingItems.reduce((sum, item) => sum + (item.file_size || 0), 0);

    // Return preview with sample items (limit to 10 for performance)
    const sampleItems = matchingItems.slice(0, 10).map((item) => ({
      id: item.id,
      title: item.title,
      type: item.type,
      size: item.file_size,
      posterUrl: item.poster_url,
      lastWatched: item.last_watched_at,
      playCount: item.play_count,
      addedAt: item.added_at,
    }));

    res.json({
      success: true,
      data: {
        matchCount: matchingItems.length,
        totalSize,
        totalSizeFormatted: formatBytes(totalSize),
        sampleItems,
        breakdown: {
          movies: matchingItems.filter((i) => i.type === 'movie').length,
          shows: matchingItems.filter((i) => i.type === 'show').length,
        },
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
