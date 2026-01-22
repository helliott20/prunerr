import { Router, Request, Response } from 'express';
import mediaItemsRepo from '../db/repositories/mediaItems';
import rulesRepo from '../db/repositories/rules';
import logger from '../utils/logger';
import { formatBytes } from '../utils/format';

const router = Router();

interface ActivityItem {
  id: string;
  type: 'scan' | 'delete' | 'rule' | 'restore';
  message: string;
  timestamp: string;
  metadata?: Record<string, unknown>;
}

// GET /api/activity/recent - Get recent activity
router.get('/recent', (req: Request, res: Response) => {
  try {
    const limit = parseInt(req.query['limit'] as string, 10) || 20;
    const activities: ActivityItem[] = [];

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

    // Get recently flagged items (mapped to 'rule' type as they're flagged by rules)
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

    // Get recently protected items (mapped to 'restore' type as protection restores them from deletion)
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

    // Sort all activities by timestamp (most recent first) and limit
    activities.sort(
      (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );
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
