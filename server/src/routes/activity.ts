import { Router, Request, Response } from 'express';
import activityRepo, {
  type ActivityEventType,
  type ActivityActorType,
  type ActivityDateRange,
  type ActivityLogEntry,
  getActivityByItemId,
} from '../db/repositories/activity';
import collectionsRepo from '../db/repositories/collections';
import logger from '../utils/logger';

const VALID_EVENT_TYPES = ['scan', 'deletion', 'rule_match', 'protection', 'manual_action', 'error'];
const VALID_ACTOR_TYPES = ['scheduler', 'user', 'rule'];

const router = Router();

/**
 * Parse the metadata JSON string on an activity entry so the HTTP payload
 * matches the client's typed shape. Keeps raw DB rows in the repository.
 */
function parseMeta<E extends ActivityLogEntry>(
  entry: E
): Omit<E, 'metadata'> & { metadata: Record<string, unknown> | null } {
  let metadata: Record<string, unknown> | null = null;
  if (entry.metadata) {
    try {
      metadata = JSON.parse(entry.metadata) as Record<string, unknown>;
    } catch {
      metadata = null;
    }
  }
  return { ...entry, metadata };
}

// GET /api/activity - Get full activity log with pagination and filtering
router.get('/', (req: Request, res: Response) => {
  try {
    const page = parseInt(req.query['page'] as string, 10) || 1;
    const limit = parseInt(req.query['limit'] as string, 10) || 20;
    const dateRange = req.query['dateRange'] as ActivityDateRange | undefined;
    const search = req.query['search'] as string | undefined;

    // Parse and validate comma-separated event types
    const eventTypesParam = req.query['eventTypes'] as string | undefined;
    const eventTypes = eventTypesParam
      ? eventTypesParam.split(',').filter((t): t is ActivityEventType => VALID_EVENT_TYPES.includes(t))
      : undefined;

    // Parse and validate comma-separated actor types
    const actorTypesParam = req.query['actorTypes'] as string | undefined;
    const actorTypes = actorTypesParam
      ? actorTypesParam.split(',').filter((t): t is ActivityActorType => VALID_ACTOR_TYPES.includes(t))
      : undefined;

    // Validate dateRange
    const validDateRanges = ['24h', '7d', '30d', 'all'];
    if (dateRange && !validDateRanges.includes(dateRange)) {
      res.status(400).json({
        success: false,
        error: 'Invalid dateRange. Must be one of: 24h, 7d, 30d, all',
      });
      return;
    }

    // Parse and validate comma-separated exclude event types
    const excludeEventTypesParam = req.query['excludeEventTypes'] as string | undefined;
    const excludeEventTypes = excludeEventTypesParam
      ? excludeEventTypesParam.split(',').filter((t) => VALID_EVENT_TYPES.includes(t))
      : undefined;

    const result = activityRepo.getActivityLog({
      page,
      limit,
      dateRange,
      eventTypes,
      actorTypes,
      excludeEventTypes,
      search,
    });

    res.json({
      success: true,
      data: {
        ...result,
        items: result.items.map(parseMeta),
      },
    });
  } catch (error) {
    logger.error('Failed to get activity log:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve activity log',
    });
  }
});

// GET /api/activity/item/:itemId - Get activity for a specific media item
router.get('/item/:itemId', (req: Request, res: Response) => {
  try {
    const itemId = parseInt(req.params['itemId'] as string, 10);

    if (isNaN(itemId)) {
      res.status(400).json({
        success: false,
        error: 'Invalid item ID',
      });
      return;
    }

    const limit = Math.min(200, Math.max(1, parseInt(req.query['limit'] as string, 10) || 50));

    // Get direct item activity
    const itemEntries = getActivityByItemId(itemId, limit);

    // Also get activity for collections containing this item
    const collections = collectionsRepo.findByMediaItem(itemId);
    const collectionEntries = collections.flatMap((col) =>
      getActivityByItemId(col.id, limit).filter((e) => e.targetType === 'collection')
    );

    // Merge, dedupe by id, sort by date desc, and limit
    const allMap = new Map<number, typeof itemEntries[0]>();
    for (const e of [...itemEntries, ...collectionEntries]) {
      allMap.set(e.id, e);
    }
    const entries = [...allMap.values()]
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, limit)
      .map(parseMeta);

    res.json({
      success: true,
      data: entries,
      total: entries.length,
    });
  } catch (error) {
    logger.error('Failed to get item activity:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve item activity',
    });
  }
});

// GET /api/activity/recent - Get recent activity for the dashboard widget.
// Returns full ActivityLogEntry objects (metadata parsed) so the client can
// render rich event context using the shared activity formatter.
router.get('/recent', (req: Request, res: Response) => {
  try {
    const limit = parseInt(req.query['limit'] as string, 10) || 20;

    const excludeEventTypesParam = req.query['excludeEventTypes'] as string | undefined;
    const excludeEventTypes = excludeEventTypesParam
      ? excludeEventTypesParam.split(',').filter((t) => VALID_EVENT_TYPES.includes(t))
      : undefined;

    const entries = activityRepo
      .getRecentActivity(limit, excludeEventTypes)
      .map(parseMeta);

    res.json({
      success: true,
      data: entries,
      total: entries.length,
    });
  } catch (error) {
    logger.error('Failed to get recent activity:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve recent activity',
    });
  }
});

export default router;
