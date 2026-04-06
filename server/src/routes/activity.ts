import { Router, Request, Response } from 'express';
import activityRepo, {
  type ActivityEventType,
  type ActivityActorType,
  type ActivityDateRange,
  getActivityByItemId,
} from '../db/repositories/activity';
import collectionsRepo from '../db/repositories/collections';
import mediaItemsRepo from '../db/repositories/mediaItems';
import rulesRepo from '../db/repositories/rules';
import logger from '../utils/logger';

const VALID_EVENT_TYPES = ['scan', 'deletion', 'rule_match', 'protection', 'manual_action', 'error'];
const VALID_ACTOR_TYPES = ['scheduler', 'user', 'rule'];
import { formatBytes } from '../utils/format';

const router = Router();

// Legacy ActivityItem interface for backward compatibility with Dashboard
interface ActivityItem {
  id: string;
  type: 'scan' | 'delete' | 'rule' | 'restore';
  message: string;
  timestamp: string;
  metadata?: Record<string, unknown>;
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
      data: result,
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
      .slice(0, limit);

    // Parse metadata JSON strings for client consumption
    const parsed = entries.map((e) => ({
      ...e,
      metadata: e.metadata ? (() => { try { return JSON.parse(e.metadata); } catch { return null; } })() : null,
    }));

    res.json({
      success: true,
      data: parsed,
      total: parsed.length,
    });
  } catch (error) {
    logger.error('Failed to get item activity:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve item activity',
    });
  }
});

// GET /api/activity/recent - Get recent activity (backward compatible with Dashboard)
// This combines data from the new activity_log table with legacy sources
// for a seamless transition period
router.get('/recent', (req: Request, res: Response) => {
  try {
    const limit = parseInt(req.query['limit'] as string, 10) || 20;
    const activities: ActivityItem[] = [];

    // Parse and validate comma-separated exclude event types
    const excludeEventTypesParam = req.query['excludeEventTypes'] as string | undefined;
    const excludeEventTypes = excludeEventTypesParam
      ? excludeEventTypesParam.split(',').filter((t) => VALID_EVENT_TYPES.includes(t))
      : undefined;

    // Get recent activity from the new unified activity_log table
    const recentFromLog = activityRepo.getRecentActivity(limit, excludeEventTypes);
    for (const entry of recentFromLog) {
      // Map activity log entry to legacy ActivityItem format
      let type: 'scan' | 'delete' | 'rule' | 'restore' = 'rule';
      let message = entry.action;

      switch (entry.eventType) {
        case 'scan':
          type = 'scan';
          message = entry.action === 'completed'
            ? `Library scan completed`
            : entry.action === 'started'
              ? 'Library scan in progress...'
              : 'Library scan failed';
          // Try to add metadata details
          if (entry.metadata) {
            try {
              const meta = JSON.parse(entry.metadata);
              if (entry.action === 'completed' && meta.itemsScanned !== undefined) {
                message = `Library scan completed: ${meta.itemsScanned} items scanned, ${meta.itemsFlagged || 0} flagged`;
              }
            } catch {
              // Ignore parse errors
            }
          }
          break;
        case 'deletion':
          type = 'delete';
          if (entry.targetTitle) {
            let sizeStr = '';
            if (entry.metadata) {
              try {
                const meta = JSON.parse(entry.metadata);
                if (meta.fileSize) {
                  sizeStr = ` (${formatBytes(meta.fileSize)})`;
                }
              } catch {
                // Ignore parse errors
              }
            }
            message = `"${entry.targetTitle}" was ${entry.action}${sizeStr}`;
          }
          break;
        case 'rule_match':
          type = 'rule';
          if (entry.targetTitle) {
            message = `"${entry.targetTitle}" was flagged for deletion`;
          }
          break;
        case 'protection':
          type = 'restore';
          if (entry.targetTitle) {
            message = `"${entry.targetTitle}" was protected`;
          }
          break;
        case 'error':
          type = 'rule';
          message = entry.action;
          break;
      }

      activities.push({
        id: `activity-${entry.id}`,
        type,
        message,
        timestamp: entry.createdAt,
        metadata: entry.metadata ? JSON.parse(entry.metadata) : undefined,
      });
    }

    // If we have activities from the new table, use them
    // Otherwise fall back to legacy reconstruction for backward compatibility
    if (activities.length === 0) {
      // Legacy fallback: reconstruct from multiple tables
      // This ensures the dashboard works during the transition

      // Get recent scans
      const recentScans = rulesRepo.scanHistory.getAll(10);
      for (const scan of recentScans) {
        activities.push({
          id: `scan-${scan.id}`,
          type: 'scan',
          message:
            scan.status === 'completed'
              ? `Library scan completed: ${scan.items_scanned} items scanned, ${scan.items_flagged} flagged`
              : scan.status === 'running'
                ? 'Library scan in progress...'
                : 'Library scan failed',
          timestamp: scan.completed_at || scan.started_at,
          metadata: {
            scanId: scan.id,
            status: scan.status,
            itemsScanned: scan.items_scanned,
            itemsFlagged: scan.items_flagged,
          },
        });
      }

      // Get recent deletions
      const recentDeletions = rulesRepo.deletionHistory.getAll(10, 0);
      for (const deletion of recentDeletions) {
        const formattedSize = deletion.file_size
          ? formatBytes(deletion.file_size)
          : '0 Bytes';
        activities.push({
          id: `deletion-${deletion.id}`,
          type: 'delete',
          message: `"${deletion.title}" was deleted (${formattedSize})`,
          timestamp: deletion.deleted_at,
          metadata: {
            deletionId: deletion.id,
            mediaType: deletion.type,
            fileSize: deletion.file_size,
            deletionType: deletion.deletion_type,
          },
        });
      }

      // Get recently flagged items
      const flaggedItems = mediaItemsRepo.getFlagged();
      const recentFlagged = flaggedItems
        .filter((item) => item.marked_at)
        .sort(
          (a, b) =>
            new Date(b.marked_at!).getTime() - new Date(a.marked_at!).getTime()
        )
        .slice(0, 10);

      for (const item of recentFlagged) {
        activities.push({
          id: `flagged-${item.id}`,
          type: 'rule',
          message: `"${item.title}" was flagged for deletion`,
          timestamp: item.marked_at!,
          metadata: {
            mediaId: item.id,
            mediaType: item.type,
            status: item.status,
          },
        });
      }

      // Get recently protected items
      const protectedItems = mediaItemsRepo.getProtected();
      const recentProtected = protectedItems
        .filter((item) => item.updated_at)
        .sort(
          (a, b) =>
            new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
        )
        .slice(0, 10);

      for (const item of recentProtected) {
        activities.push({
          id: `protected-${item.id}`,
          type: 'restore',
          message: `"${item.title}" was protected${item.protection_reason ? `: ${item.protection_reason}` : ''}`,
          timestamp: item.updated_at,
          metadata: {
            mediaId: item.id,
            mediaType: item.type,
            protectionReason: item.protection_reason,
          },
        });
      }

      // Sort by timestamp for legacy data
      activities.sort(
        (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
      );
    }

    const limitedActivities = activities.slice(0, limit);

    res.json({
      success: true,
      data: limitedActivities,
      total: limitedActivities.length,
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
